import { randomInt } from "node:crypto";
import express, { type Request, type Response } from "express";
import { alexaCommandText, spokenDueForSpeech, type AlexaLinkCode, type AlexaStatus } from "@nwsnotes/shared";
import { requireSession, userOf } from "./auth.js";
import type { AlexaConfig } from "./config.js";
import type { DictatedCommands, DictationOutcome, DueNotSet, EmailOutcome } from "./dictation.js";
import type { LiveUpdates } from "./live.js";
import type { Notebooks } from "./notebooks.js";
import type { PushReminders } from "./push.js";
import type { AlexaVerifier } from "./alexaVerify.js";
import type { User } from "./users.js";

/** Where Alexa sends each request for the skill. */
export const ALEXA_WEBHOOK_PATH = "/api/alexa";

/** How long a linking code works for. */
const CODE_LIFETIME_MS = 15 * 60 * 1000;
/** After this many wrong codes from one Alexa account in CODE_LIFETIME_MS, codes aren't checked for it. */
const WRONG_CODES_ALLOWED = 5;
/** At most this many commands in RATE_WINDOW_MS from one Alexa account. */
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 10 * 60 * 1000;

const NOT_LINKED = "This Alexa isn't linked to nwsnotes yet. In nwsnotes, go to Settings, Alexa, and press Link Alexa.";
const CANT_SAVE = "nwsnotes can't save right now. Please try again later.";
const WHAT_TO_ADD = "What would you like to add?";
const ANYTHING_ELSE = "Anything else?";
const NOT_CAUGHT =
  "Sorry, I didn't catch that. Start with add, new, due, reset new or email tab. For example: add Shopping oat milk.";
const HELP =
  "Say add, then a tab's name and the note, for example: add Shopping oat milk. Or new, then a note with no tags. " +
  "Or due, then when the note you just added is due, for example: due tomorrow at 3pm. You can also say reset new, " +
  "or email tab, then a tab's name.";

/** The parts of an Alexa request that are used (see Amazon's "Request and Response JSON Reference"). */
interface AlexaRequest {
  session?: { new?: boolean; application?: { applicationId?: string }; user?: { userId?: string } };
  context?: { System?: { application?: { applicationId?: string }; user?: { userId?: string } } };
  request?: {
    type?: string;
    timestamp?: string;
    intent?: { name?: string; slots?: Record<string, { value?: string } | undefined> };
  };
}

/** What Alexa says back, and whether it keeps listening for another command. */
interface Answer {
  speech?: string;
  keepListening?: boolean;
}

/** An Alexa account's id for the logs: only its last 4 characters. */
function maskedId(alexaUserId: string | undefined): string {
  return alexaUserId ? `…${alexaUserId.slice(-4)}` : "(no user)";
}

/** A sentence ending with a full stop (or the question or exclamation mark it already has). */
function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** A reason from the shared commands ("you've reached …") as Alexa says it: capitalised, to be heard. */
function spokenReason(reason: string): string {
  const said = reason.replace("Please send it again later.", "Please try again later.");
  return said.charAt(0).toUpperCase() + said.slice(1);
}

/** Notes counted as Alexa says them: "1 note", "3 notes". */
function notesCount(count: number): string {
  return count === 1 ? "1 note" : `${count} notes`;
}

/** Why a due date wasn't set, as Alexa says it. */
function dueNotSetSpeech(reason: DueNotSet, now: Date): string {
  switch (reason.why) {
    case "no-when":
      return "Not set: say when it's due, for example: due tomorrow at 3pm.";
    case "none-recent":
      return "Not set: you haven't added a note in the last 5 minutes.";
    case "someone-else":
      return `Not set: your last note is in ${reason.ownerName}'s notebook, so only they can set its due date.`;
    case "not-understood":
      return `Not set: I couldn't understand ${reason.heard} as a date and time.`;
    case "past":
      return `Not set: ${spokenDueForSpeech(reason.dueDateTime, now)} has already passed.`;
    case "error":
      return `Not set: ${CANT_SAVE}`;
  }
}

