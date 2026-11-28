import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import express, { type Request, type Response } from "express";
import {
  LIFETIME_CATEGORY_ID,
  SHARED_CATEGORY_ID,
  LIFETIME_NEW,
  TITLE_MAX_LENGTH,
  LINKED_REPLY,
  dueNotUnderstoodReply,
  dueSetReply,
  emailTabTarget,
  emailedReply,
  fitsOneSms,
  formatPhoneNumber,
  formatSpokenDue,
  isValidLoginName,
  matchSpokenTab,
  notSavedReply,
  readSmsCommand,
  readSpokenDue,
  resetNewReply,
  savedReply,
  withoutMarkers,
  type Note,
  type SmsLinkCode,
  type SmsStatus,
  type Tab,
} from "@nwsnotes/shared";
import { requireSession, userOf } from "./auth.js";
import type { SmsConfig } from "./config.js";
import type { Mailer } from "./email.js";
import type { LiveUpdates } from "./live.js";
import { actingUser } from "./context.js";
import type { Notebooks } from "./notebooks.js";
import type { Sharing } from "./sharing.js";
import type { PushReminders } from "./push.js";
import { tabSummaryEmail } from "./tabEmail.js";
import { noteLimitOf, type User } from "./users.js";

/** Where Twilio sends each text that arrives at the nwsnotes number. */
export const SMS_WEBHOOK_PATH = "/api/sms/incoming";

/** How long a linking code works for. */
const CODE_LIFETIME_MS = 15 * 60 * 1000;
/** How many texts' ids are remembered, to spot one Twilio sends again. */
const SIDS_REMEMBERED = 1000;
/** At most this many notes in RATE_WINDOW_MS from one number. */
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 10 * 60 * 1000;
/** At most this many tab emails a day for each user, as Brevo's free plan sends 300 a day for everyone. */
const EMAILS_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
/** "Due" sets the due date of a note added at most this long ago. */
const DUE_WINDOW_MS = 5 * 60 * 1000;

/** Texts that are only one of these words aren't notes: Twilio may act on them itself (opting out of texts). */
const OPT_OUT_WORDS = new Set(["stop", "start", "unstop", "help", "info", "cancel", "end", "quit", "unsubscribe", "stopall"]);

/**
 * The signature Twilio sends in X-Twilio-Signature: HMAC-SHA1 (keyed with the auth token) of the webhook's
 * full address followed by each form field's name and value, sorted by name, in base64.
 */
