import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Note } from "@nwsnotes/shared";

/** Contents of each save-file. */
interface SaveFile {
  version: 1;
  savedDateTime: string;
  notes: Note[];
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

/**
 * Keeps all notes in memory and writes a complete, timestamped save-file
 * to disk every time a note is added.
 */
export class NoteStore {
  private notes: Note[] = [];
  private lastSaveMs = 0;
  private latestFileName: string | undefined;
  /** Saves run one at a time, in order. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly dataDir: string) {}

  /** Loads the most recent save-file (if any) and tidies up old ones. */
  async init(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const files = await this.listSaveFiles();
    const latest = files.at(-1);
    if (latest) {
      const content = JSON.parse(await readFile(path.join(this.dataDir, latest.name), "utf8")) as SaveFile;
      if (!Array.isArray(content.notes)) {
        throw new Error(`Save-file ${latest.name} has no "notes" list.`);
      }
      this.notes = content.notes;
      this.lastSaveMs = latest.date.getTime();
      this.latestFileName = latest.name;
      console.log(`Loaded ${this.notes.length} notes from ${latest.name}`);
    } else {
      console.log(`No save-files in ${this.dataDir}; starting with no notes.`);
    }
    await this.deleteOldFiles();
  }

  getAll(): Note[] {
    return this.notes;
  }

  /** The most recent save-file, or undefined if nothing has been saved yet. */
  latestSaveFile(): { name: string; path: string } | undefined {
    if (!this.latestFileName) return undefined;
    return { name: this.latestFileName, path: path.join(this.dataDir, this.latestFileName) };
  }

  /** Adds a note (title already validated) and saves. Resolves once it is on disk. */
  add(titleText: string): Promise<Note> {
    const result = this.queue.then(() => this.addNow(titleText));
    // Keep the queue going even if this save fails.
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async addNow(titleText: string): Promise<Note> {
    // Save-file names must be unique and in order, so never reuse or go back in time.
    const nowMs = Math.max(Date.now(), this.lastSaveMs + 1);
    const now = new Date(nowMs);
    const timestamp = now.toISOString();
    const nextId = this.notes.reduce((max, note) => Math.max(max, note.id), 0) + 1;
    const note: Note = {
      id: nextId,
      titleText,
      createdDateTime: timestamp,
      lastModifiedDateTime: timestamp,
    };
    const notes = [...this.notes, note];
    const content: SaveFile = { version: 1, savedDateTime: timestamp, notes };

    // Write to a temporary file, then rename, so a crash can't leave a half-written save-file.
    const fileName = fileNameFor(now);
    const finalPath = path.join(this.dataDir, fileName);
    const tempPath = `${finalPath}.tmp`;
    await writeFile(tempPath, JSON.stringify(content, null, 2), "utf8");
    await rename(tempPath, finalPath);

    // Only update memory once the save succeeded.
    this.notes = notes;
    this.lastSaveMs = nowMs;
    this.latestFileName = fileName;

    try {
      await this.deleteOldFiles();
    } catch (error) {
      // The note is saved; a failed tidy-up shouldn't be reported as a failed save.
      console.error("Couldn't delete old save-files:", error);
    }
    return note;
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