/**
 * Adding notes by Alexa (see Specs/alexa.md): the "Nick Notes" skill sends what each person says to the
 * webhook; once their Alexa account is linked to an nwsnotes user, each command is carried out as a text's
 * would be (DictatedCommands), and Alexa says what happened, reading the note back.
 */
export class AlexaNotes {
  /** Linking codes waiting to be said: code → user and when it stops working. Memory only. */
  private readonly codes = new Map<string, { userId: number; expires: number }>();
  /** Each Alexa account's recent wrong codes' times. */
  private readonly wrongCodes = new Map<string, number[]>();
  /** Each Alexa account's recent commands' times. */
  private readonly recent = new Map<string, number[]>();
  /** Tab emails still being sent after Alexa has answered, so the tests can wait for them. */
  private readonly sending = new Set<Promise<void>>();

  constructor(
    private readonly config: AlexaConfig,
    private readonly notebooks: Notebooks,
    private readonly live: LiveUpdates,
    private readonly push: PushReminders,
    private readonly sessionSecret: string,
    private readonly commands: DictatedCommands,
    private readonly verifier: AlexaVerifier,
  ) {}

  /** The webhook (signed by Alexa, no session) and the logged-in user's routes under /api/me/alexa. */
  routers(): { webhook: express.Router; me: express.Router } {
    const users = this.notebooks.users;

    const webhook = express.Router();
    // The raw body, as the signature is of the bytes exactly as they arrived (so before the app's JSON parser).
    webhook.post(ALEXA_WEBHOOK_PATH, express.raw({ type: () => true, limit: "64kb" }), async (req: Request, res) => {
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      let body: AlexaRequest;
      try {
        body = JSON.parse(raw.toString("utf8")) as AlexaRequest;
      } catch {
        console.log("Alexa request refused (400): its body isn't JSON.");
        res.status(400).type("text").send("Not an Alexa request.");
        return;
      }
      const alexaUserId = body.context?.System?.user?.userId ?? body.session?.user?.userId;
      const refuse = (why: string) => {
        console.log(`Alexa ${maskedId(alexaUserId)}: refused (400): ${why}.`);
        res.status(400).type("text").send("Not a request from this skill.");
      };
      const problem = await this.verifier.problem(raw, req.get("SignatureCertChainUrl"), req.get("Signature-256"), body.request?.timestamp);
      if (problem) {
        refuse(problem);
        return;
      }
      const skillId = body.context?.System?.application?.applicationId ?? body.session?.application?.applicationId;
      if (skillId !== this.config.skillId) {
        refuse(`it's for another skill (${skillId ?? "none named"}), not ${this.config.skillId}. Check alexaSkillId (set-alexa.sh)`);
        return;
      }
      let answer: Answer;
      try {
        answer = await this.received(body, alexaUserId);
      } catch (error) {
        console.error("Couldn't answer an Alexa request:", error);
        answer = { speech: CANT_SAVE };
      }
      res.json(this.answerJson(answer));
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
      await users.unlinkAlexa(userOf(res).id);
      res.json(this.status(users.byId(userOf(res).id) ?? userOf(res)));
    });
    return { webhook, me };
  }

  private status(user: User): AlexaStatus {
    return user.alexaUserId && user.alexaLinkedDateTime ? { linked: true, linkedDateTime: user.alexaLinkedDateTime } : { linked: false };
  }

  /** A new 6-digit code for the user, replacing any earlier one of theirs that's still waiting. */
  private makeCode(userId: number): AlexaLinkCode {
    const now = Date.now();
    for (const [code, waiting] of this.codes) {
      if (waiting.userId === userId || waiting.expires <= now) this.codes.delete(code);
    }
    let code: string;
    do code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    while (this.codes.has(code));
    const expires = now + CODE_LIFETIME_MS;
    this.codes.set(code, { userId, expires });
    return { code, expiresDateTime: new Date(expires).toISOString() };
  }

