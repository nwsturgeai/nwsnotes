import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import express, { type Request, type Response } from "express";
import {
  LIFETIME_CATEGORY_ID,
  LIFETIME_NEW,
  TITLE_MAX_LENGTH,
  formatPhoneNumber,
  matchSpokenTab,
  notSavedReply,
  type SmsLinkCode,
  type SmsStatus,
  type Tab,
} from "@nwsnotes/shared";
import { requireSession, userOf } from "./auth.js";
import type { SmsConfig } from "./config.js";
import type { LiveUpdates } from "./live.js";
import type { Notebooks } from "./notebooks.js";
import type { PushReminders } from "./push.js";
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
    const sid = fields.MessageSid;
    if (sid) {
      if (this.sids.includes(sid)) return undefined;
      this.sids.push(sid);
      if (this.sids.length > SIDS_REMEMBERED) this.sids.shift();
    }
    const from = fields.From ?? "";
    const text = (fields.Body ?? "").trim();
    if (!from || !text) return undefined;

    const users = this.notebooks.users;
    if (!users.isReady()) return users.byPhoneNumber(from) ? notSavedReply(text, "nwsnotes can't save right now. Please send it again later.") : undefined;

    // A linking code.
    const waiting = /^\d{6}$/.test(text) ? this.codes.get(text) : undefined;
    if (waiting && waiting.expires > Date.now()) {
      this.codes.delete(text);
      try {
        await users.linkPhone(waiting.userId, from);
      } catch (error) {
        console.error("Couldn't link a phone:", error);
        return undefined;
      }
      this.live.notifyChanged(waiting.userId, undefined);
      await this.push.notify(waiting.userId, {
        title: "Phone linked",
        body: `Notes texted from ${formatPhoneNumber(from)} will be added here.`,
        tag: "sms-linked",
      });
      return undefined;
    }

    const user = users.byPhoneNumber(from);
    if (!user || OPT_OUT_WORDS.has(text.toLowerCase())) return undefined;

    // At most RATE_LIMIT notes in RATE_WINDOW_MS; the first text past it is told once, then they're ignored.
    const now = Date.now();
    const recent = this.recent.get(from) ?? { times: [], warned: false };
    recent.times = recent.times.filter((time) => time > now - RATE_WINDOW_MS);
    if (recent.times.length === 0) recent.warned = false;
    this.recent.set(from, recent);
    if (recent.times.length >= RATE_LIMIT) {
      if (recent.warned) return undefined;
      recent.warned = true;
      return this.failed(user.id, text, "too many texts. Wait a few minutes and try again.");
    }
    recent.times.push(now);

    if (user.disabled) return this.failed(user.id, text, "your nwsnotes account is turned off.");
    return this.addNote(user, text);
  }

  /** Adds the texted note to the user's notebook, in the tab its first words name. */
  private async addNote(user: User, text: string): Promise<string | undefined> {
    try {
      const store = await this.notebooks.for(user.id);
      const { tabs } = store.getAll();
      const { tab, title: spokenTitle } = matchSpokenTab<Tab>(text, tabs);
      if (tab && spokenTitle === "") return "Nothing to save after the tab name.";
      const { title, cut } = cutToLimit(spokenTitle);
      // The first tag of each category the tab filters on (they're in the category's tag order). Lifetime
      // isn't set: new notes are always New.
      const tagIds = (tab?.categories ?? []).filter((filter) => filter.categoryId !== LIFETIME_CATEGORY_ID).flatMap((filter) => filter.tagIds.slice(0, 1));
      const { note } = await store.add({ titleText: title }, tagIds, undefined, undefined, { noteLimit: noteLimitOf(user), source: "sms" });
      this.live.notifyChanged(user.id, undefined);

      const lifetime = tab?.categories.find((filter) => filter.categoryId === LIFETIME_CATEGORY_ID);
      const notes = [
        !tab && "No tab matched, so it has no tags.",
        lifetime && !lifetime.tagIds.includes(LIFETIME_NEW) && "This tab doesn't show New notes.",
        cut && "It was too long and has been cut short.",
      ].filter((line): line is string => typeof line === "string");
      await this.push.notify(user.id, {
        title: `Saved to ${tab?.name ?? "All"}`,
        body: [title, ...notes].join("\n"),
        tag: `sms-note-${note.id}`,
      });
      return undefined;
    } catch (error) {
      const status = (error as { status?: unknown }).status;
      if (status === 409) return this.failed(user.id, text, `you've reached your limit of ${noteLimitOf(user)} notes.`);
      console.error(`Couldn't add user ${user.id}'s texted note:`, error);
      return this.failed(user.id, text, "nwsnotes can't save right now. Please send it again later.");
    }
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
