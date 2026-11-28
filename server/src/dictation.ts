import {
  LIFETIME_CATEGORY_ID,
  SHARED_CATEGORY_ID,
  LIFETIME_NEW,
  TITLE_MAX_LENGTH,
  emailTabTarget,
  isValidLoginName,
  matchSpokenTab,
  readSmsCommand,
  readSpokenDue,
  withoutMarkers,
  type Note,
  type Tab,
} from "@nwsnotes/shared";
import type { Mailer } from "./email.js";
import type { LiveUpdates } from "./live.js";
import { actingUser } from "./context.js";
import type { Notebooks } from "./notebooks.js";
import type { Sharing } from "./sharing.js";
import { tabSummaryEmail } from "./tabEmail.js";
import { noteLimitOf, type User } from "./users.js";

/** At most this many tab emails a day for each user, as Brevo's free plan sends 300 a day for everyone. */
const EMAILS_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
/** "Due" sets the due date of a note added at most this long ago. */
const DUE_WINDOW_MS = 5 * 60 * 1000;

/** Where a dictated command came from, named in the History ("by text message", "by Alexa"). */
export type DictationSource = "sms" | "alexa";

/** Why a due date wasn't set. */
export type DueNotSet =
  | { why: "no-when" }
  | { why: "none-recent" }
  | { why: "someone-else"; ownerName: string }
  | { why: "not-understood"; heard: string }
  | { why: "past"; dueDateTime: string }
  | { why: "error" };

/** What a dictated command did, for its channel to turn into a reply, speech and notifications. */
export type DictationOutcome =
  /** A note was saved, in `tab` (none: All). `untagged` says why a note without a tab has no tags. */
  | { kind: "saved"; noteId: number; tab?: Tab; title: string; cut: boolean; untagged?: string; hidesNew: boolean }
  /** "Add" or "New" with nothing after it, or only a tab's name. */
  | { kind: "nothing-after"; after: "Add" | "New" | "the tab name" }
  /** A note that couldn't be saved; `reason` starts in lower case and ends with a full stop. */
  | { kind: "not-saved"; reason: string }
  | { kind: "reset"; count: number }
  | { kind: "not-reset" }
  /** The tab email is on its way: `sent` says how it went. */
  | { kind: "emailing"; tabName: string; sent: Promise<EmailOutcome> }
  /** Not emailed: `reason` (lower case first), or, without one, no tab matched `named`. */
  | { kind: "not-emailed"; reason?: string; named: string }
  | { kind: "due-set"; noteId: number; dueDateTime: string; title: string }
  | { kind: "due-not-set"; reason: DueNotSet };

export type EmailOutcome =
  | { kind: "emailed"; tabName: string; noteCount: number; email: string }
  | { kind: "not-emailed"; reason: string; named: string };

/** How each command is run and logged. */
export interface DictationOptions {
  source: DictationSource;
  /** One line in the log for what happened (never the words themselves). */
  log: (outcome: string) => void;
  /** Added to the log line of a command that worked (e.g. "; confirmed by text"). */
  confirmed?: string;
}

/** A title over the limit, cut at the last space before it (or at the limit if there's none). */
function cutToLimit(title: string): { title: string; cut: boolean } {
  if (title.length <= TITLE_MAX_LENGTH) return { title, cut: false };
  const space = title.lastIndexOf(" ", TITLE_MAX_LENGTH);
  return { title: title.slice(0, space > 0 ? space : TITLE_MAX_LENGTH).trimEnd(), cut: true };
}

/**
 * Carrying out a dictated command (see Specs/text-messages.md and Specs/alexa.md), whether it was texted
 * or said to Alexa: Add, New, Due, Reset New, Email tab, or (with no command word) a note with no tags.
 * Each channel checks who sent it first, and turns the outcome into its own reply and notifications.
 */
export class DictatedCommands {
  /** Each user's tab emails' times in the last day. Memory only. */
  private readonly emailed = new Map<number, number[]>();