  /** Alexa's JSON for an answer: what it says, and (when it keeps listening) what it asks if nothing's said. */
  private answerJson({ speech, keepListening = false }: Answer): object {
    const said = speech === undefined ? undefined : keepListening ? `${speech} ${speech === WHAT_TO_ADD ? "" : ANYTHING_ELSE}`.trim() : speech;
    return {
      version: "1.0",
      response: {
        ...(said !== undefined && { outputSpeech: { type: "PlainText", text: said } }),
        ...(keepListening && { reprompt: { outputSpeech: { type: "PlainText", text: speech === WHAT_TO_ADD ? WHAT_TO_ADD : ANYTHING_ELSE } } }),
        shouldEndSession: !keepListening,
      },
    };
  }

  /** A request from Alexa that's been checked: what to say back. */
  private async received(body: AlexaRequest, alexaUserId: string | undefined): Promise<Answer> {
    const type = body.request?.type;
    const intent = type === "IntentRequest" ? (body.request?.intent?.name ?? "") : type === "LaunchRequest" ? "LaunchRequest" : (type ?? "");
    const log = (outcome: string) => console.log(`Alexa ${maskedId(alexaUserId)}: ${intent}, ${outcome}`);
    // "Alexa, open Nick Notes" keeps listening for commands; "Alexa, ask Nick Notes to …" does one and stops.
    const inSession = type === "IntentRequest" && body.session?.new === false;

    if (type === "SessionEndedRequest") return {};
    if (!alexaUserId) {
      log("ignored: no Alexa user.");
      return {};
    }
    if (intent === "AMAZON.StopIntent" || intent === "AMAZON.CancelIntent" || intent === "AMAZON.NoIntent" || intent === "AMAZON.NavigateHomeIntent") {
      return {};
    }
    const users = this.notebooks.users;
    if (!users.isReady()) {
      log("not done: the database isn't loaded yet.");
      return { speech: CANT_SAVE };
    }
    if (intent === "LinkIntent") return this.link(alexaUserId, body.request?.intent?.slots?.code?.value, log);

    const user = users.byAlexaUserId(alexaUserId);
    if (!user) {
      log("not done: this Alexa isn't linked to anyone. Link it in Settings → Alexa.");
      return { speech: NOT_LINKED };
    }
    if (intent === "LaunchRequest") return { speech: WHAT_TO_ADD, keepListening: true };
    if (intent === "AMAZON.HelpIntent") return { speech: `${HELP} ${WHAT_TO_ADD}`, keepListening: true };

    const words = body.request?.intent?.slots?.words?.value?.trim() ?? "";
    const text = alexaCommandText(intent, words);
    if (text === undefined) {
      log(`not understood, for user ${user.id}.`);
      return { speech: NOT_CAUGHT, keepListening: inSession };
    }

    // At most RATE_LIMIT commands in RATE_WINDOW_MS.
    const now = Date.now();
    const times = (this.recent.get(alexaUserId) ?? []).filter((time) => time > now - RATE_WINDOW_MS);
    this.recent.set(alexaUserId, times);
    if (times.length >= RATE_LIMIT) {
      log(`not done: too many commands from user ${user.id}.`);
      return { speech: "Not done: too many in the last few minutes. Wait a few minutes and try again." };
    }
    times.push(now);

    const outcome = await this.commands.run(user, text, { source: "alexa", log });
    return { speech: await this.speechFor(user, words, outcome), keepListening: inSession };
  }

  /** "Link <code>": links this Alexa account to the user whose code it is. */
  private async link(alexaUserId: string, said: string | undefined, log: (outcome: string) => void): Promise<Answer> {
    const now = Date.now();
    const wrong = (this.wrongCodes.get(alexaUserId) ?? []).filter((time) => time > now - CODE_LIFETIME_MS);
    this.wrongCodes.set(alexaUserId, wrong);
    if (wrong.length >= WRONG_CODES_ALLOWED) {
      log("not linked: too many wrong codes.");
      return { speech: "Too many wrong codes. Wait a few minutes and make a new one in Settings." };
    }
    const digits = (said ?? "").replace(/\D/g, "");
    // A spoken "zero" in front may be dropped, as the slot is a number.
    const code = digits.length > 0 && digits.length <= 6 ? digits.padStart(6, "0") : "";
    const waiting = code ? this.codes.get(code) : undefined;
    if (!waiting || waiting.expires <= now) {
      wrong.push(now);
      log("not linked: a code that isn't waiting (wrong, already used, or older than 15 minutes).");
      return {
        speech: code
          ? "That code isn't right, or it's more than 15 minutes old. Make a new one in Settings and try again."
          : "Sorry, I didn't catch the code. Say link, then the 6 digits Settings shows.",
      };
    }
    this.codes.delete(code);
    await this.notebooks.users.linkAlexa(waiting.userId, alexaUserId);
    this.wrongCodes.delete(alexaUserId);
    log(`linked to user ${waiting.userId}.`);
    this.live.notifyChanged(waiting.userId, undefined);
    return { speech: "Linked. You can now add notes to nwsnotes." };
  }