export function twilioSignature(authToken: string, url: string, fields: Record<string, string>): string {
  const data = Object.keys(fields)
    .sort()
    .reduce((text, key) => text + key + fields[key], url);
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

/** Whether a request's signature is Twilio's, compared in constant time. */
function signatureIsRight(expected: string, given: string | undefined): boolean {
  if (!given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A title over the limit, cut at the last space before it (or at the limit if there's none). */
function cutToLimit(title: string): { title: string; cut: boolean } {
  if (title.length <= TITLE_MAX_LENGTH) return { title, cut: false };
  const space = title.lastIndexOf(" ", TITLE_MAX_LENGTH);
  return { title: title.slice(0, space > 0 ? space : TITLE_MAX_LENGTH).trimEnd(), cut: true };
}

/** A phone number for the logs: only its last 3 digits, e.g. "…258". */
function maskedNumber(phoneNumber: string | undefined): string {
  return phoneNumber ? `…${phoneNumber.slice(-3)}` : "no number";
}

/**
 * One line in the server's log for each text that arrives, saying what happened to it (see `pm2 logs`).
 * Never the text itself, and only the last 3 digits of the sender's number.
 */
function logText(fields: Record<string, string>, outcome: string): void {
  console.log(`Text ${fields.MessageSid ?? "(no id)"} from ${maskedNumber(fields.From)}: ${outcome}`);
}

/** A reply in TwiML: a text back with this message, or (without one) nothing sent. */
function twiml(res: Response, message?: string): void {
  const escaped = message?.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  res
    .status(200)
    .type("text/xml")
    .send(`<?xml version="1.0" encoding="UTF-8"?>${escaped === undefined ? "<Response/>" : `<Response><Message>${escaped}</Message></Response>`}`);
}

/**
 * Adding notes by text message (see Specs/text-messages.md). Twilio posts each text sent to the nwsnotes
 * number to the webhook; a text from a linked phone becomes a note in its user's notebook, put in the tab
 * its first words name. Each saved note gets a notification; a note that couldn't be saved gets a text back,
 * and so does a saved one for users the admin has turned confirmations on for.
 */
export class SmsNotes {
  /** Linking codes waiting to be texted in: code → user and when it stops working. Memory only. */
  private readonly codes = new Map<string, { userId: number; expires: number }>();
  /** Recent texts' ids, oldest first, so one Twilio sends again adds nothing. */
  private readonly sids: string[] = [];
  /** Each number's recent notes' times, and whether it's been told it's sending too many. */
  private readonly recent = new Map<string, { times: number[]; warned: boolean }>();
  /** Each user's tab emails' times in the last day. Memory only. */
  private readonly emailed = new Map<number, number[]>();

  constructor(
    private readonly config: SmsConfig,
    private readonly notebooks: Notebooks,
    private readonly live: LiveUpdates,
    private readonly push: PushReminders,
    private readonly sessionSecret: string,
    private readonly mailer: Mailer,
    private readonly sharing: Sharing,
  ) {}

  /** The webhook (signed by Twilio, no session) and the logged-in user's routes under /api/me/sms. */
  routers(): { webhook: express.Router; me: express.Router } {
    const users = this.notebooks.users;

    const webhook = express.Router();
    webhook.post(SMS_WEBHOOK_PATH, express.urlencoded({ extended: false, limit: "64kb" }), async (req: Request, res) => {
      const fields = Object.fromEntries(
        Object.entries((req.body ?? {}) as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      );
      // Twilio signs the address it posted to. That's normally publicUrl, but while the site moves to a new
      // name the webhook may still use the old one, so the address this request came in on is accepted too.
      // (Either way the signature needs the auth token, which only Twilio has.)
      const addresses = new Set([this.config.publicUrl + req.originalUrl, `${req.protocol}://${req.get("host") ?? ""}${req.originalUrl}`]);
      const given = req.get("X-Twilio-Signature");
      if (![...addresses].some((url) => signatureIsRight(twilioSignature(this.config.authToken, url, fields), given))) {
        logText(
          fields,
          given
            ? `refused (403): the signature doesn't match ${[...addresses].join(" or ")}. Check the auth token given to set-sms.sh is the account's current one.`
            : "refused (403): no Twilio signature, so it isn't from Twilio.",
        );
        res.status(403).type("text").send("Not signed by Twilio.");
        return;
      }
      twiml(res, await this.received(fields));
    });

    const me = express.Router();
    me.use(requireSession(users, this.sessionSecret));
    me.get("/", (_req, res) => {
      res.set("Cache-Control", "no-store");
      res.json(this.status(userOf(res)));
    });
    me.post("/link-code", (_req, res) => {
      res.set("Cache-Control", "no-store");
      res.json(this.makeCode(userOf(res).id));
    });
    me.delete("/", async (_req, res) => {
      await users.unlinkPhone(userOf(res).id);
      res.json(this.status(users.byId(userOf(res).id) ?? userOf(res)));
    });
    return { webhook, me };
  }

  private status(user: User): SmsStatus {
    const smsNumber = this.config.number;
    return user.smsPhoneNumber && user.smsLinkedDateTime
      ? { smsNumber, linked: true, phoneNumber: user.smsPhoneNumber, linkedDateTime: user.smsLinkedDateTime }
      : { smsNumber, linked: false };
  }

  /** A new 6-digit code for the user, replacing any earlier one of theirs that's still waiting. */
  private makeCode(userId: number): SmsLinkCode {
    const now = Date.now();
    for (const [code, waiting] of this.codes) {
      if (waiting.userId === userId || waiting.expires <= now) this.codes.delete(code);
    }
    let code: string;
    do code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    while (this.codes.has(code));
    const expires = now + CODE_LIFETIME_MS;
    this.codes.set(code, { userId, expires });
    return { code, smsNumber: this.config.number, expiresDateTime: new Date(expires).toISOString() };
  }

  /** A text that arrived: links a phone, adds a note, or is ignored. Returns the reply to text back, if any. */
  private async received(fields: Record<string, string>): Promise<string | undefined> {
    const log = (outcome: string) => logText(fields, outcome);
    const sid = fields.MessageSid;
    if (sid) {
      if (this.sids.includes(sid)) {
        log("ignored: already received (Twilio sent it again).");
        return undefined;
      }
      this.sids.push(sid);
      if (this.sids.length > SIDS_REMEMBERED) this.sids.shift();
    }
    const from = fields.From ?? "";
    const text = (fields.Body ?? "").trim();
    if (!from || !text) {
      log("ignored: empty.");
      return undefined;
    }

    const users = this.notebooks.users;
    if (!users.isReady()) {
      log("not saved: the database isn't loaded yet.");
      return users.byPhoneNumber(from) ? notSavedReply(text, "nwsnotes can't save right now. Please send it again later.") : undefined;
    }

    // A linking code.
    const waiting = /^\d{6}$/.test(text) ? this.codes.get(text) : undefined;
    if (waiting && waiting.expires > Date.now()) {
      this.codes.delete(text);
      try {
        await users.linkPhone(waiting.userId, from);
      } catch (error) {
        log(`couldn't link the phone to user ${waiting.userId}.`);
        console.error("Couldn't link a phone:", error);
        return undefined;
      }
      const confirm = users.byId(waiting.userId)?.smsConfirmations === true;
      log(`linking code: the phone is now linked to user ${waiting.userId}${confirm ? "; confirmed by text" : ""}.`);
      this.live.notifyChanged(waiting.userId, undefined);
      await this.push.notify(waiting.userId, {
        title: "Phone linked",
        body: `Notes texted from ${formatPhoneNumber(from)} will be added here.`,
        tag: "sms-linked",
      });
      return confirm ? LINKED_REPLY : undefined;
    }

    const user = users.byPhoneNumber(from);
    if (!user) {
      log(
        /^\d{6}$/.test(text)
          ? "ignored: a linking code that isn't waiting (wrong, already used, or older than 15 minutes). Make a new one in Settings."
          : "ignored: this phone isn't linked to anyone. Link it in Settings → Text messages.",
      );
      return undefined;
    }
    if (OPT_OUT_WORDS.has(text.toLowerCase())) {
      log(`ignored: an opt-out word, for user ${user.id}.`);
      return undefined;
    }

    // At most RATE_LIMIT notes in RATE_WINDOW_MS; the first text past it is told once, then they're ignored.
    const now = Date.now();
    const recent = this.recent.get(from) ?? { times: [], warned: false };
    recent.times = recent.times.filter((time) => time > now - RATE_WINDOW_MS);
    if (recent.times.length === 0) recent.warned = false;
    this.recent.set(from, recent);
    if (recent.times.length >= RATE_LIMIT) {
      if (recent.warned) {
        log(`ignored: too many texts from user ${user.id}.`);
        return undefined;
      }
      recent.warned = true;
      log(`not saved: too many texts from user ${user.id}; told them.`);
      return this.failed(user.id, text, "too many texts. Wait a few minutes and try again.");
    }
    recent.times.push(now);

    if (user.disabled) {
      log(`not saved: user ${user.id}'s account is turned off.`);
      return this.failed(user.id, text, "your nwsnotes account is turned off.");
    }
    // Every text starts with a command word; one that doesn't is a note with no tags.
    const command = readSmsCommand(text);
    switch (command.command) {
      case "due":
        return this.setDue(user, command.when, log);
      case "email-tab":
        return this.emailTab(user, command.named, log);
      case "reset-new":
        return this.resetNew(user, log);
      case "new":
        if (command.title === "") {
          log(`not saved: nothing after "New", for user ${user.id}.`);
          return "Nothing to save after New.";
        }
        return this.addNote(user, text, undefined, command.title, undefined, log);
      case "add":
        return this.addToTab(user, text, command.rest, log);
      case "none":
        return this.addNote(user, text, undefined, matchSpokenTab<Tab>(text, []).title, "It didn't start with a command, so it has no tags.", log);
    }
  }

  /**
   * "Add <tab name> <title>": a note in the tab named first. When no tab's name matches, everything
   * after "Add" (the name included) is the title, with no tags.
   */
  private async addToTab(user: User, text: string, rest: string, log: (outcome: string) => void): Promise<string | undefined> {
    if (rest === "") {
      log(`not saved: nothing after "Add", for user ${user.id}.`);
      return "Nothing to save after Add.";
    }
    let tabs: Tab[];
    try {
      tabs = (await this.notebooks.for(user.id)).getAll().tabs;
    } catch (error) {
      log(`not saved: an error (below) reading user ${user.id}'s tabs.`);
      console.error(`Couldn't read user ${user.id}'s tabs:`, error);
      return this.failed(user.id, text, "nwsnotes can't save right now. Please send it again later.");
    }
    const { tab, title } = matchSpokenTab<Tab>(rest, tabs);
    if (tab && title === "") {
      log(`not saved: only tab ${tab.id}'s name, for user ${user.id}.`);
      return "Nothing to save after the tab name.";
    }
    return this.addNote(user, text, tab, title, tab ? undefined : "No tab matched, so it has no tags.", log);
  }

  /**
   * Adds a texted note to the user's notebook, with the tab's tags (none without a tab). `text` is the
   * whole text, for failure replies; `untagged` says in the notification why a note without a tab has no tags.
   */
  private async addNote(
    user: User,
    text: string,
    tab: Tab | undefined,
    fullTitle: string,
    untagged: string | undefined,
    log: (outcome: string) => void,
  ): Promise<string | undefined> {
    try {
      const { title, cut } = cutToLimit(fullTitle);
      // The first tag of each category the tab filters on (they're in the category's tag order). Lifetime
      // isn't set: new notes are always New. A tab of tags shared with the user adds to their owner's
      // notebook, which needs one shared tag chosen: a text can't choose between several.
      const shared = tab?.categories.find((filter) => filter.categoryId === SHARED_CATEGORY_ID);
      if (shared && shared.tagIds.length > 1) {
        log(`not saved: tab ${tab!.id} has several shared tags, for user ${user.id}.`);
        return this.failed(user.id, text, `the tab "${tab!.name}" has several tags shared with you, so a text can't choose one. Add it in the app.`);
      }
      const tagIds = shared
        ? shared.tagIds
        : (tab?.categories ?? []).filter((filter) => filter.categoryId !== LIFETIME_CATEGORY_ID).flatMap((filter) => filter.tagIds.slice(0, 1));
      let added;
      try {
        added = await actingUser.run({ userId: user.id, displayName: user.displayName }, () =>
          this.sharing.addNote(user, { titleText: title }, tagIds, undefined, undefined, { source: "sms" }),
        );
      } catch (error) {
        const status = (error as { status?: unknown }).status;
        // Refused for sharing's reasons (e.g. a read-only shared tag, or the owner's notebook being full).
        if (shared && (status === 400 || status === 403 || status === 409)) {
          log(`not saved: refused (${String(status)}) adding to a shared tag, for user ${user.id}.`);
          const message = (error as Error).message;
          return this.failed(user.id, text, `${message.charAt(0).toLowerCase()}${message.slice(1)}`);
        }
        throw error;
      }
      const { note } = added;
      this.live.notifyChanged(user.id, undefined);
      const confirm = user.smsConfirmations === true;
      log(`saved as user ${user.id}'s note ${note.id}, ${tab ? `in tab ${tab.id}` : "with no tab"}${confirm ? "; confirmed by text" : ""}.`);

      const lifetime = tab?.categories.find((filter) => filter.categoryId === LIFETIME_CATEGORY_ID);
      const notes = [
        !tab && untagged,
        lifetime && !lifetime.tagIds.includes(LIFETIME_NEW) && "This tab doesn't show New notes.",
        cut && "It was too long and has been cut short.",
      ].filter((line): line is string => typeof line === "string");
      await this.push.notify(user.id, {
        title: `Saved to ${tab?.name ?? "All"}`,
        body: [title, ...notes].join("\n"),
        tag: `sms-note-${note.id}`,
      });
      return confirm ? savedReply(tab?.name ?? "All", title, cut) : undefined;
    } catch (error) {
      const status = (error as { status?: unknown }).status;
      if (status === 409) {
        log(`not saved: user ${user.id} is at their note limit.`);
        return this.failed(user.id, text, `you've reached your limit of ${noteLimitOf(user)} notes.`);
      }
      log(`not saved: an error (below) adding user ${user.id}'s note.`);
      console.error(`Couldn't add user ${user.id}'s texted note:`, error);
      return this.failed(user.id, text, "nwsnotes can't save right now. Please send it again later.");
    }
  }

  /** "Reset New": the user's New notes become Active, with the shared ones they may edit (as the Settings button). */
  private async resetNew(user: User, log: (outcome: string) => void): Promise<string | undefined> {
    let count: number;
    try {
      count = await actingUser.run({ userId: user.id, displayName: user.displayName }, () => this.sharing.bulkLifetime(user, "reset-new", undefined));
    } catch (error) {
      log(`not reset: an error (below) resetting user ${user.id}'s New notes.`);
      console.error(`Couldn't reset user ${user.id}'s New notes by text:`, error);
      const reply = "Not reset: nwsnotes can't save right now. Please send it again later.";
      try {
        await this.push.notify(user.id, { title: "New notes not reset", body: reply.replace(/^Not reset: n/, "N"), tag: `sms-reset-new-${Date.now()}` });
      } catch (notifyError) {
        console.error("Couldn't send a notification:", notifyError);
      }
      return reply;
    }
    if (count > 0) this.live.notifyChanged(user.id, undefined);
    const confirm = user.smsConfirmations === true;
    log(`reset New: ${count} of user ${user.id}'s notes made Active${confirm ? "; confirmed by text" : ""}.`);
    await this.push.notify(user.id, {
      title: "Reset New",
      body: count === 0 ? "There were no New notes." : `${count === 1 ? "1 note" : `${count} notes`} made Active.`,
      tag: `sms-reset-new-${Date.now()}`,
    });
    return confirm ? resetNewReply(count) : undefined;
  }

  /** "Email tab <name>": emails the user a summary of the notes that tab shows. Texts back only if it couldn't. */
  private async emailTab(user: User, named: string, log: (outcome: string) => void): Promise<string | undefined> {
    if (!this.mailer.enabled) {
      log(`not emailed: email isn't set up, for user ${user.id}.`);
      return this.notEmailed(user.id, "email isn't set up on nwsnotes.");
    }
    if (!isValidLoginName(user.loginName)) {
      log(`not emailed: user ${user.id}'s login isn't an email address.`);
      return this.notEmailed(user.id, "your login isn't an email address. Ask the admin to change it.");
    }
    const now = Date.now();
    const sent = (this.emailed.get(user.id) ?? []).filter((time) => time > now - DAY_MS);
    this.emailed.set(user.id, sent);
    if (sent.length >= EMAILS_PER_DAY) {
      log(`not emailed: user ${user.id} has had ${EMAILS_PER_DAY} tab emails today.`);
      return this.notEmailed(user.id, `you've had ${EMAILS_PER_DAY} tab emails in the last day. Try again later.`);
    }
    try {
      // With the notes shared with them, as the app shows the tab.
      const data = await this.sharing.dataFor(user.id);
      const tab = emailTabTarget<Tab>(named, data.tabs);
      if (!tab) {
        log(`not emailed: no tab matched, for user ${user.id}.`);
        return this.notEmailed(user.id, undefined, named);
      }
      const email = tabSummaryEmail(tab, data, { email: user.loginName, name: user.displayName }, this.config.publicUrl);
      await this.mailer.send(email);
      sent.push(now);
      const tabName = tab === "all" ? "All" : tab.name;
      const confirm = user.smsConfirmations === true;
      log(`emailed ${tab === "all" ? "the All tab" : `tab ${tab.id}`} (${email.noteCount} notes) to user ${user.id}${confirm ? "; confirmed by text" : ""}.`);
      await this.push.notify(user.id, {
        title: `Emailed ${tabName}`,
        body: `${email.noteCount === 1 ? "1 note" : `${email.noteCount} notes`}, sent to ${user.loginName}.`,
        tag: `sms-emailed-${now}`,
      });
      return confirm ? emailedReply(tabName, email.noteCount, user.loginName) : undefined;
    } catch (error) {
      log(`not emailed: an error (below) emailing user ${user.id}'s tab.`);
      console.error(`Couldn't email user ${user.id}'s tab:`, error);
      return this.notEmailed(user.id, "nwsnotes couldn't send the email. Please try again later.");
    }
  }

  /**
   * "Due <when>": sets the due date of the note the user added last, if that was in the last 5 minutes
   * (by text or in the app). Notes others added in the user's notebook don't count. Texts back only if it
   * couldn't (or with confirmations on).
   */
  private async setDue(user: User, when: string, log: (outcome: string) => void): Promise<string | undefined> {
    if (when === "") {
      log(`due date not set: no date or time given, for user ${user.id}.`);
      return this.dueNotSet(user.id, 'Not set: say when it\'s due, e.g. "Due tomorrow 3pm".');
    }
    try {
      const now = new Date();
      // Their own notebook and those shared with them: a note they added with a shared tag is in its owner's.
      const { notes } = await this.sharing.dataFor(user.id);
      const last = notes
        .filter((note) => note.createdByUserId === user.id)
        .reduce<Note | undefined>(
          (latest, note) =>
            !latest || note.createdDateTime > latest.createdDateTime || (note.createdDateTime === latest.createdDateTime && note.id > latest.id)
              ? note
              : latest,
          undefined,
        );
      if (!last || now.getTime() - Date.parse(last.createdDateTime) > DUE_WINDOW_MS) {
        log(`due date not set: user ${user.id} hasn't added a note in the last 5 minutes.`);
        return this.dueNotSet(user.id, "Not set: you haven't added a note in the last 5 minutes.");
      }
      if (last.shared) {
        log(`due date not set: user ${user.id}'s last note ${last.id} is in user ${last.shared.ownerId}'s notebook.`);
        const reply = `Not set: your last note is in ${last.shared.ownerName}'s notebook, so only they can set its due date.`;
        return this.dueNotSet(user.id, fitsOneSms(reply) ? reply : "Not set: your last note is in someone else's notebook, so only they can set its due date.");
      }
      const read = readSpokenDue(when, now);
      if (!read.ok) {
        log(`due date not set: ${read.reason === "past" ? "the date and time has passed" : "the date and time wasn't understood"}, for user ${user.id}.`);
        return this.dueNotSet(
          user.id,
          read.reason === "past" ? `Not set: ${formatSpokenDue(read.dueDateTime, now)} has already passed.` : dueNotUnderstoodReply(when),
        );
      }
      const store = await this.notebooks.for(user.id);
      const note = await actingUser.run({ userId: user.id, displayName: user.displayName }, () =>
        store.setDueDate(last.id, read.dueDateTime, { source: "sms" }),
      );
      this.live.notifyChanged(user.id, undefined);
      const confirm = user.smsConfirmations === true;
      log(`due date set on user ${user.id}'s note ${note.id}${confirm ? "; confirmed by text" : ""}.`);
      const due = formatSpokenDue(read.dueDateTime, now);
      const title = note.titleText !== undefined ? withoutMarkers(note.titleText) : "[Handwritten note]";
      await this.push.notify(user.id, { title: `Due ${due}`, body: title, tag: `sms-due-${note.id}` });
      return confirm ? dueSetReply(due, title) : undefined;
    } catch (error) {
      log(`due date not set: an error (below) setting user ${user.id}'s due date.`);
      console.error(`Couldn't set user ${user.id}'s due date by text:`, error);
      return this.dueNotSet(user.id, "Not set: nwsnotes can't save right now. Please send it again later.");
    }
  }

  /** A due date that wasn't set: a notification saying why, and the reply to text back (one SMS). */
  private async dueNotSet(userId: number, reply: string): Promise<string> {
    try {
      await this.push.notify(userId, { title: "Due date not set", body: reply.replace(/^Not set: (.)/, (_all, first: string) => first.toUpperCase()), tag: `sms-due-not-set-${Date.now()}` });
    } catch (error) {
      console.error("Couldn't send a notification:", error);
    }
    return reply;
  }

  /**
   * A tab email that wasn't sent: a notification saying why, and the reply to text back (one SMS). With
   * `named` (no tab matched), the reply quotes the name heard, cut short to fit.
   */
  private async notEmailed(userId: number, reason: string | undefined, named = ""): Promise<string> {
    // The name as heard, without the optional word "tab" in front.
    const heard = named.trim().replace(/\s+/g, " ").replace(/^tab\b[\s,:;.-]*/i, "");
    const make = (quoted: string) => `Not emailed: no tab called "${quoted}".`;
    let reply =
      reason !== undefined ? `Not emailed: ${reason}` : heard === "" ? 'Not emailed: say which tab, e.g. "Email tab Shopping".' : make(heard);
    if (reason === undefined && heard !== "" && !fitsOneSms(reply)) {
      const chars = [...heard];
      let length = chars.length - 1;
      while (length > 0 && !fitsOneSms(make(`${chars.slice(0, length).join("").trimEnd()}...`))) length--;
      reply = length > 0 ? make(`${chars.slice(0, length).join("").trimEnd()}...`) : "Not emailed: no tab has that name.";
    }
    try {
      await this.push.notify(userId, { title: "Not emailed", body: reply.replace(/^Not emailed: /, ""), tag: `sms-not-emailed-${Date.now()}` });
    } catch (error) {
      console.error("Couldn't send a notification:", error);
    }
    return reply;
  }

  /** A note that wasn't saved: the reply to text back, and a notification with all of its text. */
  private async failed(userId: number, text: string, reason: string): Promise<string> {
    try {
      await this.push.notify(userId, { title: "Not saved", body: `${text}\n\n${reason.charAt(0).toUpperCase()}${reason.slice(1)}`, tag: `sms-failed-${Date.now()}` });
    } catch (error) {
      console.error("Couldn't send a notification:", error);
    }
    return notSavedReply(text, reason);
  }

  /** End-to-end tests only: forgets the codes, texts and counts, so each test starts afresh. */
  resetForTests(): void {
    this.codes.clear();
    this.sids.length = 0;
    this.recent.clear();
    this.emailed.clear();
  }
}