  constructor(
    private readonly notebooks: Notebooks,
    private readonly live: LiveUpdates,
    private readonly mailer: Mailer,
    private readonly sharing: Sharing,
    /** The site's address, for the link in tab emails. */
    private readonly publicUrl: string,
  ) {}

  /** Runs the command a text (or what Alexa heard, put back as a text) starts with, for this user. */
  async run(user: User, text: string, options: DictationOptions): Promise<DictationOutcome> {
    if (user.disabled) {
      options.log(`not saved: user ${user.id}'s account is turned off.`);
      return { kind: "not-saved", reason: "your nwsnotes account is turned off." };
    }
    // Every text starts with a command word; one that doesn't is a note with no tags.
    const command = readSmsCommand(text);
    switch (command.command) {
      case "due":
        return this.setDue(user, command.when, options);
      case "email-tab":
        return this.emailTab(user, command.named, options);
      case "reset-new":
        return this.resetNew(user, options);
      case "new":
        if (command.title === "") {
          options.log(`not saved: nothing after "New", for user ${user.id}.`);
          return { kind: "nothing-after", after: "New" };
        }
        return this.addNote(user, undefined, command.title, undefined, options);
      case "add":
        return this.addToTab(user, command.rest, options);
      case "none":
        return this.addNote(user, undefined, matchSpokenTab<Tab>(text, []).title, "It didn't start with a command, so it has no tags.", options);
    }
  }

  /**
   * "Add <tab name> <title>": a note in the tab named first. When no tab's name matches, everything
   * after "Add" (the name included) is the title, with no tags.
   */
  private async addToTab(user: User, rest: string, options: DictationOptions): Promise<DictationOutcome> {
    const { log } = options;
    if (rest === "") {
      log(`not saved: nothing after "Add", for user ${user.id}.`);
      return { kind: "nothing-after", after: "Add" };
    }
    let tabs: Tab[];
    try {
      tabs = (await this.notebooks.for(user.id)).getAll().tabs;
    } catch (error) {
      log(`not saved: an error (below) reading user ${user.id}'s tabs.`);
      console.error(`Couldn't read user ${user.id}'s tabs:`, error);
      return { kind: "not-saved", reason: "nwsnotes can't save right now. Please send it again later." };
    }
    const { tab, title } = matchSpokenTab<Tab>(rest, tabs);
    if (tab && title === "") {
      log(`not saved: only tab ${tab.id}'s name, for user ${user.id}.`);
      return { kind: "nothing-after", after: "the tab name" };
    }
    return this.addNote(user, tab, title, tab ? undefined : "No tab matched, so it has no tags.", options);
  }

