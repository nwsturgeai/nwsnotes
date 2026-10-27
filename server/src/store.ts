import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  isLifetimeTag,
  isLongForm,
  lifetimeOf,
  LIFETIME_ACTIVE,
  LIFETIME_ARCHIVED,
  LIFETIME_BIN,
  LIFETIME_CATEGORY,
  LIFETIME_CHANGES,
  LIFETIME_NEW,
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
} from "@nwsnotes/shared";

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
}

/** The data the store keeps and saves. */
type StoreData = Pick<NotesData, "notes" | "categories" | "tabs"> & { lastNoteId: number };

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

/** An error caused by the request, reported to the website with this HTTP status. */
export class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const FILE_PATTERN = /^notes-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.json$/;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

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
    };
  }
  if (content.version !== 2 || !Array.isArray(content.categories)) {
    throw new Error(`Save-file ${name} has an unknown format (version ${String((content as { version?: unknown }).version)}).`);
  }
  return {
    ...content,
    // Files saved before tabs existed have no "tabs" list.
    // Tabs saved before ordering existed have no "noteOrder".
    tabs: (Array.isArray(content.tabs) ? content.tabs : []).map((tab) => ({
      ...tab,
      noteOrder: Array.isArray(tab.noteOrder) ? tab.noteOrder : [],
    })),
    // Files saved before notes could be deleted have no "lastNoteId"; the highest id present is right for them.
    lastNoteId: typeof content.lastNoteId === "number" ? content.lastNoteId : Math.max(0, ...content.notes.map((n) => n.id)),
  };
}

/**
 * Keeps all notes, categories and tabs in memory and writes a complete, timestamped
 * save-file to disk every time anything changes.
 */
export class NoteStore {
  private notes: Note[] = [];
  private categories: Category[] = [];
  private tabs: Tab[] = [];
  /** The highest note id ever given; new notes get the next one, so ids are never reused. */
  private lastNoteId = 0;
  private lastSaveMs = 0;
  private latestFileName: string | undefined;
  /**
   * Set when the latest save-file was written for an update of this long-form note. Anything else
   * (creating it, other changes, a restart) clears it, so the file it describes is kept.
   */
  private lastLongFormUpdateId: number | undefined;
  /** Changes run one at a time, in order. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly dataDir: string) {}

  /** Loads the most recent save-file (if any) and tidies up old ones. */
  async init(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const files = await this.listSaveFiles();
    const latest = files.at(-1);
    if (latest) {
      const content = parseSaveFile(latest.name, await readFile(path.join(this.dataDir, latest.name), "utf8"));
      // Notes saved before Lifetime existed become Active (stored with the next save).
      this.notes = content.notes.map((note) =>
        note.tagIds.some(isLifetimeTag) ? note : { ...note, tagIds: [...note.tagIds, LIFETIME_ACTIVE] },
      );
      this.categories = content.categories;
      this.tabs = content.tabs;
      this.lastNoteId = content.lastNoteId;
      this.lastSaveMs = latest.date.getTime();
      this.latestFileName = latest.name;
      console.log(
        `Loaded ${this.notes.length} notes, ${this.categories.length} categories and ${this.tabs.length} tabs from ${latest.name}`,
      );
    } else {
      console.log(`No save-files in ${this.dataDir}; starting with no notes.`);
    }
    await this.deleteOldFiles();
  }

  getAll(): NotesData {
    return { notes: this.notes, categories: this.allCategories(), tabs: this.tabs };
  }

  /** User categories plus the built-in Lifetime category (which tabs can filter on). */
  private allCategories(): Category[] {
    return [...this.categories, LIFETIME_CATEGORY];
  }

  /** The most recent save-file, or undefined if nothing has been saved yet. */
  latestSaveFile(): { name: string; path: string } | undefined {
    if (!this.latestFileName) return undefined;
    return { name: this.latestFileName, path: path.join(this.dataDir, this.latestFileName) };
  }

