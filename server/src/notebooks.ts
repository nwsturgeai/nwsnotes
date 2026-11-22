import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Db } from "./db.js";
import { emptyNotebook, pruneHistory } from "./persist.js";
import { HISTORY_DAYS, NoteStore } from "./store.js";
import { ADMIN_ID, type Users } from "./users.js";

/** How many daily backup files are kept for each user. */
const BACKUPS_KEPT = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
/** How long to wait before trying the database again, when it couldn't be reached at start-up. */
const RETRY_START_MS = 30_000;

/**
 * Every user's notebook: one NoteStore each, made and loaded from the database the first time that user's
 * data is needed, then kept. Each has its own queue of changes, so one person's save never waits for another's.
 */
export class Notebooks {
  private readonly stores = new Map<number, Promise<NoteStore>>();

  constructor(
    private readonly db: Db,
    private readonly dataDir: string,
    readonly users: Users,
  ) {}

  /**
   * Sets up the database and loads the users.
   * If the database can't be reached, it tries again every 30 seconds, and the API answers 503 meanwhile.
   * Then starts the daily jobs.
   */
  async init(options: { dailyJobs: boolean } = { dailyJobs: true }): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    try {
      await this.start();
    } catch (error) {
      if ((error as { status?: unknown }).status !== 503) throw error;
      if (!options.dailyJobs) throw error;
      console.warn(`The database can't be reached; trying again in ${RETRY_START_MS / 1000} seconds.`);
      setTimeout(() => void this.init(options).catch((e: unknown) => console.error("Couldn't load the data:", e)), RETRY_START_MS).unref();
      return;
    }
    if (!options.dailyJobs) return;
    void this.daily();
    setInterval(() => void this.daily(), DAY_MS).unref();
  }

  private async start(): Promise<void> {
    await this.users.init();
  }

  private backupDir(userId: number): string {
    return path.join(this.dataDir, "backups", String(userId));
  }

  /** The user's notebook, loaded from the database the first time. */
  for(userId: number): Promise<NoteStore> {
    let store = this.stores.get(userId);
    if (!store) {
      const made = new NoteStore(this.db, userId);
      store = made.load().then(() => made);
      this.stores.set(userId, store);
      // If it couldn't be loaded (e.g. the database is unreachable), the next request tries again.
      store.catch(() => {
        if (this.stores.get(userId) === store) this.stores.delete(userId);
      });
    }
    return store;
  }

  /** The notebooks already loaded (for the reminder checks). */
  async loaded(): Promise<NoteStore[]> {
    const settled = await Promise.allSettled(this.stores.values());
    return settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  }

  /**
   * Once a day, for all users: one small query, so Supabase sees the database as in use (free projects are
   * paused after a week without activity); each user's backup file in `backups/<user id>/`, keeping the last
   * seven; and every user's history older than 30 days deleted. Failures are logged, and tried again the next day.
   */
  async daily(): Promise<void> {
    try {
      await this.db.query("SELECT 1");
    } catch (error) {
      console.warn("Daily database check failed:", error instanceof Error ? error.message : error);
    }
    for (const user of this.users.list()) {
      try {
        const store = await this.for(user.id);
        await store.writeDailyBackup(this.backupDir(user.id), BACKUPS_KEPT);
      } catch (error) {
        console.error(`Couldn't write user ${user.id}'s daily backup file:`, error);
      }
    }
    try {
      const pruned = await pruneHistory(this.db, HISTORY_DAYS);
      if (pruned > 0) console.log(`Deleted ${pruned} change(s) older than ${HISTORY_DAYS} days from the history.`);
    } catch (error) {
      console.warn("Couldn't tidy the history:", error instanceof Error ? error.message : error);
    }
  }

  /**
   * End-to-end tests only: removes every user but user 1, with their notebooks, and puts user 1 back as it
   * started, with the given login name and password. (User 1's notebook is then reset by the caller.)
   */
  async resetForTests(adminLoginName: string, passwordHash: string): Promise<void> {
    const removed = await this.users.resetForTests(adminLoginName, passwordHash);
    await this.db.transaction(async (query) => {
      for (const id of removed) await emptyNotebook(query, id);
      // Anything else left by a user no longer there.
      for (const table of ["changes", "notes", "categories", "tabs", "meta"]) {
        // (`meta` rows of user 0 belong to no user, and are kept.)
        await query(`DELETE FROM nwsnotes.${table} WHERE user_id <> $1${table === "meta" ? " AND user_id <> 0" : ""}`, [ADMIN_ID]);
      }
    });
    for (const id of removed) this.stores.delete(id);
  }

  /**
   * End-to-end tests only: forgets every user and notebook in memory and starts again from the database,
   * as a restart would (after the test replaced it with one from before there were users).
   */
  async restartForTests(): Promise<void> {
    this.stores.clear();
    await this.start();
  }
}