  /** Adds a dictated note to the user's notebook, with the tab's tags (none without a tab). */
  private async addNote(
    user: User,
    tab: Tab | undefined,
    fullTitle: string,
    untagged: string | undefined,
    { source, log, confirmed = "" }: DictationOptions,
  ): Promise<DictationOutcome> {
    try {
      const { title, cut } = cutToLimit(fullTitle);
      // The first tag of each category the tab filters on (they're in the category's tag order). Lifetime
      // isn't set: new notes are always New. A tab of tags shared with the user adds to their owner's
      // notebook, which needs one shared tag chosen: a dictated note can't choose between several.
      const shared = tab?.categories.find((filter) => filter.categoryId === SHARED_CATEGORY_ID);
      if (shared && shared.tagIds.length > 1) {
        log(`not saved: tab ${tab!.id} has several shared tags, for user ${user.id}.`);
        return {
          kind: "not-saved",
          reason: `the tab "${tab!.name}" has several tags shared with you, so ${source === "sms" ? "a text" : "Alexa"} can't choose one. Add it in the app.`,
        };
      }
      const tagIds = shared
        ? shared.tagIds
        : (tab?.categories ?? []).filter((filter) => filter.categoryId !== LIFETIME_CATEGORY_ID).flatMap((filter) => filter.tagIds.slice(0, 1));
      let added;
      try {
        added = await actingUser.run({ userId: user.id, displayName: user.displayName }, () =>
          this.sharing.addNote(user, { titleText: title }, tagIds, undefined, undefined, { source }),
        );
      } catch (error) {
        const status = (error as { status?: unknown }).status;
        // Refused for sharing's reasons (e.g. a read-only shared tag, or the owner's notebook being full).
        if (shared && (status === 400 || status === 403 || status === 409)) {
          log(`not saved: refused (${String(status)}) adding to a shared tag, for user ${user.id}.`);
          const message = (error as Error).message;
          return { kind: "not-saved", reason: `${message.charAt(0).toLowerCase()}${message.slice(1)}` };
        }
        throw error;
      }
      const { note } = added;
      this.live.notifyChanged(user.id, undefined);
      log(`saved as user ${user.id}'s note ${note.id}, ${tab ? `in tab ${tab.id}` : "with no tab"}${confirmed}.`);
      const lifetime = tab?.categories.find((filter) => filter.categoryId === LIFETIME_CATEGORY_ID);
      return {
        kind: "saved",
        noteId: note.id,
        ...(tab && { tab }),
        title,
        cut,
        ...(!tab && untagged !== undefined && { untagged }),
        hidesNew: lifetime !== undefined && !lifetime.tagIds.includes(LIFETIME_NEW),
      };
    } catch (error) {
      const status = (error as { status?: unknown }).status;
      if (status === 409) {
        log(`not saved: user ${user.id} is at their note limit.`);
        return { kind: "not-saved", reason: `you've reached your limit of ${noteLimitOf(user)} notes.` };
      }
      log(`not saved: an error (below) adding user ${user.id}'s note.`);
      console.error(`Couldn't add user ${user.id}'s ${source === "sms" ? "texted" : "dictated"} note:`, error);
      return { kind: "not-saved", reason: "nwsnotes can't save right now. Please send it again later." };
    }
  }

  /** "Reset New": the user's New notes become Active, with the shared ones they may edit (as the Settings button). */
  private async resetNew(user: User, { log, confirmed = "" }: DictationOptions): Promise<DictationOutcome> {
    let count: number;
    try {
      count = await actingUser.run({ userId: user.id, displayName: user.displayName }, () => this.sharing.bulkLifetime(user, "reset-new", undefined));
    } catch (error) {
      log(`not reset: an error (below) resetting user ${user.id}'s New notes.`);
      console.error(`Couldn't reset user ${user.id}'s New notes:`, error);
      return { kind: "not-reset" };
    }
    if (count > 0) this.live.notifyChanged(user.id, undefined);
    log(`reset New: ${count} of user ${user.id}'s notes made Active${confirmed}.`);
    return { kind: "reset", count };
  }

