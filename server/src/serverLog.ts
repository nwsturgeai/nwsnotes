import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { format } from "node:util";
import type { ServerLogEntry, ServerLogLevel } from "@nwsnotes/shared";

/*
 * The server's recent errors and warnings, for the admin's "Server errors" page. Everything written with
 * console.error or console.warn is kept here as well as going to the console (pm2's log), so the admin can
 * see what went wrong without logging in to the VM. They're kept in a file in the data folder, not the
 * database, so a database that can't be reached (often the very thing that went wrong) is still recorded,
 * and they survive a restart, including the crash that caused it.
 */

/** The most entries kept: the oldest go first. */
export const SERVER_LOG_MAX_ENTRIES = 100;
/** Entries not seen again for this long are dropped. */
export const SERVER_LOG_DAYS = 30;
/** The same error again within this long adds to its count instead of making a new entry. */
const REPEAT_WINDOW_MS = 60 * 60 * 1000;
/** The longest message and details kept, so one huge error can't fill the file. */
const MESSAGE_MAX_LENGTH = 500;
const DETAILS_MAX_LENGTH = 8000;
/** How long after a change the file is written (several errors at once are written together). */
const WRITE_DELAY_MS = 1000;

const FILE_NAME = "server-log.json";

/** Where an error happened, when it was answering a request. */
export interface RequestContext {
  /** E.g. "PUT /api/notes/12" (the path only, never the query). */
  request: string;
  userId?: number;
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export class ServerLog {
  private entries: ServerLogEntry[] = [];
  private nextId = 1;
  private file?: string;
  private writeTimer?: NodeJS.Timeout;
  /** The console's own functions, from before install(). */
  private readonly print = { error: console.error.bind(console), warn: console.warn.bind(console) };

  /**
   * Starts recording: loads what was kept in `dataDir`, then keeps a copy of everything written with
   * console.error and console.warn, and of an uncaught error that stops the server.
   */
  install(dataDir: string): void {
    this.file = path.join(dataDir, FILE_NAME);
    this.load();
    console.error = (...args: unknown[]) => {
      this.print.error(...args);
      this.record("error", args);
    };
    console.warn = (...args: unknown[]) => {
      this.print.warn(...args);
      this.record("warning", args);
    };
    // Only watches: Node still stops the server as it would have. Written at once, as the server is about to stop.
    process.on("uncaughtExceptionMonitor", (error, origin) => {
      this.record("error", [origin === "unhandledRejection" ? "Unhandled promise rejection, so the server stopped:" : "Uncaught error, so the server stopped:", error]);
      this.flush();
    });
  }

  /** Writes to the console and keeps it here, saying which request it happened in. */
  error(context: RequestContext, ...args: unknown[]): void {
    this.print.error(...args);
    this.record("error", args, context);
  }

  /** Writes to the console only: for errors that aren't the server's fault (a refused request). */
  printOnly(...args: unknown[]): void {
    this.print.error(...args);
  }

  /** The entries kept, the most recently seen first. */
  list(): ServerLogEntry[] {
    this.dropOld();
    return [...this.entries].sort((a, b) => b.lastDateTime.localeCompare(a.lastDateTime) || b.id - a.id);
  }

  clear(): void {
    this.entries = [];
    this.scheduleWrite();
  }

  /** Keeps one console.error or console.warn: its first line as the message, all of it as the details. */
  record(level: ServerLogLevel, args: unknown[], context?: RequestContext): void {
    try {
      const text = format(...args).trim() || "(no message)";
      const newline = text.indexOf("\n");
      const message = cut(newline < 0 ? text : text.slice(0, newline), MESSAGE_MAX_LENGTH);
      const details = newline < 0 && text.length <= MESSAGE_MAX_LENGTH ? undefined : cut(text, DETAILS_MAX_LENGTH);
      const now = new Date();
      const repeat = this.entries.find(
        (entry) =>
          entry.level === level &&
          entry.message === message &&
          entry.details === details &&
          now.getTime() - new Date(entry.lastDateTime).getTime() < REPEAT_WINDOW_MS,
      );
      if (repeat) {
        repeat.count++;
        repeat.lastDateTime = now.toISOString();
        if (context) {
          repeat.request = context.request;
          repeat.userId = context.userId;
        } else {
          delete repeat.request;
          delete repeat.userId;
        }
      } else {
        this.entries.push({
          id: this.nextId++,
          level,
          message,
          ...(details !== undefined && { details }),
          ...(context && { request: context.request, ...(context.userId !== undefined && { userId: context.userId }) }),
          firstDateTime: now.toISOString(),
          lastDateTime: now.toISOString(),
          count: 1,
        });
      }
      this.dropOld();
      this.scheduleWrite();
    } catch (error) {
      // Recording must never be the thing that breaks: say so on the console only.
      this.print.error("Couldn't record that in the server log:", error);
    }
  }

  /** Drops entries older than SERVER_LOG_DAYS, and the oldest beyond SERVER_LOG_MAX_ENTRIES. */
  private dropOld(): void {
    const since = new Date(Date.now() - SERVER_LOG_DAYS * 24 * 60 * 60 * 1000).toISOString();
    this.entries = this.entries.filter((entry) => entry.lastDateTime >= since);
    if (this.entries.length > SERVER_LOG_MAX_ENTRIES) {
      this.entries.sort((a, b) => a.lastDateTime.localeCompare(b.lastDateTime) || a.id - b.id);
      this.entries = this.entries.slice(-SERVER_LOG_MAX_ENTRIES);
    }
  }

  private load(): void {
    if (!this.file) return;
    let text: string;
    try {
      text = readFileSync(this.file, "utf8");
    } catch {
      return; // None kept yet.
    }
    try {
      const saved = JSON.parse(text) as unknown;
      if (Array.isArray(saved)) {
        this.entries = saved.filter(
          (entry): entry is ServerLogEntry =>
            typeof entry === "object" && entry !== null && Number.isInteger(entry.id) && typeof entry.message === "string" && typeof entry.lastDateTime === "string",
        );
        this.nextId = Math.max(0, ...this.entries.map((entry) => entry.id)) + 1;
      }
    } catch (error) {
      this.print.warn(`The server log in ${this.file} couldn't be read, so it starts again:`, error);
    }
  }

  private scheduleWrite(): void {
    if (!this.file || this.writeTimer) return;
    this.writeTimer = setTimeout(() => this.flush(), WRITE_DELAY_MS);
    this.writeTimer.unref();
  }

  /** Writes the file (to a temporary file first, so a crash mid-write can't leave half of one). */
  flush(): void {
    clearTimeout(this.writeTimer);
    this.writeTimer = undefined;
    if (!this.file) return;
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp`;
      writeFileSync(temporary, JSON.stringify(this.entries));
      renameSync(temporary, this.file);
    } catch (error) {
      // Not with console.error, which would record this and try again.
      this.print.error("Couldn't write the server log:", error);
    }
  }
}

/** The server's one log. */
export const serverLog = new ServerLog();
