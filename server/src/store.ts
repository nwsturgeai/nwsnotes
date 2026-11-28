import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CLIENT_ID_MAX_LENGTH,
  detailsPagesOf,
  isAllDayTime,
  isAncestor,
  isLifetimeTag,
  isLongForm,
  isStylusNote,
  lifetimeOf,
  LIFETIME_ACTIVE,
  LIFETIME_ARCHIVED,
  LIFETIME_BIN,
  LIFETIME_CATEGORY,
  LIFETIME_CHANGES,
  LIFETIME_NEW,
  LIFETIME_WAITING,
  mergeNoteOrders,
  sameTags,
  tagsForTabMove,
  validateCategory,
  validateTab,
  validateTagIds,
  type BulkTagsRequest,
  type Category,
  type CategoryRequest,
  type LifetimeChange,
  type Note,
  type NotesData,
  type NoteDetails,
  type NoteTitle,
  type Tab,
  type TabPlacement,
  withoutMarkers,
  NOTE_CHANGED_ELSEWHERE,
  NOTE_CHANGED_STATUS,
} from "@nwsnotes/shared";
import { actingUser } from "./context.js";
import { databaseUnreachable, type Db } from "./db.js";
import { RequestError } from "./errors.js";
import {
  emptyNotebook,
  idList,
  idsOfOtherUsers,
  listChanges,
  loadSnapshot,
  markSetUp,
  nextNoteId,
  nextTagIds,
  oldTabOrders,
  revertedSnapshot,
  syncIdSequences,
  nextCategoryId,
  formerTagIds,
  withoutNoteOrder,
  writeChange,
  type ChangeRecord,
  type ChangeSummary,
  type Snapshot,
} from "./persist.js";

export { RequestError };

/** The daily backup files' names. */
export const DAILY_BACKUP_PATTERN = /^notes-\d{4}-\d{2}-\d{2}\.json$/;

/** Contents of each save-file. */
interface SaveFile {
  version: 2;
  savedDateTime: string;
  notes: Note[];
  /** User categories only; the built-in Lifetime category isn't stored. */
  categories: Category[];
  /** Missing in files saved before tabs existed. */
  tabs?: Tab[];
  /**
   * Files saved before note ids were unique across all users: the highest note id that notebook had given.
   * Ignored now (ids come from the database's sequence), and no longer written.
   */
  lastNoteId?: number;
  /** Where the built-in "All" tab shows. Missing in older files (and then "top"). */
  allTabPlacement?: TabPlacement;
  /** The shared order of the notes. Missing in older files, where each tab had its own (then made from those). */
  noteOrder?: number[];
}

/** The data the store keeps and saves. */

/** A note's tags with any Lifetime tag removed (the server decides a note's Lifetime). */
function withoutLifetime(rawTagIds: unknown): unknown {
  return Array.isArray(rawTagIds) ? rawTagIds.filter((id) => typeof id !== "number" || !isLifetimeTag(id)) : rawTagIds;
}

/** A note with its Lifetime tag replaced. */
function withLifetime(note: Note, lifetime: number): Note["tagIds"] {
  return [...note.tagIds.filter((id) => !isLifetimeTag(id)), lifetime];
}

/** Save-files written before tags existed. */
interface SaveFileV1 {
  version: 1;
  savedDateTime: string;
  notes: Omit<Note, "tagIds">[];
}


/** `items` in the order of `raw.ids`, which must list every item's id exactly once. */
function inOrder<T extends { id: number }>(raw: unknown, items: T[], kind: string): T[] {
  const ids = (raw as { ids?: unknown } | undefined)?.ids;
  if (!Array.isArray(ids) || !ids.every((id) => Number.isInteger(id))) {
    throw new RequestError(400, `"ids" must be a list of ${kind} ids.`);
  }
  const ordered = (ids as number[]).map((id) => items.find((item) => item.id === id));
  if (ordered.length !== items.length || new Set(ids).size !== ids.length || ordered.some((item) => !item)) {
    throw new RequestError(400, `"ids" must list every ${kind} exactly once.`);
  }
  return ordered as T[];
}


/** A reminder is sent this late at most (e.g. when the server was down as the note fell due). */
const REMINDER_LATEST_MS = 24 * 60 * 60 * 1000;

/** Lifetimes that get reminders: not Archived or Bin. */
const REMINDED_LIFETIMES = [LIFETIME_NEW, LIFETIME_ACTIVE, LIFETIME_WAITING];

/** A due date's options: no reminder, and a Waiting note going back to Active when it's due. */
interface DueOptions {
  noReminder?: boolean;
  returnWhenDue?: boolean;
}

/** A note's due-date options as they are, to keep them. */
const dueOptionsOf = (note: Note): DueOptions => ({ noReminder: note.noReminder === true, returnWhenDue: note.returnWhenDue === true });

/**
 * A note's due date, its options, and their records after an add or edit. An unchanged due date keeps its
 * records; a due date that's already past counts as reminded (and returned), since it didn't just pass. So
 * does one whose reminder (or return) is turned on after it passed: neither happens late.
 */
function dueDateFields(
  dueDateTime: string | undefined,
  existing: Note | undefined,
  now: Date,
  allDay = existing?.allDay === true,
  { noReminder = false, returnWhenDue = false }: DueOptions = {},
): Partial<Note> {
  if (dueDateTime === undefined) return {};
  const past = Date.parse(dueDateTime) <= now.getTime();
  const sameDue = existing?.dueDateTime === dueDateTime;
  const reminderTurnedOn = existing?.noReminder === true && !noReminder;
  const reminderSentFor = sameDue && !reminderTurnedOn ? existing.reminderSentFor : past ? dueDateTime : undefined;
  const returnedFor = !returnWhenDue ? undefined : sameDue && existing.returnWhenDue ? existing.returnedFor : past ? dueDateTime : undefined;
  // An all-day note (from Google Calendar) stays all-day only while it's due at the all-day time.
  return {
    dueDateTime,
    ...(noReminder && { noReminder: true as const }),
    ...(returnWhenDue && { returnWhenDue: true as const }),
    ...(reminderSentFor !== undefined && { reminderSentFor }),
    ...(returnedFor !== undefined && { returnedFor }),
    ...(allDay && isAllDayTime(dueDateTime) && { allDay: true as const }),
  };
}

/** Where a change came from, for the History: texted in, or from Google Calendar. */
type ChangeSource = "sms" | "alexa" | "calendar";
const SOURCE_SUFFIX: Record<ChangeSource, string> = { sms: " by text message", alexa: " by Alexa", calendar: " from Google Calendar" };
const sourceSuffix = (source: ChangeSource | undefined) => (source ? SOURCE_SUFFIX[source] : "");

/** What a change from Google Calendar does to a note (see calendarUpdate). */
export interface CalendarChange {
  titleText?: string;
  /** Typed details: a regular note given them becomes a long-form note. */
  detailsText?: string;
  /** A new due date, or null to clear it. */
  dueDateTime?: string | null;
  allDay?: boolean;
  /** The note's user tags (without Lifetime). */
  tagIds?: number[];
  /** Moved to the Bin (the event was deleted). */
  toBin?: boolean;
}

/** A time the page sent for something done offline, if it's valid and not after `now`; otherwise undefined. */
function offlineTime(raw: unknown, now: Date): string | undefined {
  const ms = typeof raw === "string" ? Date.parse(raw) : NaN;
  // NaN (none sent, or invalid) fails the comparison.
  return ms <= now.getTime() ? new Date(ms).toISOString() : undefined;
}

/** How long the history is kept. */
export const HISTORY_DAYS = 30;

