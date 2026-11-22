import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import express, { type Request, type Response } from "express";
import {
  LIFETIME_CATEGORY_ID,
  LIFETIME_NEW,
  TITLE_MAX_LENGTH,
  formatPhoneNumber,
  appCommandOf,
  isAppCommand,
  matchSpokenTab,
  noteMatchesFilters,
  notSavedReply,
  orderNotes,
  unknownCommandReply,
  type SmsLinkCode,
  type SmsStatus,
  type Tab,
} from "@nwsnotes/shared";
import { requireSession, userOf } from "./auth.js";
import type { SmsConfig } from "./config.js";
import type { LiveUpdates } from "./live.js";
import type { Notebooks } from "./notebooks.js";
import type { PushReminders } from "./push.js";
import type { NoteStore } from "./store.js";
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
 * its first words name. Each saved note gets a notification; a note that couldn't be saved gets a text back.
 */
export class SmsNotes {
  /** Linking codes waiting to be texted in: code → user and when it stops working. Memory only. */
  private readonly codes = new Map<string, { userId: number; expires: number }>();
  /** Recent texts' ids, oldest first, so one Twilio sends again adds nothing. */
  private readonly sids: string[] = [];
  /** Each number's recent notes' times, and whether it's been told it's sending too many. */
  private readonly recent = new Map<string, { times: number[]; warned: boolean }>();

  constructor(
    private readonly config: SmsConfig,
    private readonly notebooks: Notebooks,
    private readonly live: LiveUpdates,
    private readonly push: PushReminders,
    private readonly sessionSecret: string,
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
            ? `refused (403): the signature doesn't match ${[...addresses].join(" or ")}. Check the auth token given to set-sms.sh is the current one for the region the number's texts are handled in (e.g. Ireland (IE1)'s own token).`
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
      log(`linking code: the phone is now linked to user ${waiting.userId}.`);
      this.live.notifyChanged(waiting.userId, undefined);
      await this.push.notify(waiting.userId, {
        title: "Phone linked",
        body: `Notes texted from ${formatPhoneNumber(from)} will be added here.`,
        tag: "sms-linked",
      });
      return undefined;
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

    // A text starting "App" is a command, not a note.
    const command = appCommandOf(text);
    const outcome = command === undefined ? "Not saved" : "Not done";
    const notDone = command === undefined ? "not saved" : "not done";

    // At most RATE_LIMIT texts in RATE_WINDOW_MS; the first text past it is told once, then they're ignored.
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
      log(`${notDone}: too many texts from user ${user.id}; told them.`);
      return this.failed(user.id, text, "too many texts. Wait a few minutes and try again.", outcome);
    }
    recent.times.push(now);