  /** What Alexa says about a command's outcome, reading the note back; failures also go in a notification. */
  private async speechFor(user: User, heard: string, outcome: DictationOutcome): Promise<string> {
    const now = new Date();
    switch (outcome.kind) {
      case "saved":
        return [
          sentence(`Saved to ${outcome.tab?.name ?? "All"}: ${outcome.title}`),
          outcome.tab ? undefined : outcome.untagged === undefined ? undefined : "No tab matched, so it has no tags.",
          outcome.hidesNew ? "That tab doesn't show New notes." : undefined,
          outcome.cut ? "It was too long, so I cut it short." : undefined,
        ]
          .filter((part): part is string => part !== undefined)
          .join(" ");
      case "nothing-after":
        return outcome.after === "the tab name" ? "Nothing to save after the tab name." : `Nothing to save after ${outcome.after.toLowerCase()}.`;
      case "not-saved": {
        await this.notify(user.id, "Not saved", `${heard}\n\n${spokenReason(outcome.reason)}`, "alexa-failed");
        return `Not saved: ${sentence(heard)} ${spokenReason(outcome.reason)}`;
      }
      case "reset":
        return outcome.count === 0 ? "There were no New notes." : `${notesCount(outcome.count)} made Active.`;
      case "not-reset":
        return `Not reset: ${CANT_SAVE}`;
      case "emailing": {
        // Alexa answers straight away; how the email went comes as a notification.
        const done = outcome.sent.then((sent) => this.emailResult(user.id, sent)).catch((error: unknown) => console.error("Couldn't send a notification:", error));
        this.sending.add(done);
        void done.finally(() => this.sending.delete(done));
        return `Emailing ${outcome.tabName}.`;
      }
      case "not-emailed": {
        if (outcome.reason !== undefined) return `Not emailed: ${outcome.reason}`;
        const named = outcome.named.trim().replace(/^tab\b[\s,:;.-]*/i, "");
        return named === "" ? "Not emailed: say which tab, for example: email tab Shopping." : `Not emailed: there's no tab called ${named}.`;
      }
      case "due-set":
        return sentence(`${outcome.title}, due ${spokenDueForSpeech(outcome.dueDateTime, now)}`);
      case "due-not-set":
        return dueNotSetSpeech(outcome.reason, now);
    }
  }

  /** A tab email's result, as a notification (Alexa has already answered). */
  private async emailResult(userId: number, sent: EmailOutcome): Promise<void> {
    if (sent.kind === "emailed") {
      await this.notify(userId, `Emailed ${sent.tabName}`, `${notesCount(sent.noteCount)}, sent to ${sent.email}.`, "alexa-emailed");
    } else {
      await this.notify(userId, "Not emailed", spokenReason(sent.reason), "alexa-not-emailed");
    }
  }

  private async notify(userId: number, title: string, body: string, tag: string): Promise<void> {
    try {
      await this.push.notify(userId, { title, body, tag: `${tag}-${Date.now()}` });
    } catch (error) {
      console.error("Couldn't send a notification:", error);
    }
  }

  /** End-to-end tests only: waits for tab emails still being sent, then forgets the codes and counts. */
  async resetForTests(): Promise<void> {
    await Promise.all(this.sending);
    this.codes.clear();
    this.wrongCodes.clear();
    this.recent.clear();
    this.verifier.resetForTests();
  }
}
