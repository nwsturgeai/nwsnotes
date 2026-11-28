import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import express, { type Request, type Response } from "express";
import {
  LINKED_REPLY,
  dueNotUnderstoodReply,
  dueSetReply,
  emailedReply,
  fitsOneSms,
  formatPhoneNumber,
  formatSpokenDue,
  notSavedReply,
  resetNewReply,
  savedReply,
  type SmsLinkCode,
  type SmsStatus,
} from "@nwsnotes/shared";
import { requireSession, userOf } from "./auth.js";
import type { SmsConfig } from "./config.js";
import type { DictatedCommands, DictationOutcome, DueNotSet } from "./dictation.js";
import type { LiveUpdates } from "./live.js";
import type { Notebooks } from "./notebooks.js";
import type { PushReminders } from "./push.js";
import type { User } from "./users.js";

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

/** The text back for a due date that wasn't set (one SMS). */
function dueNotSetReply(reason: DueNotSet, now: Date): string {
  switch (reason.why) {
    case "no-when":
      return 'Not set: say when it\'s due, e.g. "Due tomorrow 3pm".';
    case "none-recent":
      return "Not set: you haven't added a note in the last 5 minutes.";
    case "someone-else": {
      const reply = `Not set: your last note is in ${reason.ownerName}'s notebook, so only they can set its due date.`;
      return fitsOneSms(reply) ? reply : "Not set: your last note is in someone else's notebook, so only they can set its due date.";
    }
    case "past":
      return `Not set: ${formatSpokenDue(reason.dueDateTime, now)} has already passed.`;
    case "not-understood":
      return dueNotUnderstoodReply(reason.heard);
    case "error":
      return "Not set: nwsnotes can't save right now. Please send it again later.";
  }
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

  constructor(
    private readonly config: SmsConfig,
    private readonly notebooks: Notebooks,
    private readonly live: LiveUpdates,
    private readonly push: PushReminders,
    private readonly sessionSecret: string,
    /** Carries out each text's command (shared with Alexa). */
    private readonly commands: DictatedCommands,
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

    const confirmed = user.smsConfirmations === true;
    const outcome = await this.commands.run(user, text, { source: "sms", log, confirmed: confirmed ? "; confirmed by text" : "" });
    return this.replyTo(user, text, outcome, confirmed);
  }

  /** What a command's outcome sends: the notification, and the text back (for failures, or with confirmations on). */
  private async replyTo(user: User, text: string, outcome: DictationOutcome, confirm: boolean): Promise<string | undefined> {
    const now = new Date();
    switch (outcome.kind) {
      case "nothing-after":
        return `Nothing to save after ${outcome.after}.`;
      case "not-saved":
        return this.failed(user.id, text, outcome.reason);
      case "saved": {
        const { tab, title, cut } = outcome;
        const lines = [
          outcome.untagged,
          outcome.hidesNew && "This tab doesn't show New notes.",
          cut && "It was too long and has been cut short.",
        ].filter((line): line is string => typeof line === "string");
        await this.push.notify(user.id, {
          title: `Saved to ${tab?.name ?? "All"}`,
          body: [title, ...lines].join("\n"),
          tag: `sms-note-${outcome.noteId}`,
        });
        return confirm ? savedReply(tab?.name ?? "All", title, cut) : undefined;
      }
      case "not-reset": {
        const reply = "Not reset: nwsnotes can't save right now. Please send it again later.";
        try {
          await this.push.notify(user.id, { title: "New notes not reset", body: reply.replace(/^Not reset: n/, "N"), tag: `sms-reset-new-${Date.now()}` });
        } catch (notifyError) {
          console.error("Couldn't send a notification:", notifyError);
        }
        return reply;
      }
      case "reset": {
        const { count } = outcome;
        await this.push.notify(user.id, {
          title: "Reset New",
          body: count === 0 ? "There were no New notes." : `${count === 1 ? "1 note" : `${count} notes`} made Active.`,
          tag: `sms-reset-new-${Date.now()}`,
        });
        return confirm ? resetNewReply(count) : undefined;
      }
      case "not-emailed":
        return this.notEmailed(user.id, outcome.reason, outcome.named);
      case "emailing": {
        const sent = await outcome.sent;
        if (sent.kind === "not-emailed") return this.notEmailed(user.id, sent.reason, sent.named);
        await this.push.notify(user.id, {
          title: `Emailed ${sent.tabName}`,
          body: `${sent.noteCount === 1 ? "1 note" : `${sent.noteCount} notes`}, sent to ${sent.email}.`,
          tag: `sms-emailed-${Date.now()}`,
        });
        return confirm ? emailedReply(sent.tabName, sent.noteCount, sent.email) : undefined;
      }
      case "due-set": {
        const due = formatSpokenDue(outcome.dueDateTime, now);
        await this.push.notify(user.id, { title: `Due ${due}`, body: outcome.title, tag: `sms-due-${outcome.noteId}` });
        return confirm ? dueSetReply(due, outcome.title) : undefined;
      }
      case "due-not-set":
        return this.dueNotSet(user.id, dueNotSetReply(outcome.reason, now));
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
  }
}
