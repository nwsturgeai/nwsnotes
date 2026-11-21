import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CLIENT_ID_MAX_LENGTH,
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
} from "@nwsnotes/shared";
import { databaseUnreachable, type Db } from "./db.js";
import { RequestError } from "./errors.js";
import {
  emptyNotebook,
  listChanges,
  loadSnapshot,
  oldTabOrders,
  revertedSnapshot,
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
  /** The highest note id ever given, so ids are never reused. Missing in older files. */
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

const LONG_FORM_NO_DUE_DATE = "Long-form notes can't have a due date.";

/** A reminder is sent this late at most (e.g. when the server was down as the note fell due). */
const REMINDER_LATEST_MS = 24 * 60 * 60 * 1000;

/** Lifetimes that get reminders: not Archived or Bin. */
const REMINDED_LIFETIMES = [LIFETIME_NEW, LIFETIME_ACTIVE, LIFETIME_WAITING];

/**
 * A note's due date and reminder record after an add or edit. An unchanged due date keeps its record;
 * a due date that's already past counts as reminded, since it didn't just pass.
 */
function dueDateFields(dueDateTime: string | undefined, existing: Note | undefined, now: Date): Partial<Note> {
  if (dueDateTime === undefined) return {};
  const reminderSentFor =
    existing?.dueDateTime === dueDateTime
      ? existing.reminderSentFor
      : Date.parse(dueDateTime) <= now.getTime()
        ? dueDateTime
        : undefined;
  return { dueDateTime, ...(reminderSentFor !== undefined && { reminderSentFor }) };
}

/** A time the page sent for something done offline, if it's valid and not after `now`; otherwise undefined. */
function offlineTime(raw: unknown, now: Date): string | undefined {
  const ms = typeof raw === "string" ? Date.parse(raw) : NaN;
  // NaN (none sent, or invalid) fails the comparison.
  return ms <= now.getTime() ? new Date(ms).toISOString() : undefined;
}

const FILE_PATTERN = /^notes-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.json$/;

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

/** "notes-2026-10-24T09-40-12-345Z.json" -> Date, or undefined if it isn't a save-file. */
function dateFromFileName(name: string): Date | undefined {
  const match = FILE_PATTERN.exec(name);
  if (!match) return undefined;
  const [, stamp] = match;
  // 2026-10-24T09-40-12-345Z -> 2026-10-24T09:40:12.345Z
  const iso = stamp!.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z");
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Reads a save-file of either version as the current version. */
function parseSaveFile(name: string, text: string): Required<SaveFile> {
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
      lastNoteId: Math.max(0, ...content.notes.map((n) => n.id)),
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
  return {
    ...content,
    tabs: tabs.map(withoutNoteOrder),
    // Files from before the order was shared have the tabs' own orders instead: one is made from them.
    noteOrder: (Array.isArray(content.noteOrder)
      ? [...new Set(content.noteOrder.filter((id) => Number.isInteger(id)))]
      : mergeNoteOrders(oldTabOrders(tabs))
    ).filter((id) => ids.has(id)),
    // Files saved before notes could be deleted have no "lastNoteId"; the highest id present is right for them.
    lastNoteId: typeof content.lastNoteId === "number" ? content.lastNoteId : Math.max(0, ...content.notes.map((n) => n.id)),
    allTabPlacement: content.allTabPlacement === "left" ? "left" : "top",
  };
}

/** A save-file's contents as the store's data, with notes from before Lifetime and tag-change times brought up to date. */
function snapshotOf(content: Required<SaveFile>): Snapshot {
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
    lastNoteId: content.lastNoteId,
    allTabPlacement: content.allTabPlacement,
    noteOrder: content.noteOrder,
  };
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
  /** The highest note id ever given; new notes get the next one, so ids are never reused. */
  private lastNoteId = 0;
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
  private lastLongFormUpdate: { noteId: number; changeId: number } | undefined;
  /** Changes run one at a time, in order. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly db: Db,
    /** Holds the save-files from before the database (only user 1's notebook imports them). */
    private readonly dataDir: string,
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
      // The first start with this database: bring across the latest save-file (from before the database,
      // when there was one notebook, so only into the admin's), if there is one.
      const latest = this.userId === 1 ? (await this.listSaveFiles()).at(-1) : undefined;
      const empty: Snapshot = { notes: [], categories: [], tabs: [], lastNoteId: 0, allTabPlacement: "top", noteOrder: [] };
      if (latest) {
        const content = parseSaveFile(latest.name, await readFile(path.join(this.dataDir, latest.name), "utf8"));
        await writeChange(this.db, this.userId, empty, snapshotOf(content), this.nextSaveTime(), { summary: `Imported from ${latest.name}` });
        this.apply(snapshotOf(content));
        console.log(`Imported ${this.notes.length} notes from ${latest.name} into the database.`);
      } else {
        // Marks the database as set up (lastNoteId is stored), so a later start doesn't import anything.
        await writeChange(this.db, this.userId, { ...empty, lastNoteId: -1 }, empty, this.nextSaveTime(), undefined);
        console.log("No data or save-files yet; starting with no notes.");
      }
    }
    this.ready = true;
  }

  private snapshot(): Snapshot {
    return {
      notes: this.notes,
      categories: this.categories,
      tabs: this.tabs,
      lastNoteId: this.lastNoteId,
      allTabPlacement: this.allTabPlacement,
      noteOrder: this.noteOrder,
    };
  }

  private apply(snapshot: Snapshot) {
    this.notes = snapshot.notes;
    this.categories = snapshot.categories;
    this.tabs = snapshot.tabs;
    this.lastNoteId = snapshot.lastNoteId;
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
      lastNoteId: this.lastNoteId,
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
      // A reminder already sent for a note's due date isn't sent again because the note came back.
      const current = new Map(this.notes.map((note) => [note.id, note]));
      const notes = result.snapshot.notes.map((note) => {
        const sent = current.get(note.id)?.reminderSentFor;
        return sent !== undefined && note.dueDateTime === sent && note.reminderSentFor !== sent ? { ...note, reminderSentFor: sent } : note;
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
      await this.save(this.nextSaveTime(), { ...content, lastNoteId: Math.max(content.lastNoteId, this.lastNoteId) }, {
        record: { summary: `Restored from ${name}` },
      });
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
   * End-to-end tests only: empties the database and puts a save-file in the data folder, then loads,
   * as the first start with a new database does (so the file is imported). The file is removed afterwards.
   */
  importForTests(saveFileText: string): Promise<string> {
    return this.enqueue(async () => {
      const name = fileNameFor(new Date());
      const file = path.join(this.dataDir, name);
      await writeFile(file, saveFileText, "utf8");
      try {
        await this.db.transaction((query) => emptyNotebook(query, this.userId));
        this.lastLongFormUpdate = undefined;
        await this.load();
      } finally {
        await unlink(file);
      }
      return name;
    });
  }

  /**
   * Adds a note (title and details already validated) and saves. Resolves once it is on disk.
   * With details it's a long-form note; with a parent id it's a child of an open long-form note.
   * `created` says whether it was new: an add with a `clientId` the store already has returns that
   * note unchanged (a retried add whose reply was lost). A valid `createdDateTime` that isn't in the
   * future (a note written offline) is kept as its created time, and likewise `tagsChangedDateTime`
   * (its tags changed offline before it was sent); without one, its tags were set when it was created.
   * `dueDateTime` (already validated) is for regular notes only.
   */
  add(
    title: NoteTitle,
    rawTagIds: unknown,
    details: NoteDetails | undefined,
    rawParentId: unknown,
    options: {
      dueDateTime?: string;
      clientId?: unknown;
      createdDateTime?: unknown;
      tagsChangedDateTime?: unknown;
      noteLimit?: number;
      stylusNoteLimit?: number;
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
          `You've reached your limit of ${options.noteLimit} notes. Empty the Bin to make room, or ask the admin for a higher limit.`,
        );
      }
      if (isStylusNote({ ...title, ...details })) this.checkStylusNoteLimit(options.stylusNoteLimit);
      const tagIds = validateTagIds(withoutLifetime(rawTagIds), this.categories);
      if (!tagIds.ok) throw new RequestError(400, tagIds.error);
      if (details && title.titleText === undefined) {
        throw new RequestError(400, "A long-form note's title must be typed text.");
      }
      if (details && options.dueDateTime !== undefined) throw new RequestError(400, LONG_FORM_NO_DUE_DATE);
      let parentId: number | undefined;
      if (rawParentId !== undefined && rawParentId !== null) {
        const parent = this.notes.find((n) => n.id === rawParentId);
        if (!parent || !isLongForm(parent)) {
          throw new RequestError(400, `Note ${String(rawParentId)} isn't a long-form note, so it can't have child notes.`);
        }
        if (details) throw new RequestError(400, "A long-form note can't be the child of another one.");
        parentId = parent.id;
      }

      const now = this.nextSaveTime();
      const timestamp = now.toISOString();
      const createdDateTime = offlineTime(options.createdDateTime, now) ?? timestamp;
      const note: Note = {
        id: this.lastNoteId + 1,
        ...title,
        ...details,
        ...(parentId !== undefined && { parentId }),
        ...dueDateFields(options.dueDateTime, undefined, now),
        createdDateTime,
        lastModifiedDateTime: timestamp,
        tagsChangedDateTime: offlineTime(options.tagsChangedDateTime, now) ?? createdDateTime,
        // New notes are always New.
        tagIds: [...tagIds.value, LIFETIME_NEW],
        ...(clientId !== undefined && { clientId }),
      };
      await this.save(now, { notes: [...this.notes, note], lastNoteId: note.id }, {
        record: { summary: `Added ${details ? "long-form note " : ""}${label(note)}` },
      });
      return { note, created: true };
    });
  }

  /**
   * Refuses a new stylus note when the notebook already has `limit` of them (archived and Bin included).
   * Called in the queue of changes, so two at once can't both slip under it.
   */
  private checkStylusNoteLimit(limit: number | undefined): void {
    if (limit === undefined || this.notes.filter(isStylusNote).length < limit) return;
    throw new RequestError(
      409,
      `You've reached your limit of ${limit} stylus notes. Empty the Bin to make room, or ask the admin for a higher limit.`,
    );
  }

  /**
   * Replaces a note's title (already validated) and tags, then saves. The note keeps its id, its
   * created time (so its place in the list) and its type: typed notes stay typed, handwritten stay handwritten.
   * Sending details for a regular note converts it to a long-form note ("Convert to long-form note").
   * If the tags really change, `tagsChangedDateTime` (an offline change's time) or now becomes their
   * changed time. `dueDateTime` (already validated; regular notes only) replaces the note's, so
   * leaving it out clears it.
   */
  updateNote(
    id: number,
    title: NoteTitle,
    rawTagIds: unknown,
    details: NoteDetails | undefined,
    options: { dueDateTime?: string; tagsChangedDateTime?: unknown; stylusNoteLimit?: number } = {},
  ): Promise<Note> {
    return this.enqueue(async () => {
      const existing = this.notes.find((n) => n.id === id);
      if (!existing) throw new RequestError(404, `There is no note with id ${id}.`);
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
      // details becomes long-form, if it could have been created as one: a typed title, and no parent.
      const longForm = isLongForm(existing);
      if (longForm && details === undefined) {
        throw new RequestError(400, "This is a long-form note, so it must be updated with its details.");
      }
      if (!longForm && details !== undefined) {
        if (title.titleText === undefined) throw new RequestError(400, "A long-form note's title must be typed text.");
        if (existing.parentId !== undefined) {
          throw new RequestError(400, "This note belongs to a long-form note, so it can't become one itself.");
        }
      }
      if (longForm && details && (existing.detailsImage !== undefined) !== (details.detailsImage !== undefined)) {
        throw new RequestError(
          400,
          existing.detailsImage !== undefined
            ? "This note's details are handwritten, so they must be updated with a new image, not text."
            : "This note's details are typed, so they must be updated with new text, not an image.",
        );
      }
      if (details !== undefined && options.dueDateTime !== undefined) throw new RequestError(400, LONG_FORM_NO_DUE_DATE);
      const tagIds = validateTagIds(withoutLifetime(rawTagIds), this.categories);
      if (!tagIds.ok) throw new RequestError(400, tagIds.error);
      // A typed note converted to a long-form note with handwritten details becomes a stylus note.
      if (!isStylusNote(existing) && isStylusNote({ ...title, ...details })) this.checkStylusNoteLimit(options.stylusNoteLimit);

      const now = this.nextSaveTime();
      // Editing keeps the note's Lifetime.
      const newTagIds = [...tagIds.value, lifetimeOf(existing)];
      const note: Note = {
        id,
        ...title,
        ...details,
        // A child keeps its parent.
        ...(existing.parentId !== undefined && { parentId: existing.parentId }),
        ...dueDateFields(options.dueDateTime, existing, now),
        createdDateTime: existing.createdDateTime,
        lastModifiedDateTime: now.toISOString(),
        tagsChangedDateTime: this.tagsChangedTime(existing, newTagIds, now, options.tagsChangedDateTime),
        tagIds: newTagIds,
      };
      // Repeated saves of a long-form note being edited replace each other (see save()).
      const summary = longForm
        ? `Edited long-form note ${label(note)}`
        : details
          ? `Made ${label(note)} a long-form note`
          : `Edited ${label(note)}`;
      await this.save(now, { notes: this.notes.map((n) => (n.id === id ? note : n)) }, {
        record: { summary },
        longFormUpdateId: longForm ? id : undefined,
      });
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

  /** The Settings "Reset New" button: every New note becomes Active. Returns how many changed. */
  resetNew(): Promise<number> {
    return this.changeLifetimes(LIFETIME_NEW, LIFETIME_ACTIVE);
  }

  /** The Settings "Archived to Bin" button: every Archived note is moved to the Bin. Returns how many. */
  archivedToBin(): Promise<number> {
    return this.changeLifetimes(LIFETIME_ARCHIVED, LIFETIME_BIN);
  }

  /** The Settings "Empty Bin" button: every Bin note is deleted. Returns how many. */
  emptyBin(): Promise<number> {
    return this.enqueue(async () => {
      const kept = this.notes.filter((n) => lifetimeOf(n) !== LIFETIME_BIN);
      const count = this.notes.length - kept.length;
      if (count > 0) {
        await this.save(this.nextSaveTime(), { notes: kept, noteOrder: this.orderKeepingNotes(kept) }, {
          record: { summary: `Emptied the bin (${plural(count, "note")} deleted)` },
        });
      }
      return count;
    });
  }

  /** Deletes one note (cancelling a new long-form note), then saves. Child notes keep their `parentId`. */
  deleteNote(id: number): Promise<void> {
    return this.enqueue(async () => {
      const existing = this.notes.find((n) => n.id === id);
      if (!existing) throw new RequestError(404, `There is no note with id ${id}.`);
      const notes = this.notes.filter((n) => n.id !== id);
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
   * ago), and not yet reminded for this due date.
   */
  dueForReminder(now: Date): Note[] {
    return this.notes.filter((note) => {
      if (note.dueDateTime === undefined || note.reminderSentFor === note.dueDateTime) return false;
      if (!REMINDED_LIFETIMES.includes(lifetimeOf(note))) return false;
      const late = now.getTime() - Date.parse(note.dueDateTime);
      return late >= 0 && late < REMINDER_LATEST_MS;
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

  /** The note order with deleted notes' ids taken out. */
  private orderKeepingNotes(notes: Note[]): number[] {
    const ids = new Set(notes.map((n) => n.id));
    return this.noteOrder.filter((id) => ids.has(id));
  }

  /** Moves every note with one Lifetime to another in a single save. Returns how many changed. */
  private changeLifetimes(from: number, to: number): Promise<number> {
    return this.enqueue(async () => {
      const count = this.notes.filter((n) => lifetimeOf(n) === from).length;
      if (count === 0) return 0;
      const now = this.nextSaveTime();
      const timestamp = now.toISOString();
      const notes = this.notes.map((n) =>
        lifetimeOf(n) === from
          ? { ...n, lastModifiedDateTime: timestamp, tagsChangedDateTime: timestamp, tagIds: withLifetime(n, to) }
          : n,
      );
      const summary =
        from === LIFETIME_NEW
          ? `Reset New (${plural(count, "note")} made Active)`
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
        id: this.categories.reduce((max, c) => Math.max(max, c.id), 0) + 1,
        name: check.category.name,
        multiSelect: check.category.multiSelect,
        tags: this.withTagIds(check.category.tags),
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
      if (!existing) throw new RequestError(404, `There is no category with id ${id}.`);
      const check = validateCategory(raw, this.categories, existing);
      if (!check.ok) throw new RequestError(400, check.error);

      const category: Category = {
        id,
        name: check.category.name,
        multiSelect: check.category.multiSelect,
        // The tags keep the order they were sent in: that is the category's tag order.
        tags: this.withTagIds(check.category.tags),
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

  /** Checks and adds a new tab, then saves. */
  addTab(raw: unknown): Promise<Tab> {
    return this.enqueue(async () => {
      const check = validateTab(raw, this.tabs, this.allCategories());
      if (!check.ok) throw new RequestError(400, check.error);

      const tab: Tab = { id: this.tabs.reduce((max, t) => Math.max(max, t.id), 0) + 1, ...check.tab };
      await this.save(this.nextSaveTime(), { tabs: [...this.tabs, tab] }, { record: { summary: `Added tab "${tab.name}"` } });
      return tab;
    });
  }

  /** Checks and replaces a tab's name and filters, then saves. */
  updateTab(id: number, raw: unknown): Promise<Tab> {
    return this.enqueue(async () => {
      const existing = this.tabs.find((t) => t.id === id);
      if (!existing) throw new RequestError(404, `There is no tab with id ${id}.`);
      const check = validateTab(raw, this.tabs, this.allCategories(), existing);
      if (!check.ok) throw new RequestError(400, check.error);

      const tab: Tab = { id, ...check.tab };
      await this.save(this.nextSaveTime(), { tabs: this.tabs.map((t) => (t.id === id ? tab : t)) }, {
        record: { summary: `Changed tab "${tab.name}"` },
      });
      return tab;
    });
  }

  /** Replaces the shared note order (moving notes in any tab), keeping only existing notes' ids, once each. */
  setNoteOrder(raw: unknown): Promise<number[]> {
    return this.enqueue(async () => {
      const order = (raw as { noteOrder?: unknown } | undefined)?.noteOrder;
      if (!Array.isArray(order) || !order.every((n) => Number.isInteger(n))) {
        throw new RequestError(400, '"noteOrder" must be an array of note ids.');
      }
      const ids = new Set(this.notes.map((n) => n.id));
      const noteOrder = [...new Set(order as number[])].filter((noteId) => ids.has(noteId));
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

  /** Gives new tags the next ids; tag ids are unique across all categories. */
  private withTagIds(tags: CategoryRequest["tags"]): Category["tags"] {
    let nextId = this.categories.flatMap((c) => c.tags).reduce((max, t) => Math.max(max, t.id), 0) + 1;
    return tags.map((tag) => ({ id: tag.id ?? nextId++, name: tag.name, ...(tag.hue !== undefined && { hue: tag.hue }) }));
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
      await this.db.transaction((query) => emptyNotebook(query, this.userId));
      this.apply({ notes: [], categories: [], tabs: [], lastNoteId: -1, allTabPlacement: "top", noteOrder: [] });
      this.lastLongFormUpdate = undefined;
      await this.save(this.nextSaveTime(), seed, { record: { summary: "Imported the test data" } });
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
    const before = this.snapshot();
    const after: Snapshot = { ...before, ...change };
    const join =
      options.longFormUpdateId !== undefined && this.lastLongFormUpdate?.noteId === options.longFormUpdateId
        ? this.lastLongFormUpdate.changeId
        : undefined;
    const changeId = await writeChange(this.db, this.userId, before, after, now, options.record, join);
    this.apply(after);
    this.lastSaveMs = now.getTime();
    this.lastLongFormUpdate =
      options.longFormUpdateId !== undefined && changeId !== undefined ? { noteId: options.longFormUpdateId, changeId } : undefined;
  }

  /** Save-files in the data folder (from before the database), oldest first. */
  private async listSaveFiles(): Promise<{ name: string; date: Date }[]> {
    const names = await readdir(this.dataDir);
    return names
      .map((name) => ({ name, date: dateFromFileName(name) }))
      .filter((file): file is { name: string; date: Date } => file.date !== undefined)
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }
}