  /**
   * Adds a note (title and details already validated) and saves. Resolves once it is on disk.
   * With details it's a long-form note; with a parent id it's a child of an open long-form note.
   */
  add(title: NoteTitle, rawTagIds: unknown, details: NoteDetails | undefined, rawParentId: unknown): Promise<Note> {
    return this.enqueue(async () => {
      const tagIds = validateTagIds(withoutLifetime(rawTagIds), this.categories);
      if (!tagIds.ok) throw new RequestError(400, tagIds.error);
      if (details && title.titleText === undefined) {
        throw new RequestError(400, "A long-form note's title must be typed text.");
      }
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
      const note: Note = {
        id: this.lastNoteId + 1,
        ...title,
        ...details,
        ...(parentId !== undefined && { parentId }),
        createdDateTime: timestamp,
        lastModifiedDateTime: timestamp,
        // New notes are always New.
        tagIds: [...tagIds.value, LIFETIME_NEW],
      };
      await this.save(now, { notes: [...this.notes, note], lastNoteId: note.id });
      return note;
    });
  }

  /**
   * Replaces a note's title (already validated) and tags, then saves. The note keeps its id, its
   * created time (so its place in the list) and its type: typed notes stay typed, handwritten stay handwritten.
   */
  updateNote(id: number, title: NoteTitle, rawTagIds: unknown, details: NoteDetails | undefined): Promise<Note> {
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
      // A long-form note stays long-form, with the same kind of details; a regular note stays regular.
      const longForm = isLongForm(existing);
      if (longForm !== (details !== undefined)) {
        throw new RequestError(
          400,
          longForm ? "This is a long-form note, so it must be updated with its details." : "This note isn't long-form, so it can't have details.",
        );
      }
      if (details && (existing.detailsImage !== undefined) !== (details.detailsImage !== undefined)) {
        throw new RequestError(
          400,
          existing.detailsImage !== undefined
            ? "This note's details are handwritten, so they must be updated with a new image, not text."
            : "This note's details are typed, so they must be updated with new text, not an image.",
        );
      }
      const tagIds = validateTagIds(withoutLifetime(rawTagIds), this.categories);
      if (!tagIds.ok) throw new RequestError(400, tagIds.error);

      const now = this.nextSaveTime();
      const note: Note = {
        id,
        ...title,
        ...details,
        // A child keeps its parent.
        ...(existing.parentId !== undefined && { parentId: existing.parentId }),
        createdDateTime: existing.createdDateTime,
        lastModifiedDateTime: now.toISOString(),
        // Editing keeps the note's Lifetime.
        tagIds: [...tagIds.value, lifetimeOf(existing)],
      };
      // Repeated saves of a long-form note being edited replace each other (see save()).
      await this.save(now, { notes: this.notes.map((n) => (n.id === id ? note : n)) }, longForm ? id : undefined);
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
        const next: Note = {
          ...note,
          lastModifiedDateTime: now.toISOString(),
          tagIds: [...tagIds.filter((id) => id !== lifetime), lifetime],
        };
        updated.push(next);
        return next;
      });
      await this.save(now, { notes });
      return updated;
    });
  }

  /** Archives, reinstates (Active) or bins a note, then saves. */
  setLifetime(id: number, raw: unknown): Promise<Note> {
    return this.enqueue(async () => {
      const existing = this.notes.find((n) => n.id === id);
      if (!existing) throw new RequestError(404, `There is no note with id ${id}.`);
      if (typeof raw !== "string" || !(raw in LIFETIME_CHANGES)) {
        throw new RequestError(400, `"lifetime" must be one of ${Object.keys(LIFETIME_CHANGES).join(", ")}.`);
      }
      const now = this.nextSaveTime();
      const note: Note = {
        ...existing,
        lastModifiedDateTime: now.toISOString(),
        tagIds: withLifetime(existing, LIFETIME_CHANGES[raw as LifetimeChange]),
      };
      await this.save(now, { notes: this.notes.map((n) => (n.id === id ? note : n)) });
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
      if (count > 0) await this.save(this.nextSaveTime(), { notes: kept, tabs: this.tabsKeepingNotes(kept) });
      return count;
    });
  }

  /** Deletes one note (cancelling a new long-form note), then saves. Child notes keep their `parentId`. */
  deleteNote(id: number): Promise<void> {
    return this.enqueue(async () => {
      if (!this.notes.some((n) => n.id === id)) throw new RequestError(404, `There is no note with id ${id}.`);
      const notes = this.notes.filter((n) => n.id !== id);
      await this.save(this.nextSaveTime(), { notes, tabs: this.tabsKeepingNotes(notes) });
    });
  }

  /** The tabs with deleted notes' ids taken out of their `noteOrder`. */
  private tabsKeepingNotes(notes: Note[]): Tab[] {
    const ids = new Set(notes.map((n) => n.id));
    return this.tabs.map((tab) =>
      tab.noteOrder.every((id) => ids.has(id)) ? tab : { ...tab, noteOrder: tab.noteOrder.filter((id) => ids.has(id)) },
    );
  }

  /** Moves every note with one Lifetime to another in a single save. Returns how many changed. */
  private changeLifetimes(from: number, to: number): Promise<number> {
    return this.enqueue(async () => {
      const count = this.notes.filter((n) => lifetimeOf(n) === from).length;
      if (count === 0) return 0;
      const now = this.nextSaveTime();
      const notes = this.notes.map((n) =>
        lifetimeOf(n) === from ? { ...n, lastModifiedDateTime: now.toISOString(), tagIds: withLifetime(n, to) } : n,
      );
      await this.save(now, { notes });
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
      await this.save(this.nextSaveTime(), { categories: [...this.categories, category] });
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
        tags: this.withTagIds(check.category.tags).sort((a, b) => a.id - b.id),
      };
      const categories = this.categories.map((c) => (c.id === id ? category : c));

      // Tags left out were deleted: take them off every note, and out of every tab's filter
      // (a filter left with no tags is dropped; a tab left with no filters shows every note).
      const deleted = existing.tags.filter((tag) => !category.tags.some((t) => t.id === tag.id)).map((tag) => tag.id);
      if (deleted.length === 0) {
        await this.save(this.nextSaveTime(), { categories });
        return category;
      }
      const notes = this.notes.map((note) =>
        note.tagIds.some((tagId) => deleted.includes(tagId))
          ? { ...note, tagIds: note.tagIds.filter((tagId) => !deleted.includes(tagId)) }
          : note,
      );
      const tabs = this.tabs.map((tab) => ({
        ...tab,
        categories: tab.categories
          .map((filter) => ({ ...filter, tagIds: filter.tagIds.filter((tagId) => !deleted.includes(tagId)) }))
          .filter((filter) => filter.tagIds.length > 0),
      }));
      await this.save(this.nextSaveTime(), { categories, notes, tabs });
      return category;
    });
  }

  /** Checks and adds a new tab, then saves. */
  addTab(raw: unknown): Promise<Tab> {
    return this.enqueue(async () => {
      const check = validateTab(raw, this.tabs, this.allCategories());
      if (!check.ok) throw new RequestError(400, check.error);

      const tab: Tab = { id: this.tabs.reduce((max, t) => Math.max(max, t.id), 0) + 1, ...check.tab, noteOrder: [] };
      await this.save(this.nextSaveTime(), { tabs: [...this.tabs, tab] });
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

      // Editing a tab's name or filters keeps its note order.
      const tab: Tab = { id, ...check.tab, noteOrder: existing.noteOrder };
      await this.save(this.nextSaveTime(), { tabs: this.tabs.map((t) => (t.id === id ? tab : t)) });
      return tab;
    });
  }

  /** Replaces a tab's note order (dragging notes), keeping only existing notes' ids, once each. */
  setTabOrder(id: number, raw: unknown): Promise<Tab> {
    return this.enqueue(async () => {
      const existing = this.tabs.find((t) => t.id === id);
      if (!existing) throw new RequestError(404, `There is no tab with id ${id}.`);
      const order = (raw as { noteOrder?: unknown } | undefined)?.noteOrder;
      if (!Array.isArray(order) || !order.every((n) => Number.isInteger(n))) {
        throw new RequestError(400, '"noteOrder" must be an array of note ids.');
      }
      const ids = new Set(this.notes.map((n) => n.id));
      const noteOrder = [...new Set(order as number[])].filter((noteId) => ids.has(noteId));
      const tab: Tab = { ...existing, noteOrder };
      await this.save(this.nextSaveTime(), { tabs: this.tabs.map((t) => (t.id === id ? tab : t)) });
      return tab;
    });
  }

  /** Deletes a tab, then saves. Notes aren't changed. */
  deleteTab(id: number): Promise<void> {
    return this.enqueue(async () => {
      if (!this.tabs.some((t) => t.id === id)) throw new RequestError(404, `There is no tab with id ${id}.`);
      await this.save(this.nextSaveTime(), { tabs: this.tabs.filter((t) => t.id !== id) });
    });
  }

  /** Gives new tags the next ids; tag ids are unique across all categories. */
  private withTagIds(tags: CategoryRequest["tags"]): Category["tags"] {
    let nextId = this.categories.flatMap((c) => c.tags).reduce((max, t) => Math.max(max, t.id), 0) + 1;
    return tags.map((tag) => ({ id: tag.id ?? nextId++, name: tag.name }));
  }

  private enqueue<T>(change: () => Promise<T>): Promise<T> {
    const result = this.queue.then(change);
    // Keep the queue going even if this change fails.
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Save-file names must be unique and in order, so never reuse a time or go back in time. */
  private nextSaveTime(): Date {
    return new Date(Math.max(Date.now(), this.lastSaveMs + 1));
  }

  /**
   * Saves the current data with `change` applied (only the parts given are replaced).
   * `longFormUpdateId` is set when this save is an update of that long-form note: if the previous
   * save-file was too, it's deleted once this one is written, so a long editing session (saving every
   * 30 seconds) leaves one save-file rather than hundreds.
   */
  private async save(now: Date, change: Partial<StoreData>, longFormUpdateId?: number): Promise<void> {
    const replaces =
      longFormUpdateId !== undefined && this.lastLongFormUpdateId === longFormUpdateId ? this.latestFileName : undefined;
    const notes = change.notes ?? this.notes;
    const categories = change.categories ?? this.categories;
    const tabs = change.tabs ?? this.tabs;
    const lastNoteId = change.lastNoteId ?? this.lastNoteId;
    const content: SaveFile = { version: 2, savedDateTime: now.toISOString(), notes, categories, tabs, lastNoteId };

    // Write to a temporary file, then rename, so a crash can't leave a half-written save-file.
    const fileName = fileNameFor(now);
    const finalPath = path.join(this.dataDir, fileName);
    const tempPath = `${finalPath}.tmp`;
    await writeFile(tempPath, JSON.stringify(content, null, 2), "utf8");
    await rename(tempPath, finalPath);

    // Only update memory once the save succeeded.
    this.notes = notes;
    this.categories = categories;
    this.tabs = tabs;
    this.lastNoteId = lastNoteId;
    this.lastSaveMs = now.getTime();
    this.latestFileName = fileName;
    this.lastLongFormUpdateId = longFormUpdateId;

    try {
      if (replaces) await unlink(path.join(this.dataDir, replaces));
    } catch (error) {
      console.error(`Couldn't delete the replaced save-file ${replaces}:`, error);
    }
    try {
      await this.deleteOldFiles();
    } catch (error) {
      // The change is saved; a failed tidy-up shouldn't be reported as a failed save.
      console.error("Couldn't delete old save-files:", error);
    }
  }

  /** Save-files sorted oldest first. */
  private async listSaveFiles(): Promise<{ name: string; date: Date }[]> {
    const names = await readdir(this.dataDir);
    return names
      .map((name) => ({ name, date: dateFromFileName(name) }))
      .filter((file): file is { name: string; date: Date } => file.date !== undefined)
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  /** Deletes save-files older than a week, always keeping the most recent one. */
  private async deleteOldFiles(): Promise<void> {
    const files = await this.listSaveFiles();
    const cutoff = Date.now() - RETENTION_MS;
    const removable = files.slice(0, -1).filter((file) => file.date.getTime() < cutoff);
    for (const file of removable) {
      await unlink(path.join(this.dataDir, file.name));
    }
    if (removable.length > 0) {
      console.log(`Deleted ${removable.length} save-file(s) older than 7 days.`);
    }
  }
}