  /**
   * "Email tab <name>": emails the user a summary of the notes that tab shows. The checks are made
   * straight away; the email itself is sent in `sent`, so Alexa can answer before it has gone.
   */
  private async emailTab(user: User, named: string, { log, confirmed = "" }: DictationOptions): Promise<DictationOutcome> {
    if (!this.mailer.enabled) {
      log(`not emailed: email isn't set up, for user ${user.id}.`);
      return { kind: "not-emailed", reason: "email isn't set up on nwsnotes.", named };
    }
    if (!isValidLoginName(user.loginName)) {
      log(`not emailed: user ${user.id}'s login isn't an email address.`);
      return { kind: "not-emailed", reason: "your login isn't an email address. Ask the admin to change it.", named };
    }
    const now = Date.now();
    const sent = (this.emailed.get(user.id) ?? []).filter((time) => time > now - DAY_MS);
    this.emailed.set(user.id, sent);
    if (sent.length >= EMAILS_PER_DAY) {
      log(`not emailed: user ${user.id} has had ${EMAILS_PER_DAY} tab emails today.`);
      return { kind: "not-emailed", reason: `you've had ${EMAILS_PER_DAY} tab emails in the last day. Try again later.`, named };
    }
    const failed = (error: unknown): EmailOutcome => {
      log(`not emailed: an error (below) emailing user ${user.id}'s tab.`);
      console.error(`Couldn't email user ${user.id}'s tab:`, error);
      return { kind: "not-emailed", reason: "nwsnotes couldn't send the email. Please try again later.", named };
    };
    let data;
    let tab;
    try {
      // With the notes shared with them, as the app shows the tab.
      data = await this.sharing.dataFor(user.id);
      tab = emailTabTarget<Tab>(named, data.tabs);
    } catch (error) {
      const { reason } = failed(error) as Extract<EmailOutcome, { kind: "not-emailed" }>;
      return { kind: "not-emailed", reason, named };
    }
    if (!tab) {
      log(`not emailed: no tab matched, for user ${user.id}.`);
      return { kind: "not-emailed", named };
    }
    const tabName = tab === "all" ? "All" : tab.name;
    // Counted now, so commands straight after this one see it.
    sent.push(now);
    const email = tabSummaryEmail(tab, data, { email: user.loginName, name: user.displayName }, this.publicUrl);
    const target = tab === "all" ? "the All tab" : `tab ${tab.id}`;
    const sending = this.mailer.send(email).then(
      (): EmailOutcome => {
        log(`emailed ${target} (${email.noteCount} notes) to user ${user.id}${confirmed}.`);
        return { kind: "emailed", tabName, noteCount: email.noteCount, email: user.loginName };
      },
      (error: unknown) => {
        // Not counted after all, as nothing went.
        const index = sent.indexOf(now);
        if (index >= 0) sent.splice(index, 1);
        return failed(error);
      },
    );
    return { kind: "emailing", tabName, sent: sending };
  }

  /**
   * "Due <when>": sets the due date of the note the user added last, if that was in the last 5 minutes
   * (by text, by Alexa or in the app). Notes others added in the user's notebook don't count.
   */
  private async setDue(user: User, when: string, { source, log, confirmed = "" }: DictationOptions): Promise<DictationOutcome> {
    const notSet = (reason: DueNotSet): DictationOutcome => ({ kind: "due-not-set", reason });
    if (when === "") {
      log(`due date not set: no date or time given, for user ${user.id}.`);
      return notSet({ why: "no-when" });
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
        return notSet({ why: "none-recent" });
      }
      if (last.shared) {
        log(`due date not set: user ${user.id}'s last note ${last.id} is in user ${last.shared.ownerId}'s notebook.`);
        return notSet({ why: "someone-else", ownerName: last.shared.ownerName });
      }
      const read = readSpokenDue(when, now);
      if (!read.ok) {
        log(`due date not set: ${read.reason === "past" ? "the date and time has passed" : "the date and time wasn't understood"}, for user ${user.id}.`);
        return notSet(read.reason === "past" ? { why: "past", dueDateTime: read.dueDateTime } : { why: "not-understood", heard: when });
      }
      const store = await this.notebooks.for(user.id);
      const note = await actingUser.run({ userId: user.id, displayName: user.displayName }, () =>
        store.setDueDate(last.id, read.dueDateTime, { source }),
      );
      this.live.notifyChanged(user.id, undefined);
      log(`due date set on user ${user.id}'s note ${note.id}${confirmed}.`);
      const title = note.titleText !== undefined ? withoutMarkers(note.titleText) : "[Handwritten note]";
      return { kind: "due-set", noteId: note.id, dueDateTime: read.dueDateTime, title };
    } catch (error) {
      log(`due date not set: an error (below) setting user ${user.id}'s due date.`);
      console.error(`Couldn't set user ${user.id}'s due date${source === "sms" ? " by text" : " by Alexa"}:`, error);
      return notSet({ why: "error" });
    }
  }

  /** End-to-end tests only: forgets the counts of tab emails. */
  resetForTests(): void {
    this.emailed.clear();
  }
}
