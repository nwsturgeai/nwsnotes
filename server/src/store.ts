import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  validateCategory,
  validateTab,
  validateTagIds,
  type Category,
  type CategoryRequest,
  type Note,
  type NotesData,
  type NoteTitle,
  type Tab,
} from "@nwsnotes/shared";

/** Contents of each save-file. */
interface SaveFile {
  version: 2;
  savedDateTime: string;
  notes: Note[];
  categories: Category[];
  /** Missing in files saved before tabs existed. */
  tabs?: Tab[];
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
    };
  }
  if (content.version !== 2 || !Array.isArray(content.categories)) {
    throw new Error(`Save-file ${name} has an unknown format (version ${String((content as { version?: unknown }).version)}).`);
  }
  // Files saved before tabs existed have no "tabs" list.
  return { ...content, tabs: Array.isArray(content.tabs) ? content.tabs : [] };
}

/**
 * Keeps all notes, categories and tabs in memory and writes a complete, timestamped
 * save-file to disk every time anything changes.
 */
export class NoteStore {
  private notes: Note[] = [];
  private categories: Category[] = [];
  private tabs: Tab[] = [];
  private lastSaveMs = 0;
  private latestFileName: string | undefined;
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
      this.notes = content.notes;
      this.categories = content.categories;
      this.tabs = content.tabs;
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
    return { notes: this.notes, categories: this.categories, tabs: this.tabs };
  }

  /** The most recent save-file, or undefined if nothing has been saved yet. */
  latestSaveFile(): { name: string; path: string } | undefined {
    if (!this.latestFileName) return undefined;
    return { name: this.latestFileName, path: path.join(this.dataDir, this.latestFileName) };
  }

  /** Adds a note (title already validated) and saves. Resolves once it is on disk. */
  add(title: NoteTitle, rawTagIds: unknown): Promise<Note> {
    return this.enqueue(async () => {
      const tagIds = validateTagIds(rawTagIds, this.categories);
      if (!tagIds.ok) throw new RequestError(400, tagIds.error);

      const now = this.nextSaveTime();
      const timestamp = now.toISOString();
      const note: Note = {
        id: this.notes.reduce((max, n) => Math.max(max, n.id), 0) + 1,
        ...title,
        createdDateTime: timestamp,
        lastModifiedDateTime: timestamp,
        tagIds: tagIds.value,
      };
      await this.save(now, { notes: [...this.notes, note] });
      return note;
    });
  }

  /**
   * Replaces a note's title (already validated) and tags, then saves. The note keeps its id, its
   * created time (so its place in the list) and its type: typed notes stay typed, handwritten stay handwritten.
   */
  updateNote(id: number, title: NoteTitle, rawTagIds: unknown): Promise<Note> {
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
      const tagIds = validateTagIds(rawTagIds, this.categories);
      if (!tagIds.ok) throw new RequestError(400, tagIds.error);

      const now = this.nextSaveTime();
      const note: Note = {
        id,
        ...title,
        createdDateTime: existing.createdDateTime,
        lastModifiedDateTime: now.toISOString(),
        tagIds: tagIds.value,
      };
      await this.save(now, { notes: this.notes.map((n) => (n.id === id ? note : n)) });
      return note;
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
      await this.save(this.nextSaveTime(), { categories });
      return category;
    });
  }

  /** Checks and adds a new tab, then saves. */
  addTab(raw: unknown): Promise<Tab> {
    return this.enqueue(async () => {
      const check = validateTab(raw, this.tabs, this.categories);
      if (!check.ok) throw new RequestError(400, check.error);

      const tab: Tab = { id: this.tabs.reduce((max, t) => Math.max(max, t.id), 0) + 1, ...check.tab };
      await this.save(this.nextSaveTime(), { tabs: [...this.tabs, tab] });
      return tab;
    });
  }

  /** Checks and replaces a tab's name and filters, then saves. */
  updateTab(id: number, raw: unknown): Promise<Tab> {
    return this.enqueue(async () => {
      const existing = this.tabs.find((t) => t.id === id);
      if (!existing) throw new RequestError(404, `There is no tab with id ${id}.`);
      const check = validateTab(raw, this.tabs, this.categories, existing);
      if (!check.ok) throw new RequestError(400, check.error);

      const tab: Tab = { id, ...check.tab };
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

  /** Saves the current data with `change` applied (only the lists given are replaced). */
  private async save(now: Date, change: Partial<NotesData>): Promise<void> {
    const notes = change.notes ?? this.notes;
    const categories = change.categories ?? this.categories;
    const tabs = change.tabs ?? this.tabs;
    const content: SaveFile = { version: 2, savedDateTime: now.toISOString(), notes, categories, tabs };

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
    this.lastSaveMs = now.getTime();
    this.latestFileName = fileName;

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