/** A note as history summaries name it: its title in quotes (shortened), or "a handwritten note". */
function label(note: Note): string {
  if (note.titleText === undefined) return "a handwritten note";
  const title = withoutMarkers(note.titleText);
  return `"${title.length > 40 ? `${title.slice(0, 39)}…` : title}"`;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** How each Lifetime change is described in the history. */
const LIFETIME_SUMMARIES: Record<LifetimeChange, (note: string) => string> = {
  Active: (note) => `Reinstated ${note}`,
  Waiting: (note) => `Set ${note} to Waiting`,
  Archived: (note) => `Archived ${note}`,
  Bin: (note) => `Moved ${note} to the bin`,
};

/** "2026-10-24T09:40:12.345Z" -> "notes-2026-10-24T09-40-12-345Z.json" */
function fileNameFor(date: Date): string {
  return `notes-${date.toISOString().replace(/[:.]/g, "-")}.json`;
}

/** A save-file's contents, as the store reads them. */
type ParsedSaveFile = Required<Omit<SaveFile, "lastNoteId">>;

/** Reads a save-file of either version as the current version. */
function parseSaveFile(name: string, text: string): ParsedSaveFile {
  const content = JSON.parse(text) as SaveFile | SaveFileV1;
  if (!Array.isArray(content.notes)) {
    throw new Error(`Save-file ${name} has no "notes" list.`);
  }
  if (content.version === 1) {
    return {
      version: 2,
      savedDateTime: content.savedDateTime,
      notes: content.notes.map((note) => ({ ...note, tagIds: [] })),
      categories: [],
      tabs: [],
      allTabPlacement: "top",
      noteOrder: [],
    };
  }
  if (content.version !== 2 || !Array.isArray(content.categories)) {
    throw new Error(`Save-file ${name} has an unknown format (version ${String((content as { version?: unknown }).version)}).`);
  }
  // Files saved before tabs existed have no "tabs" list.
  const tabs = Array.isArray(content.tabs) ? content.tabs : [];
  const ids = new Set(content.notes.map((n) => n.id));
  const { lastNoteId: _ignored, ...rest } = content;
  return {
    ...rest,
    tabs: tabs.map(withoutNoteOrder),
    // Files from before the order was shared have the tabs' own orders instead: one is made from them.
    noteOrder: (Array.isArray(content.noteOrder)
      ? [...new Set(content.noteOrder.filter((id) => Number.isInteger(id)))]
      : mergeNoteOrders(oldTabOrders(tabs))
    ).filter((id) => ids.has(id)),
    allTabPlacement: content.allTabPlacement === "left" ? "left" : "top",
  };
}

/** A save-file's contents as the store's data, with notes from before Lifetime and tag-change times brought up to date. */
function snapshotOf(content: ParsedSaveFile): Snapshot {
  return {
    // Notes saved before Lifetime existed become Active, and notes saved before tag-change times
    // existed get their created time.
    notes: content.notes.map((note) => ({
      ...note,
      tagIds: note.tagIds.some(isLifetimeTag) ? note.tagIds : [...note.tagIds, LIFETIME_ACTIVE],
      tagsChangedDateTime: note.tagsChangedDateTime ?? note.createdDateTime,
    })),
    categories: content.categories,
    tabs: content.tabs,
    allTabPlacement: content.allTabPlacement,
    noteOrder: content.noteOrder,
  };
}


/** An empty notebook. */
const EMPTY: Snapshot = { notes: [], categories: [], tabs: [], allTabPlacement: "top", noteOrder: [] };

/** Every tag id in the categories. */
function tagIdsOf(categories: Category[]): number[] {
  return categories.flatMap((category) => category.tags.map((tag) => tag.id));
}

/** Options for saving a change. */
interface SaveOptions {
  /** How the change is described in the history; without it, the change isn't in the history. */
  record?: ChangeRecord;
  /** Set when this is an update of that long-form note: repeated autosaves join one change (see save()). */
  longFormUpdateId?: number;
}

/**
 * One user's notebook: keeps all their notes, categories and tabs in memory, and saves each change to the
 * database (Supabase's Postgres, or PGlite in development and the tests) with its history, so earlier
 * states can be gone back to. Every user has their own, with its own queue of changes (see notebooks.ts).
 */
export class NoteStore {
  private notes: Note[] = [];
  private categories: Category[] = [];
  private tabs: Tab[] = [];
  /** Where the built-in "All" tab shows. */
  private allTabPlacement: TabPlacement = "top";
  /** The shared order of the notes, for every tab. */
  private noteOrder: number[] = [];
  private lastSaveMs = 0;
  /** False until the data has been loaded from the database; until then the API answers 503. */
  private ready = false;
  /**
   * Set when the latest change was an update of this long-form note: the next autosave of the same note
   * joins that change. Anything else (creating it, other changes, a restart) clears it.
   */
  private lastLongFormUpdate: { noteId: number; changeId: number; userId: number } | undefined;
  /** Changes run one at a time, in order. */
  private queue: Promise<unknown> = Promise.resolve();
  /** Called after each change is saved (Notebooks uses it to tell the pages of users this notebook shares tags with). */
  onSaved?: () => void;

  constructor(
    private readonly db: Db,
    readonly userId: number,
  ) {}

  /** Loads the notebook from the database (setting it up the first time). */
  async load(): Promise<void> {
    const loaded = await loadSnapshot(this.db, this.userId);
    if (loaded) {
      // Data from before the order was shared: the order made from the tabs' own is saved (not in the history).
      if (loaded.stored) {
        await writeChange(this.db, this.userId, loaded.stored, loaded.snapshot, this.nextSaveTime(), undefined);
        console.log(`Made user ${this.userId}'s shared note order from the tabs' own orders.`);
      }
      this.apply(loaded.snapshot);
      console.log(
        `Loaded user ${this.userId}'s ${this.notes.length} notes, ${this.categories.length} categories and ${this.tabs.length} tabs from the database.`,
      );
    } else {
      // A new notebook: marks it as set up, so later starts load it.
      await this.db.transaction((query) => markSetUp(query, this.userId));
      this.apply(EMPTY);
      console.log(`User ${this.userId} has no notes yet.`);
    }
    this.ready = true;
  }

  private snapshot(): Snapshot {
    return {
      notes: this.notes,
      categories: this.categories,
      tabs: this.tabs,
      allTabPlacement: this.allTabPlacement,
      noteOrder: this.noteOrder,
    };
  }

  private apply(snapshot: Snapshot) {
    this.notes = snapshot.notes;
    this.categories = snapshot.categories;
    this.tabs = snapshot.tabs;
    this.allTabPlacement = snapshot.allTabPlacement;
    this.noteOrder = snapshot.noteOrder;
  }

  getAll(): NotesData {
    if (!this.ready) throw databaseUnreachable();
    return {
      notes: this.notes,
      categories: this.allCategories(),
      tabs: this.tabs,
      allTabPlacement: this.allTabPlacement,
      noteOrder: this.noteOrder,
    };
  }

  /** User categories plus the built-in Lifetime category (which tabs can filter on). */
  private allCategories(): Category[] {
    return [...this.categories, LIFETIME_CATEGORY];
  }

  /** Everything, in the save-file format (version 2): for "Download backup" and the daily backup files. */
  backup(now = new Date()): { name: string; content: string } {
    if (!this.ready) throw databaseUnreachable();
    const content: SaveFile = {
      version: 2,
      savedDateTime: now.toISOString(),
      notes: this.notes,
      categories: this.categories,
      tabs: this.tabs,
      allTabPlacement: this.allTabPlacement,
      noteOrder: this.noteOrder,
    };
    return { name: fileNameFor(now), content: JSON.stringify(content, null, 2) };
  }

  /** The history: the newest changes (older than `before`, a change id, if given), newest first. */
  history(rawBefore: unknown, rawLimit: unknown): Promise<{ changes: ChangeSummary[]; more: boolean }> {
    if (!this.ready) throw databaseUnreachable();
    const before = rawBefore === undefined ? undefined : Number(rawBefore);
    if (before !== undefined && !Number.isInteger(before)) throw new RequestError(400, '"before" must be a change id.');
    const limit = rawLimit === undefined ? 50 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new RequestError(400, '"limit" must be from 1 to 200.');
    return listChanges(this.db, this.userId, before, limit);
  }

  /** Goes back to how everything was just after change `toChangeId`. Returns how many changes were undone. */
  revert(raw: unknown): Promise<{ undone: number }> {
    return this.enqueue(async () => {
      const toChangeId = (raw as { toChangeId?: unknown } | undefined)?.toChangeId;
      if (!Number.isInteger(toChangeId)) throw new RequestError(400, '"toChangeId" must be a change id.');
      const result = await revertedSnapshot(this.db, this.userId, toChangeId as number, this.snapshot());
      if (!result) throw new RequestError(404, `There is no change ${String(toChangeId)} in the history (it may be over ${HISTORY_DAYS} days old).`);
      if (result.undone === 0) throw new RequestError(400, "That's the latest change, so there's nothing to undo.");
      // A reminder already sent for a note's due date isn't sent again because the note came back, nor does a
      // note already returned from Waiting for it return again.
      const current = new Map(this.notes.map((note) => [note.id, note]));
      const notes = result.snapshot.notes.map((before) => {
        let note = before;
        const sent = current.get(note.id)?.reminderSentFor;
        if (sent !== undefined && note.dueDateTime === sent && note.reminderSentFor !== sent) note = { ...note, reminderSentFor: sent };
        const returned = current.get(note.id)?.returnedFor;
        if (returned !== undefined && note.dueDateTime === returned && note.returnedFor !== returned) note = { ...note, returnedFor: returned };
        return note;
      });
      await this.save(this.nextSaveTime(), { ...result.snapshot, notes }, {
        record: {
          summary: `Went back to an earlier change (${plural(result.undone, "change")} undone)`,
          revertedTo: result.time,
          undone: result.undone,
        },
      });
      return { undone: result.undone };
    });
  }

  /**
   * `--restore <file>`: replaces all the notes, categories and tabs with a backup file's, as one change
   * in the history (so it can be undone too).
   */
  restore(name: string, text: string): Promise<number> {
    return this.enqueue(async () => {
      const content = snapshotOf(parseSaveFile(name, text));
      // Ids are unique across all users, so a file holding someone else's ids is from another notebook.
      const others = await idsOfOtherUsers(this.db, this.userId, content.notes.map((note) => note.id), tagIdsOf(content.categories));
      if (others.notes.length > 0 || others.tags.length > 0) {
        const which = [
          others.notes.length > 0 && idList("note", others.notes.slice(0, 10)),
          others.tags.length > 0 && idList("tag", others.tags.slice(0, 10)),
        ].filter(Boolean).join(" and ");
        throw new Error(`${name} has ${which}, which belong${others.notes.length + others.tags.length === 1 ? "s" : ""} to another user, so it isn't this user's backup. Nothing was restored.`);
      }
      await this.save(this.nextSaveTime(), content, { record: { summary: `Restored from ${name}` } });
      // New ids must come after the restored ones.
      await this.db.transaction((query) => syncIdSequences(query));
      return this.notes.length;
    });
  }

  /** The daily backup: a file in `dir` (the user's own backup folder), keeping the last `kept`. */
  async writeDailyBackup(dir: string, kept: number): Promise<void> {
    await mkdir(dir, { recursive: true });
    const now = new Date();
    await writeFile(path.join(dir, `notes-${now.toISOString().slice(0, 10)}.json`), this.backup(now).content, "utf8");
    const old = (await readdir(dir)).filter((name) => DAILY_BACKUP_PATTERN.test(name)).sort().slice(0, -kept);
    for (const name of old) await unlink(path.join(dir, name));
  }

  /** End-to-end tests only: forgets what's in memory and loads it again from the database, as a restart would. */
  reloadForTests(): Promise<void> {
    return this.enqueue(async () => {
      this.lastLongFormUpdate = undefined;
      await this.load();
    });
  }

  /**
   * Adds a note (title and details already validated) and saves. Resolves once it is on disk.
   * With details it's a long-form note; with a parent id it's a child of that long-form note (one in this
   * notebook; long-form notes can be children too).
   * `created` says whether it was new: an add with a `clientId` the store already has returns that
   * note unchanged (a retried add whose reply was lost). A valid `createdDateTime` that isn't in the
   * future (a note written offline) is kept as its created time, and likewise `tagsChangedDateTime`
   * (its tags changed offline before it was sent); without one, its tags were set when it was created.
   * `dueDateTime` (already validated) is optional, for any kind of note.
   */
  add(
    title: NoteTitle,
    rawTagIds: unknown,
    details: NoteDetails | undefined,
    rawParentId: unknown,
    options: {
      dueDateTime?: string;
      noReminder?: boolean;
      returnWhenDue?: boolean;
      clientId?: unknown;
      createdDateTime?: unknown;
      tagsChangedDateTime?: unknown;
      noteLimit?: number;
      stylusNoteLimit?: number;
      /** "sms": texted in; "calendar": from Google Calendar. The History says so. */
      source?: ChangeSource;
      /** From an all-day event in Google Calendar (kept only while it's due at 20:00). */
      allDay?: boolean;
      /** Set when someone a tag is shared with adds the note: this notebook's owner, for the limits' messages. */
      ownerName?: string;
      /** Who is adding it (the owner, or someone a tag is shared with). */
      createdByUserId?: number;
    } = {},
  ): Promise<{ note: Note; created: boolean }> {
    return this.enqueue(async () => {
      let clientId: string | undefined;
      if (options.clientId !== undefined && options.clientId !== null) {
        if (typeof options.clientId !== "string" || options.clientId === "" || options.clientId.length > CLIENT_ID_MAX_LENGTH) {
          throw new RequestError(400, `"clientId" must be a string of at most ${CLIENT_ID_MAX_LENGTH} characters.`);
        }
        clientId = options.clientId;
        const existing = this.notes.find((n) => n.clientId === clientId);
        if (existing) return { note: existing, created: false };
      }
      // Checked here, in the queue of changes, so two adds at once can't both slip under the limit.
      if (options.noteLimit !== undefined && this.notes.length >= options.noteLimit) {
        throw new RequestError(
          409,
          options.ownerName !== undefined
            ? `${options.ownerName}'s notebook is full, so this note can't be added.`
            : `You've reached your limit of ${options.noteLimit} notes. Empty the Bin to make room, or ask the admin for a higher limit.`,
        );
      }
      if (isStylusNote({ ...title, ...details })) this.checkStylusNoteLimit(options.stylusNoteLimit, options.ownerName);
      const tagIds = validateTagIds(await this.withoutDeletedTags(withoutLifetime(rawTagIds)), this.categories);
      if (!tagIds.ok) throw new RequestError(400, tagIds.error);
      if (details && title.titleText === undefined) {
        throw new RequestError(400, "A long-form note's title must be typed text.");
      }
      const parentId = rawParentId === undefined || rawParentId === null ? undefined : this.parentFor(rawParentId);

      const now = this.nextSaveTime();
      const timestamp = now.toISOString();
      const createdDateTime = offlineTime(options.createdDateTime, now) ?? timestamp;
      const note: Note = {
        id: await nextNoteId(this.db),
        ...title,
        ...details,
        ...(parentId !== undefined && { parentId }),
        ...dueDateFields(options.dueDateTime, undefined, now, options.allDay === true, options),
        ...(options.createdByUserId !== undefined && { createdByUserId: options.createdByUserId }),
        createdDateTime,
        lastModifiedDateTime: timestamp,
        tagsChangedDateTime: offlineTime(options.tagsChangedDateTime, now) ?? createdDateTime,
        // New notes are always New.
        tagIds: [...tagIds.value, LIFETIME_NEW],
        ...(clientId !== undefined && { clientId }),
      };
      await this.save(now, { notes: [...this.notes, note] }, {
        record: { summary: `Added ${details ? "long-form note " : ""}${label(note)}${sourceSuffix(options.source)}` },
      });
      return { note, created: true };
    });
  }

  /**
   * Refuses a new stylus note when the notebook already has `limit` of them (archived and Bin included).
   * Called in the queue of changes, so two at once can't both slip under it.
   */
  private checkStylusNoteLimit(limit: number | undefined, ownerName?: string): void {
    if (limit === undefined || this.notes.filter(isStylusNote).length < limit) return;
    throw new RequestError(
      409,
      ownerName !== undefined
        ? `${ownerName}'s notebook has no room for more stylus notes, so this one can't be saved.`
        : `You've reached your limit of ${limit} stylus notes. Empty the Bin to make room, or ask the admin for a higher limit.`,
    );
  }

  /**
   * Replaces a note's title (already validated) and tags, then saves. The note keeps its id, its
   * created time (so its place in the list) and its type: typed notes stay typed, handwritten stay handwritten.
   * Sending details for a regular note converts it to a long-form note ("Convert to long-form note").
   * If the tags really change, `tagsChangedDateTime` (an offline change's time) or now becomes their
   * changed time. `dueDateTime` (already validated) replaces the note's, so
   * leaving it out clears it; likewise `noReminder` and `returnWhenDue`, so leaving them out turns the reminder
   * on and the return off.
   */
  updateNote(
    id: number,
    title: NoteTitle,
    rawTagIds: unknown,
    details: NoteDetails | undefined,
    options: {
      dueDateTime?: string;
      noReminder?: boolean;
      returnWhenDue?: boolean;
      tagsChangedDateTime?: unknown;
      /** The note's lastModifiedDateTime when the edit started: refused (412) if it has changed since. */
      baseModifiedDateTime?: unknown;
      stylusNoteLimit?: number;
      ownerName?: string;
      /** A long-form note to make it a child of, or null to take it out of its parent. Left out, it keeps its parent. */
      parentId?: unknown;
    } = {},
  ): Promise<Note> {
    return this.enqueue(async () => {
      const existing = this.notes.find((n) => n.id === id);
      if (!existing) throw new RequestError(404, `There is no note with id ${id}.`);
      const base = options.baseModifiedDateTime;
      if (base !== undefined && base !== null) {
        if (typeof base !== "string") throw new RequestError(400, `"baseModifiedDateTime" must be a date and time.`);
        // Checked here, in the queue of changes, so two edits from the same starting point can't both be saved.
        if (base !== existing.lastModifiedDateTime) throw new RequestError(NOTE_CHANGED_STATUS, NOTE_CHANGED_ELSEWHERE);
      }
      const wasHandwritten = existing.titleImage !== undefined;
      if (wasHandwritten !== (title.titleImage !== undefined)) {
        throw new RequestError(
          400,
          wasHandwritten
            ? "This note is handwritten, so it must be updated with a new image, not text."
            : "This note is typed, so it must be updated with new text, not an image.",
        );
      }
      // A long-form note stays long-form, with the same kind of details. A regular note sent with
      // details becomes long-form, if it could have been created as one: a typed title. A child note
      // keeps its parent when it does.
      const longForm = isLongForm(existing);
      if (longForm && details === undefined) {
        throw new RequestError(400, "This is a long-form note, so it must be updated with its details.");
      }
      if (!longForm && details !== undefined && title.titleText === undefined) {
        throw new RequestError(400, "A long-form note's title must be typed text.");
      }
      // Left out, the parent stays (even one that's gone); otherwise it's checked if it changes.
      const rawParent = options.parentId;
      const parentId =
        rawParent === undefined
          ? existing.parentId
          : rawParent === null
            ? undefined
            : rawParent === existing.parentId
              ? existing.parentId
              : this.parentFor(rawParent, id);
      if (longForm && details && (existing.detailsImage !== undefined) !== (details.detailsImage !== undefined)) {
        throw new RequestError(
          400,
          existing.detailsImage !== undefined
            ? "This note's details are handwritten, so they must be updated with a new image, not text."
            : "This note's details are typed, so they must be updated with new text, not an image.",
        );
      }
      const tagIds = validateTagIds(await this.withoutDeletedTags(withoutLifetime(rawTagIds)), this.categories);
      if (!tagIds.ok) throw new RequestError(400, tagIds.error);
      // A typed note converted to a long-form note with handwritten details becomes a stylus note.
      if (!isStylusNote(existing) && isStylusNote({ ...title, ...details })) this.checkStylusNoteLimit(options.stylusNoteLimit, options.ownerName);

      const now = this.nextSaveTime();
      // Editing keeps the note's Lifetime.
      const newTagIds = [...tagIds.value, lifetimeOf(existing)];
      const note: Note = {
        id,
        ...title,
        ...details,
        ...(parentId !== undefined && { parentId }),
        ...dueDateFields(options.dueDateTime, existing, now, undefined, options),
        ...(existing.createdByUserId !== undefined && { createdByUserId: existing.createdByUserId }),
        createdDateTime: existing.createdDateTime,
        lastModifiedDateTime: now.toISOString(),
        tagsChangedDateTime: this.tagsChangedTime(existing, newTagIds, now, options.tagsChangedDateTime),
        tagIds: newTagIds,
      };
      // Repeated saves of a long-form note being edited replace each other (see save()).
      const edited = longForm
        ? `Edited long-form note ${label(note)}`
        : details
          ? `Made ${label(note)} a long-form note`
          : `Edited ${label(note)}`;
      const sameContent =
        note.titleText === existing.titleText &&
        note.titleImage === existing.titleImage &&
        note.detailsText === existing.detailsText &&
        note.detailsImage === existing.detailsImage &&
        detailsPagesOf(note).join() === detailsPagesOf(existing).join() &&
        note.dueDateTime === existing.dueDateTime &&
        sameTags(note.tagIds, existing.tagIds);
      const reminderChanged = note.dueDateTime !== undefined && (note.noReminder === true) !== (existing.noReminder === true);
      const returnChanged = note.dueDateTime !== undefined && (note.returnWhenDue === true) !== (existing.returnWhenDue === true);
      // Only the parent changed (the Parent pop-up, say): just the move.
      const onlyMoved = sameContent && !reminderChanged && !returnChanged;
      const optionsSummary =
        reminderChanged && returnChanged
          ? `Changed the due date options of ${label(note)}`
          : reminderChanged
            ? `Turned ${note.noReminder ? "off" : "on"} the reminder for ${label(note)}`
            : `Turned ${note.returnWhenDue ? "on" : "off"} returning from Waiting when due for ${label(note)}`;
      const summary =
        parentId === existing.parentId
          ? sameContent && (reminderChanged || returnChanged)
            ? optionsSummary
            : edited
          : onlyMoved
            ? this.moveSummary(label(note), existing.parentId, parentId)
            : `${edited}, and ${this.moveSummary("it", existing.parentId, parentId).replace(/^M|^T/, (first) => first.toLowerCase())}`;
      await this.save(now, { notes: this.notes.map((n) => (n.id === id ? note : n)) }, {
        record: { summary },
        longFormUpdateId: longForm ? id : undefined,
      });
      return note;
    });
  }

  /**
   * Sets a note's due date (already validated), keeping everything else about it, and saves.
   * Used by "Due" texts; the page sets due dates with the rest of the note (updateNote).
   */
  setDueDate(id: number, dueDateTime: string, options: { source?: ChangeSource } = {}): Promise<Note> {
    return this.enqueue(async () => {
      const existing = this.notes.find((n) => n.id === id);
      if (!existing) throw new RequestError(404, `There is no note with id ${id}.`);
      const now = this.nextSaveTime();
      // Always with a reminder, and not returning from Waiting (a text can't set either).
      const { reminderSentFor: _sent, allDay: _allDay, noReminder: _noReminder, returnWhenDue: _return, returnedFor: _returned, ...rest } = existing;
      const note: Note = { ...rest, ...dueDateFields(dueDateTime, existing, now), lastModifiedDateTime: now.toISOString() };
      await this.save(now, { notes: this.notes.map((n) => (n.id === id ? note : n)) }, {
        record: { summary: `Set the due date of ${label(note)}${sourceSuffix(options.source)}` },
      });
      return note;
    });
  }

  /** One note, if the notebook has it (for Google Calendar's sync). */
  noteById(id: number): Note | undefined {
    return this.notes.find((n) => n.id === id);
  }

  /** Every note, and the user categories in their order (for Google Calendar's sync). */
  notesAndCategories(): { notes: readonly Note[]; categories: readonly Category[] } {
    return { notes: this.notes, categories: this.categories };
  }

  /**
   * A change made to a note's event in Google Calendar: any of its title, typed details (a regular
   * typed note becomes long-form), due date, tags, or moving it to the Bin. In the History, as from
   * Google Calendar. Returns the note, or undefined if it's gone or nothing changed.
   */
  calendarUpdate(id: number, change: CalendarChange): Promise<Note | undefined> {
    return this.enqueue(async () => {
      const existing = this.notes.find((n) => n.id === id);
      if (!existing) return undefined;
      const now = this.nextSaveTime();
      const { reminderSentFor: _sent, allDay: _allDay, dueDateTime: _due, noReminder: _noReminder, returnWhenDue: _return, returnedFor: _returned, ...rest } = existing;
      let note: Note = { ...rest };
      if (change.titleText !== undefined && existing.titleText !== undefined) note.titleText = change.titleText;
      // Only typed notes take typed details: handwritten details stay as they are.
      if (change.detailsText !== undefined && existing.titleText !== undefined && existing.detailsImage === undefined) {
        note.detailsText = change.detailsText;
      }
      const due = change.dueDateTime === undefined ? existing.dueDateTime : (change.dueDateTime ?? undefined);
      // A change in Google never changes the due date's options: they're only changed in nwsnotes.
      note = { ...note, ...dueDateFields(due, existing, now, change.allDay ?? existing.allDay === true, dueOptionsOf(existing)) };
      if (change.tagIds !== undefined) {
        const valid = validateTagIds(change.tagIds.filter((tagId) => !isLifetimeTag(tagId)), this.categories);
        if (valid.ok) note.tagIds = [...valid.value, lifetimeOf(existing)];
      }
      if (change.toBin) note.tagIds = withLifetime(note, LIFETIME_BIN);
      const same = JSON.stringify(note) === JSON.stringify(existing);
      if (same) return undefined;
      note = {
        ...note,
        lastModifiedDateTime: now.toISOString(),
        tagsChangedDateTime: this.tagsChangedTime(existing, note.tagIds, now),
      };
      const what = change.toBin
        ? `Moved ${label(note)} to the Bin`
        : !isLongForm(existing) && isLongForm(note)
          ? `Made ${label(note)} a long-form note`
          : change.titleText !== undefined && change.titleText !== existing.titleText
            ? `Renamed ${label(existing)} to ${label(note)}`
            : `Changed ${label(note)}`;
      await this.save(now, { notes: this.notes.map((n) => (n.id === id ? note : n)) }, { record: { summary: `${what}${SOURCE_SUFFIX.calendar}` } });
      return note;
    });
  }

  /**
   * Multi-select: adds and removes tags on several notes in one save. Adding a single-select tag
   * removes that category's other tags from the note. Lifetime tags can't be changed this way.
   * Returns the updated notes.
   */
  bulkTags(raw: unknown): Promise<Note[]> {
    return this.enqueue(async () => {
      const body = (raw ?? {}) as Partial<Record<keyof BulkTagsRequest, unknown>>;
      const ids = (value: unknown, name: string): number[] => {
        if (!Array.isArray(value) || !value.every((id) => Number.isInteger(id))) {
          throw new RequestError(400, `"${name}" must be a list of ids.`);
        }
        return [...new Set(value as number[])];
      };
      const noteIds = ids(body.noteIds, "noteIds");
      const add = ids(body.addTagIds ?? [], "addTagIds");
      const remove = ids(body.removeTagIds ?? [], "removeTagIds");
      if (noteIds.length === 0) throw new RequestError(400, "Choose at least one note.");
      const missing = noteIds.find((id) => !this.notes.some((n) => n.id === id));
      if (missing !== undefined) throw new RequestError(404, `There is no note with id ${missing}.`);
      // Only user categories' tags: Lifetime isn't among this.categories.
      const categoryOf = (tagId: number) => this.categories.find((c) => c.tags.some((t) => t.id === tagId));
      const unknown = [...add, ...remove].find((id) => !categoryOf(id));
      if (unknown !== undefined) throw new RequestError(400, `Tag ${unknown} doesn't exist or can't be changed this way.`);
      if (add.some((id) => remove.includes(id))) throw new RequestError(400, "A tag can't be both added and removed.");
      for (const category of this.categories) {
        if (!category.multiSelect && add.filter((id) => category.tags.some((t) => t.id === id)).length > 1) {
          throw new RequestError(400, `Only one tag can be chosen from "${category.name}".`);
        }
      }

      const now = this.nextSaveTime();
      const updated: Note[] = [];
      const notes = this.notes.map((note) => {
        if (!noteIds.includes(note.id)) return note;
        let tagIds = note.tagIds.filter((id) => !remove.includes(id));
        for (const tagId of add) {
          const category = categoryOf(tagId)!;
          // A single-select category keeps only the added tag.
          if (!category.multiSelect) tagIds = tagIds.filter((id) => id === tagId || !category.tags.some((t) => t.id === id));
          if (!tagIds.includes(tagId)) tagIds.push(tagId);
        }
        // The Lifetime tag stays last, as everywhere else.
        const lifetime = lifetimeOf(note);
        const newTagIds = [...tagIds.filter((id) => id !== lifetime), lifetime];
        const next: Note = {
          ...note,
          lastModifiedDateTime: now.toISOString(),
          tagsChangedDateTime: this.tagsChangedTime(note, newTagIds, now),
          tagIds: newTagIds,
        };
        updated.push(next);
        return next;
      });
      const which = updated.length === 1 ? label(updated[0]!) : plural(updated.length, "note");
      await this.save(now, { notes }, { record: { summary: `Changed the tags on ${which}` } });
      return updated;
    });
  }

  /** Archives, reinstates (Active) or bins a note, then saves. `rawTagsChanged`: when it was done offline. */
  setLifetime(id: number, raw: unknown, rawTagsChanged?: unknown): Promise<Note> {
    return this.enqueue(async () => {
      const existing = this.notes.find((n) => n.id === id);
      if (!existing) throw new RequestError(404, `There is no note with id ${id}.`);
      if (typeof raw !== "string" || !(raw in LIFETIME_CHANGES)) {
        throw new RequestError(400, `"lifetime" must be one of ${Object.keys(LIFETIME_CHANGES).join(", ")}.`);
      }
      const now = this.nextSaveTime();
      const tagIds = withLifetime(existing, LIFETIME_CHANGES[raw as LifetimeChange]);
      const note: Note = {
        ...existing,
        lastModifiedDateTime: now.toISOString(),
        tagsChangedDateTime: this.tagsChangedTime(existing, tagIds, now, rawTagsChanged),
        tagIds,
      };
      await this.save(now, { notes: this.notes.map((n) => (n.id === id ? note : n)) }, {
        record: { summary: LIFETIME_SUMMARIES[raw as LifetimeChange](label(note)) },
      });
      return note;
    });
  }

  /**
   * Edit-order mode: a note dragged onto tab `toTabId` from `fromTabId` (undefined: "All") gets the tags
   * that put it in that tab and take it out of the one it came from (see `tagsForTabMove`), Lifetime
   * included, in one save. `baseModifiedDateTime`: refused (412) if the note has changed since.
   */
  moveToTab(id: number, raw: unknown): Promise<Note> {
    return this.enqueue(async () => {
      const body = (raw ?? {}) as Partial<Record<"toTabId" | "fromTabId" | "baseModifiedDateTime", unknown>>;
      const existing = this.notes.find((n) => n.id === id);
      if (!existing) throw new RequestError(404, `There is no note with id ${id}.`);
      const tabOf = (tabId: unknown, name: string) => {
        if (!Number.isInteger(tabId)) throw new RequestError(400, `"${name}" must be a tab id.`);
        const tab = this.tabs.find((t) => t.id === tabId);
        if (!tab) throw new RequestError(404, `There is no tab with id ${String(tabId)}.`);
        return tab;
      };
      const to = tabOf(body.toTabId, "toTabId");
      const from = body.fromTabId === undefined || body.fromTabId === null ? undefined : tabOf(body.fromTabId, "fromTabId");
      const base = body.baseModifiedDateTime;
      if (base !== undefined && base !== null) {
        if (typeof base !== "string") throw new RequestError(400, `"baseModifiedDateTime" must be a date and time.`);
        if (base !== existing.lastModifiedDateTime) throw new RequestError(NOTE_CHANGED_STATUS, NOTE_CHANGED_ELSEWHERE);
      }
      const move = tagsForTabMove(existing, [...this.categories, LIFETIME_CATEGORY], to, from);
      if (!move.ok) throw new RequestError(400, move.error);
      if (move.changes.length === 0) throw new RequestError(400, `That note is already in "${to.name}".`);
      const now = this.nextSaveTime();
      const note: Note = {
        ...existing,
        lastModifiedDateTime: now.toISOString(),
        tagsChangedDateTime: this.tagsChangedTime(existing, move.tagIds, now),
        tagIds: move.tagIds,
      };
      await this.save(now, { notes: this.notes.map((n) => (n.id === id ? note : n)) }, {
        record: { summary: `Moved ${label(note)} to tab "${to.name}"` },
      });
      return note;
    });
  }

  /** The Settings "Reset New" button: every New note becomes Active (with `rawNoteIds`, only those). Returns how many changed. */
  resetNew(rawNoteIds?: unknown): Promise<number> {
    return this.changeLifetimes(LIFETIME_NEW, LIFETIME_ACTIVE, rawNoteIds);
  }

  /**
   * The Settings "Archived to Bin" button: every Archived note is moved to the Bin. With `rawNoteIds`
   * (edit-order mode's button), only those notes. Returns how many.
   */
  archivedToBin(rawNoteIds?: unknown): Promise<number> {
    return this.changeLifetimes(LIFETIME_ARCHIVED, LIFETIME_BIN, rawNoteIds);
  }

  /** Edit-order mode's "Waiting → Archive" button: the given notes that are Waiting become Archived. */
  waitingToArchived(rawNoteIds?: unknown): Promise<number> {
    return this.changeLifetimes(LIFETIME_WAITING, LIFETIME_ARCHIVED, rawNoteIds);
  }

  /** The Settings "Empty Bin" button: every Bin note is deleted. Returns how many. */
  emptyBin(): Promise<number> {
    return this.enqueue(async () => {
      const kept = this.withoutParents(this.notes.filter((n) => lifetimeOf(n) !== LIFETIME_BIN));
      const count = this.notes.length - kept.length;
      if (count > 0) {
        await this.save(this.nextSaveTime(), { notes: kept, noteOrder: this.orderKeepingNotes(kept) }, {
          record: { summary: `Emptied the bin (${plural(count, "note")} deleted)` },
        });
      }
      return count;
    });
  }

  /** Deletes one note (cancelling a new long-form note), then saves. Its child notes lose their parent. */
  deleteNote(id: number): Promise<void> {
    return this.enqueue(async () => {
      const existing = this.notes.find((n) => n.id === id);
      if (!existing) throw new RequestError(404, `There is no note with id ${id}.`);
      const notes = this.withoutParents(this.notes.filter((n) => n.id !== id));
      await this.save(this.nextSaveTime(), { notes, noteOrder: this.orderKeepingNotes(notes) }, {
        record: { summary: `Deleted ${label(existing)}` },
      });
    });
  }

  /**
   * A note's tags-changed time after a change to `tagIds`: kept if the tags are the same (in any
   * order), otherwise the offline change's time if one was sent and is valid, or now.
   */
  private tagsChangedTime(existing: Note, tagIds: number[], now: Date, rawTagsChanged?: unknown): string {
    if (sameTags(existing.tagIds, tagIds)) return existing.tagsChangedDateTime;
    return offlineTime(rawTagsChanged, now) ?? now.toISOString();
  }

  /**
   * Notes needing a reminder now: New, Active or Waiting, due at or before `now` (but less than a day
   * ago), not yet reminded for this due date, and not set to have no reminder.
   */
  dueForReminder(now: Date): Note[] {
    return this.notes.filter((note) => {
      if (note.dueDateTime === undefined || note.reminderSentFor === note.dueDateTime || note.noReminder) return false;
      if (!REMINDED_LIFETIMES.includes(lifetimeOf(note))) return false;
      const late = now.getTime() - Date.parse(note.dueDateTime);
      return late >= 0 && late < REMINDER_LATEST_MS;
    });
  }

  /** Notes whose due date has been reached that go back to Active if Waiting, and haven't been dealt with for it yet. */
  dueToReturn(now: Date): Note[] {
    return this.notes.filter(
      (note) => note.returnWhenDue && note.dueDateTime !== undefined && note.returnedFor !== note.dueDateTime && Date.parse(note.dueDateTime) <= now.getTime(),
    );
  }

  /**
   * Puts these notes back to Active if they're still Waiting, and records that their due date has been
   * dealt with, Waiting or not (so making one Waiting later doesn't send it back). Skips any whose due date
   * or option changed meanwhile. Saves; a note that went back to Active is in the History.
   */
  returnDue(due: Note[]): Promise<Note[]> {
    return this.enqueue(async () => {
      const dueById = new Map(due.map((note) => [note.id, note.dueDateTime]));
      const now = this.nextSaveTime();
      const returned: Note[] = [];
      let changed = false;
      const notes = this.notes.map((note) => {
        if (!note.returnWhenDue || note.dueDateTime === undefined || dueById.get(note.id) !== note.dueDateTime || note.returnedFor === note.dueDateTime) {
          return note;
        }
        changed = true;
        if (lifetimeOf(note) !== LIFETIME_WAITING) return { ...note, returnedFor: note.dueDateTime };
        const tagIds = withLifetime(note, LIFETIME_ACTIVE);
        const back: Note = {
          ...note,
          returnedFor: note.dueDateTime,
          lastModifiedDateTime: now.toISOString(),
          tagsChangedDateTime: this.tagsChangedTime(note, tagIds, now),
          tagIds,
        };
        returned.push(back);
        return back;
      });
      if (!changed) return [];
      const summary =
        returned.length === 1
          ? `${label(returned[0]!)} returned from Waiting, as it was due`
          : returned.length > 1
            ? `${plural(returned.length, "note")} returned from Waiting, as they were due`
            : undefined;
      // Only bookkeeping (no note was Waiting) isn't in the History.
      await this.save(now, { notes }, summary ? { record: { summary } } : undefined);
      return returned;
    });
  }

  /** Records that these notes' reminders were sent, unless their due date has changed meanwhile. Saves. */
  markReminded(sent: Note[]): Promise<void> {
    return this.enqueue(async () => {
      const dueById = new Map(sent.map((note) => [note.id, note.dueDateTime]));
      let changed = false;
      const notes = this.notes.map((note) => {
        if (note.dueDateTime === undefined || dueById.get(note.id) !== note.dueDateTime) return note;
        changed = true;
        return { ...note, reminderSentFor: note.dueDateTime };
      });
      // Bookkeeping rather than a change of yours, so it isn't in the history.
      if (changed) await this.save(this.nextSaveTime(), { notes });
    });
  }

  /**
   * `notes` (what's left after deleting some) with the deleted notes' children taken out of them: they
   * lose their parent. Tidying up, so their modified times stay as they are. Undoing the delete in the
   * History puts the parents back, as it brings back the whole notebook as it was.
   */
  private withoutParents(notes: Note[]): Note[] {
    const ids = new Set(notes.map((n) => n.id));
    return notes.map((note) => {
      if (note.parentId === undefined || ids.has(note.parentId)) return note;
      const { parentId: _gone, ...rest } = note;
      return rest;
    });
  }

  /**
   * The parent a note is being given, checked: a long-form note in this notebook, and (for an existing
   * note, `childId`) not the note itself or one of its own descendants, which would make a loop.
   */
  private parentFor(rawParentId: unknown, childId?: number): number {
    const parent = Number.isInteger(rawParentId) ? this.notes.find((n) => n.id === rawParentId) : undefined;
    if (!parent || !isLongForm(parent)) {
      throw new RequestError(400, `Note ${String(rawParentId)} isn't a long-form note in this notebook, so it can't be a parent.`);
    }
    if (childId !== undefined && (parent.id === childId || isAncestor(this.notes, childId, parent.id))) {
      throw new RequestError(400, "A note can't be put inside itself or one of its own child notes.");
    }
    return parent.id;
  }

  /** How a change of parent is described in the history, e.g. `Moved "Book flights" under "Holiday plans"`. */
  private moveSummary(what: string, from: number | undefined, to: number | undefined): string {
    const name = (id: number | undefined) => {
      const note = id === undefined ? undefined : this.notes.find((n) => n.id === id);
      return note ? label(note) : "its parent note";
    };
    return to !== undefined ? `Moved ${what} under ${name(to)}` : `Took ${what} out of ${name(from)}`;
  }

  /** The note order with deleted notes' ids taken out. */
  private orderKeepingNotes(notes: Note[]): number[] {
    const ids = new Set(notes.map((n) => n.id));
    return this.noteOrder.filter((id) => ids.has(id));
  }

  /**
   * Moves every note with one Lifetime to another in a single save. With `rawNoteIds`, only those notes
   * (any that are missing or no longer have the `from` Lifetime are skipped). Returns how many changed.
   */
  private changeLifetimes(from: number, to: number, rawNoteIds?: unknown): Promise<number> {
    return this.enqueue(async () => {
      let only: Set<number> | undefined;
      if (rawNoteIds !== undefined) {
        if (!Array.isArray(rawNoteIds) || !rawNoteIds.every((id) => Number.isInteger(id))) {
          throw new RequestError(400, '"noteIds" must be a list of ids.');
        }
        only = new Set(rawNoteIds as number[]);
      }
      const changing = (n: Note) => lifetimeOf(n) === from && (only === undefined || only.has(n.id));
      const count = this.notes.filter(changing).length;
      if (count === 0) return 0;
      const now = this.nextSaveTime();
      const timestamp = now.toISOString();
      const notes = this.notes.map((n) =>
        changing(n)
          ? { ...n, lastModifiedDateTime: timestamp, tagsChangedDateTime: timestamp, tagIds: withLifetime(n, to) }
          : n,
      );
      const summary =
        from === LIFETIME_NEW
          ? `Reset New (${plural(count, "note")} made Active)`
          : from === LIFETIME_WAITING
            ? `Waiting to Archived (${plural(count, "note")} archived)`
            : `Archived to Bin (${plural(count, "note")} moved to the bin)`;
      await this.save(now, { notes }, { record: { summary } });
      return count;
    });
  }

  /** Checks and adds a new category, then saves. */
  addCategory(raw: unknown): Promise<Category> {
    return this.enqueue(async () => {
      const check = validateCategory(raw, this.categories);
      if (!check.ok) throw new RequestError(400, check.error);

      const category: Category = {
        // Never a deleted category's id, so nothing kept for that one (on a device, or in the History) applies to this.
        id: await nextCategoryId(this.db),
        name: check.category.name,
        multiSelect: check.category.multiSelect,
        tags: await this.withTagIds(check.category.tags),
      };
      await this.save(this.nextSaveTime(), { categories: [...this.categories, category] }, {
        record: { summary: `Added category "${category.name}"` },
      });
      return category;
    });
  }

  /** Checks and applies changes to a category (renamed tags keep their ids), then saves. */
  updateCategory(id: number, raw: unknown): Promise<Category> {
    return this.enqueue(async () => {
      const existing = this.categories.find((c) => c.id === id);
      if (!existing) throw new RequestError(404, `There is no category with id ${id}. It may have been deleted on another page.`);
      const check = validateCategory(raw, this.categories, existing);
      if (!check.ok) throw new RequestError(400, check.error);

      const category: Category = {
        id,
        name: check.category.name,
        multiSelect: check.category.multiSelect,
        // The tags keep the order they were sent in: that is the category's tag order.
        tags: await this.withTagIds(check.category.tags),
      };
      const categories = this.categories.map((c) => (c.id === id ? category : c));
      const record = { summary: `Changed category "${category.name}"` };

      // Tags left out were deleted: take them off every note, and out of every tab's filter
      // (a filter left with no tags is dropped; a tab left with no filters shows every note).
      const deleted = existing.tags.filter((tag) => !category.tags.some((t) => t.id === tag.id)).map((tag) => tag.id);
      // Changed to single-select: a note with several of its tags keeps only the first, in the category's order.
      const nowSingle = existing.multiSelect && !category.multiSelect;
      if (deleted.length === 0 && !nowSingle) {
        await this.save(this.nextSaveTime(), { categories }, { record });
        return category;
      }
      // Like deleting a tag, this is tidying up, so the notes' modified and tags-changed times stay as they are.
      const notes = this.notes.map((note) => {
        let tagIds = note.tagIds.filter((tagId) => !deleted.includes(tagId));
        if (nowSingle) {
          const kept = category.tags.find((tag) => tagIds.includes(tag.id))?.id;
          tagIds = tagIds.filter((tagId) => tagId === kept || !category.tags.some((tag) => tag.id === tagId));
        }
        return tagIds.length === note.tagIds.length ? note : { ...note, tagIds };
      });
      if (deleted.length === 0) {
        await this.save(this.nextSaveTime(), { categories, notes }, { record });
        return category;
      }
      const tabs = this.tabs.map((tab) => ({
        ...tab,
        categories: tab.categories
          .map((filter) => ({ ...filter, tagIds: filter.tagIds.filter((tagId) => !deleted.includes(tagId)) }))
          .filter((filter) => filter.tagIds.length > 0),
      }));
      await this.save(this.nextSaveTime(), { categories, notes, tabs }, { record });
      return category;
    });
  }

  /**
   * Deletes a category: its tags come off every note (the notes stay, with their times unchanged, as for
   * deleting a tag), and it's dropped from every tab's filter (a tab left with no filters shows every note).
   */
  deleteCategory(id: number): Promise<void> {
    return this.enqueue(async () => {
      // Lifetime and "Shared with me" have negative ids.
      if (id < 0) throw new RequestError(400, "The built-in categories can't be deleted.");
      const existing = this.categories.find((c) => c.id === id);
      if (!existing) throw new RequestError(404, `There is no category with id ${id}. It may have been deleted on another page.`);
      const deleted = new Set(existing.tags.map((tag) => tag.id));
      const notes = this.notes.map((note) => {
        const tagIds = note.tagIds.filter((tagId) => !deleted.has(tagId));
        return tagIds.length === note.tagIds.length ? note : { ...note, tagIds };
      });
      const tabs = this.tabs.map((tab) =>
        tab.categories.some((filter) => filter.categoryId === id) ? { ...tab, categories: tab.categories.filter((filter) => filter.categoryId !== id) } : tab,
      );
      await this.save(
        this.nextSaveTime(),
        { categories: this.categories.filter((c) => c.id !== id), notes, tabs },
        { record: { summary: `Deleted category "${existing.name}"` } },
      );
    });
  }

  /** Where the built-in "All" tab shows (PUT /api/tabs/all), then saves. */
  setAllTabPlacement(raw: unknown): Promise<TabPlacement> {
    return this.enqueue(async () => {
      const placement = (raw as { placement?: unknown } | undefined)?.placement;
      if (placement !== "top" && placement !== "left") throw new RequestError(400, '"placement" must be "top" or "left".');
      await this.save(this.nextSaveTime(), { allTabPlacement: placement }, {
        record: { summary: `Moved the All tab to the ${placement}` },
      });
      return placement;
    });
  }

  /** Checks and adds a new tab, then saves. `shared`: the user's "Shared with me" category, if they have one. */
  addTab(raw: unknown, shared: Category[] = []): Promise<Tab> {
    return this.enqueue(async () => {
      const check = validateTab(raw, this.tabs, [...this.categories, ...shared, LIFETIME_CATEGORY]);
      if (!check.ok) throw new RequestError(400, check.error);

      const tab: Tab = { id: this.tabs.reduce((max, t) => Math.max(max, t.id), 0) + 1, ...check.tab };
      await this.save(this.nextSaveTime(), { tabs: [...this.tabs, tab] }, { record: { summary: `Added tab "${tab.name}"` } });
      return tab;
    });
  }

  /** Checks and replaces a tab's name and filters, then saves. */
  updateTab(id: number, raw: unknown, shared: Category[] = []): Promise<Tab> {
    return this.enqueue(async () => {
      const existing = this.tabs.find((t) => t.id === id);
      if (!existing) throw new RequestError(404, `There is no tab with id ${id}.`);
      const check = validateTab(raw, this.tabs, [...this.categories, ...shared, LIFETIME_CATEGORY], existing);
      if (!check.ok) throw new RequestError(400, check.error);

      const tab: Tab = { id, ...check.tab };
      await this.save(this.nextSaveTime(), { tabs: this.tabs.map((t) => (t.id === id ? tab : t)) }, {
        record: { summary: `Changed tab "${tab.name}"` },
      });
      return tab;
    });
  }

  /**
   * Replaces the shared note order (moving notes in any tab), keeping only existing notes' ids, once each:
   * this notebook's, and `sharedIds` (other users' notes this user can see, which they order too).
   */
  setNoteOrder(raw: unknown, sharedIds: ReadonlySet<number> = new Set()): Promise<number[]> {
    return this.enqueue(async () => {
      const order = (raw as { noteOrder?: unknown } | undefined)?.noteOrder;
      if (!Array.isArray(order) || !order.every((n) => Number.isInteger(n))) {
        throw new RequestError(400, '"noteOrder" must be an array of note ids.');
      }
      const ids = new Set(this.notes.map((n) => n.id));
      const noteOrder = [...new Set(order as number[])].filter((noteId) => ids.has(noteId) || sharedIds.has(noteId));
      await this.save(this.nextSaveTime(), { noteOrder }, { record: { summary: "Changed the order of the notes" } });
      return noteOrder;
    });
  }

  /** Deletes a tab, then saves. Notes aren't changed. */
  deleteTab(id: number): Promise<void> {
    return this.enqueue(async () => {
      const existing = this.tabs.find((t) => t.id === id);
      if (!existing) throw new RequestError(404, `There is no tab with id ${id}.`);
      await this.save(this.nextSaveTime(), { tabs: this.tabs.filter((t) => t.id !== id) }, {
        record: { summary: `Deleted tab "${existing.name}"` },
      });
    });
  }

  /**
   * Puts the user categories in the order given (every user category's id, once each), then saves.
   * The built-in Lifetime category isn't stored, and always comes last.
   */
  reorderCategories(raw: unknown): Promise<Category[]> {
    return this.enqueue(async () => {
      const categories = inOrder(raw, this.categories, "category");
      await this.save(this.nextSaveTime(), { categories }, { record: { summary: "Changed the order of the categories" } });
      return this.allCategories();
    });
  }

  /** Puts the tabs in the order given (every tab's id, once each), then saves. "All" always comes first. */
  reorderTabs(raw: unknown): Promise<Tab[]> {
    return this.enqueue(async () => {
      const tabs = inOrder(raw, this.tabs, "tab");
      await this.save(this.nextSaveTime(), { tabs }, { record: { summary: "Changed the order of the tabs" } });
      return tabs;
    });
  }

  /**
   * A note's tags without any this notebook used to have but has since deleted (with their category, say):
   * a change made before the deletion, e.g. waiting offline, is saved without them rather than refused.
   */
  private async withoutDeletedTags(rawTagIds: unknown): Promise<unknown> {
    if (!Array.isArray(rawTagIds)) return rawTagIds;
    const exists = (id: unknown) => this.categories.some((category) => category.tags.some((tag) => tag.id === id));
    const missing = rawTagIds.filter((id): id is number => Number.isInteger(id) && !exists(id));
    if (missing.length === 0) return rawTagIds;
    const deleted = await formerTagIds(this.db, this.userId, missing);
    return rawTagIds.filter((id) => !deleted.has(id as number));
  }

  /** Gives new tags new ids, which are unique across all users' categories and never reused. */
  private async withTagIds(tags: CategoryRequest["tags"]): Promise<Category["tags"]> {
    const ids = await nextTagIds(this.db, tags.filter((tag) => tag.id === undefined).length);
    return tags.map((tag) => ({ id: tag.id ?? ids.shift()!, name: tag.name, ...(tag.hue !== undefined && { hue: tag.hue }) }));
  }

  private enqueue<T>(change: () => Promise<T>): Promise<T> {
    if (!this.ready) return Promise.reject(databaseUnreachable());
    const result = this.queue.then(change);
    // Keep the queue going even if this change fails.
    this.queue = result.catch(() => undefined);
    return result;
  }

  /**
   * End-to-end tests only: deletes everything, history included, and starts again from `seedText` (a
   * save-file's contents), imported as the history's first change, so every test starts the same way.
   */
  resetTo(seedText: string): Promise<void> {
    return this.enqueue(async () => {
      const seed = snapshotOf(parseSaveFile("seed", seedText));
      await this.db.transaction(async (query) => {
        await emptyNotebook(query, this.userId);
        await markSetUp(query, this.userId);
      });
      this.apply(EMPTY);
      this.lastLongFormUpdate = undefined;
      await this.save(this.nextSaveTime(), seed, { record: { summary: "Imported the test data" } });
      // Every other notebook has just been removed, so new ids start again straight after the seed's.
      await this.db.transaction((query) => syncIdSequences(query, true));
    });
  }

  /** Change times must be in order, so never reuse a time or go back in time. */
  private nextSaveTime(): Date {
    return new Date(Math.max(Date.now(), this.lastSaveMs + 1));
  }

  /**
   * Saves the current data with `change` applied (only the parts given are replaced): the rows that
   * differ, and the history entry (`options.record`), in one transaction. Memory is only updated once
   * that succeeded. Repeated autosaves of a long-form note being edited (`longFormUpdateId`) join the
   * previous change if it was an update of the same note, so a long editing session is one change.
   */
  private async save(now: Date, change: Partial<Snapshot>, options: SaveOptions = {}): Promise<void> {
    // A change made by someone a tag is shared with says who, in this notebook's History.
    const acting = actingUser.getStore();
    if (options.record && acting && acting.userId !== this.userId) {
      options = { ...options, record: { ...options.record, summary: `${options.record.summary} (by ${acting.displayName})` } };
    }
    const before = this.snapshot();
    const after: Snapshot = { ...before, ...change };
    // Only the same person's autosaves join: someone else's start a change of their own.
    const actingId = acting?.userId ?? this.userId;
    const join =
      options.longFormUpdateId !== undefined &&
      this.lastLongFormUpdate?.noteId === options.longFormUpdateId &&
      this.lastLongFormUpdate.userId === actingId
        ? this.lastLongFormUpdate.changeId
        : undefined;
    const changeId = await writeChange(this.db, this.userId, before, after, now, options.record, join);
    this.apply(after);
    this.lastSaveMs = now.getTime();
    this.lastLongFormUpdate =
      options.longFormUpdateId !== undefined && changeId !== undefined ? { noteId: options.longFormUpdateId, changeId, userId: actingId } : undefined;
    this.onSaved?.();
  }
}