    if (user.disabled) {
      log(`${notDone}: user ${user.id}'s account is turned off.`);
      return this.failed(user.id, text, "your nwsnotes account is turned off.", outcome);
    }
    if (command !== undefined) return this.runCommand(user, command, text, log);
    return this.addNote(user, text, log);
  }

  /** A text starting "App": carries out the command, or texts back that there's no such command. */
  private async runCommand(user: User, command: string, text: string, log: (outcome: string) => void): Promise<string | undefined> {
    if (!isAppCommand(command)) {
      // The words aren't logged: they could be a mistyped note.
      log(`unknown command for user ${user.id}.`);
      const reply = unknownCommandReply(command);
      await this.notifySafely(user.id, { title: "Not done", body: `${text}\n\n${reply}`, tag: `sms-failed-${Date.now()}` });
      return reply;
    }
    try {
      const store = await this.notebooks.for(user.id);
      // "reset new", the only command so far: every New note becomes Active, as Settings' "Reset New" does.
      const count = await store.resetNew();
      if (count > 0) this.live.notifyChanged(user.id, undefined);
      log(`command "${command}" for user ${user.id}: ${count} note${count === 1 ? "" : "s"} made Active.`);
      await this.notifySafely(user.id, {
        title: `App: ${command}`,
        body: count === 0 ? "There were no New notes." : `${count} note${count === 1 ? "" : "s"} changed to Active.`,
        tag: `sms-command-${Date.now()}`,
      });
      return undefined;
    } catch (error) {
      log(`not done: an error (below) running "${command}" for user ${user.id}.`);
      console.error(`Couldn't run user ${user.id}'s texted command:`, error);
      return this.failed(user.id, text, "nwsnotes can't do that right now. Please send it again later.", "Not done");
    }
  }

  /** A notification, where a failure to send it is only logged. */
  private async notifySafely(userId: number, message: { title: string; body: string; tag: string }): Promise<void> {
    try {
      await this.push.notify(userId, message);
    } catch (error) {
      console.error("Couldn't send a notification:", error);
    }
  }

  /** Adds the texted note to the user's notebook, in the tab its first words name. */
  private async addNote(user: User, text: string, log: (outcome: string) => void): Promise<string | undefined> {
    try {
      const store = await this.notebooks.for(user.id);
      const { tabs } = store.getAll();
      const { tab, title: spokenTitle, top } = matchSpokenTab<Tab>(text, tabs);
      if (tab && spokenTitle === "") {
        log(`not saved: only tab ${tab.id}'s name, for user ${user.id}.`);
        return "Nothing to save after the tab name.";
      }
      const { title, cut } = cutToLimit(spokenTitle);
      // The first tag of each category the tab filters on (they're in the category's tag order). Lifetime
      // isn't set: new notes are always New.
      const tagIds = (tab?.categories ?? []).filter((filter) => filter.categoryId !== LIFETIME_CATEGORY_ID).flatMap((filter) => filter.tagIds.slice(0, 1));
      const { note } = await store.add({ titleText: title }, tagIds, undefined, undefined, { noteLimit: noteLimitOf(user), source: "sms" });
      // "top" after the tab's name: moved to the top of the tab, as adding at the top does in the app. If
      // that fails, the note stays at the bottom, and the notification says so.
      let atTop = false;
      if (tab && top) {
        try {
          await this.moveToTopOfTab(store, note.id, tab);
          atTop = true;
        } catch (error) {
          console.error(`Couldn't put user ${user.id}'s texted note ${note.id} at the top:`, error);
        }
      }
      this.live.notifyChanged(user.id, undefined);
      log(
        `saved as user ${user.id}'s note ${note.id}, ${tab ? `in tab ${tab.id}` : "with no tab"}${
          atTop ? ", at the top" : top ? ", at the bottom: putting it at the top failed (below)" : ""
        }.`,
      );

      const lifetime = tab?.categories.find((filter) => filter.categoryId === LIFETIME_CATEGORY_ID);
      const notes = [
        !tab && "No tab matched, so it has no tags.",
        lifetime && !lifetime.tagIds.includes(LIFETIME_NEW) && "This tab doesn't show New notes.",
        cut && "It was too long and has been cut short.",
        top && !atTop && "It couldn't be put at the top, so it's at the bottom.",
      ].filter((line): line is string => typeof line === "string");
      await this.push.notify(user.id, {
        title: atTop ? `Saved to the top of ${tab!.name}` : `Saved to ${tab?.name ?? "All"}`,
        body: [title, ...notes].join("\n"),
        tag: `sms-note-${note.id}`,
      });
      return undefined;
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

  /**
   * Puts a note at the top of a tab, as adding at the top does in the app: the shared order is saved with
   * it straight before the first note the tab lists (by its own filter, in the shared order), or at the
   * very front if the tab lists none.
   */
  private async moveToTopOfTab(store: NoteStore, noteId: number, tab: Tab): Promise<void> {
    const { notes, noteOrder } = store.getAll();
    const order = orderNotes(notes, noteOrder)
      .map((note) => note.id)
      .filter((id) => id !== noteId);
    const first = orderNotes(
      notes.filter((note) => note.id !== noteId && noteMatchesFilters(note, tab.categories)),
      noteOrder,
    )[0];
    const at = first ? Math.max(0, order.indexOf(first.id)) : 0;
    await store.setNoteOrder({ noteOrder: [...order.slice(0, at), noteId, ...order.slice(at)] });
  }

  /** A note that wasn't saved: the reply to text back, and a notification with all of its text. */
  private async failed(userId: number, text: string, reason: string, outcome = "Not saved"): Promise<string> {
    await this.notifySafely(userId, {
      title: outcome,
      body: `${text}\n\n${reason.charAt(0).toUpperCase()}${reason.slice(1)}`,
      tag: `sms-failed-${Date.now()}`,
    });
    return notSavedReply(text, reason, outcome);
  }

  /** End-to-end tests only: forgets the codes, texts and counts, so each test starts afresh. */
  resetForTests(): void {
    this.codes.clear();
    this.sids.length = 0;
    this.recent.clear();
  }
}
