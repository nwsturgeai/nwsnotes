import {
  DISPLAY_NAME_MAX_LENGTH,
  LOGIN_NAME_PATTERN,
  LOGIN_NAME_RULE,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  type Me,
  type NoteStats,
  type UserSummary,
} from "@nwsnotes/shared";
import { generatePassword, hashPassword, verifyPassword } from "./auth.js";
import { databaseUnreachable, type Db, type Query } from "./db.js";
import { RequestError } from "./errors.js";
import { ensureSchema } from "./persist.js";

/** What the `users` table's `data` column holds. */
export interface UserData {
  displayName: string;
  /** In the scrypt format of hashPassword(). */
  passwordHash: string;
  /** Only user 1, and it can't be changed in the app. */
  admin: boolean;
  /** Turned off: can't log in. */
  disabled: boolean;
  /** Goes up whenever this user's existing logins must stop working. */
  sessionVersion: number;
  createdDateTime: string;
  lastLoginDateTime?: string;
}

export interface User extends UserData {
  id: number;
  loginName: string;
}

/** The admin: user 1, made on the first start of this version (from the old single password, if there was one). */
export const ADMIN_ID = 1;
const FIRST_SESSION_VERSION = 1;

/** What GET /api/me answers. */
export function meOf(user: User): Me {
  return { id: user.id, loginName: user.loginName, displayName: user.displayName, admin: user.admin };
}

function validLoginName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!LOGIN_NAME_PATTERN.test(name)) throw new RequestError(400, LOGIN_NAME_RULE);
  return name;
}

function validDisplayName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (name.length < 1 || name.length > DISPLAY_NAME_MAX_LENGTH) {
    throw new RequestError(400, `A display name must be 1 to ${DISPLAY_NAME_MAX_LENGTH} characters.`);
  }
  return name;
}

/**
 * The users, kept in memory (every request's session is checked against them) and saved to the
 * `users` table. Users aren't in the History, the save-files or the backups.
 */
export class Users {
  private users = new Map<number, User>();
  private ready = false;
  /** Changes run one at a time, so two can't both take the same id or login name. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly db: Db,
    /** Used only when there are no users yet, to make user 1. */
    private readonly firstAdmin: { loginName: string; passwordHash?: string },
  ) {}

  /**
   * Sets up the tables, moving a database from before there were users to user 1 (see ensureSchema),
   * then loads the users. Returns whether the old single-user data was moved across.
   */
  async init(): Promise<boolean> {
    const migrated = await ensureSchema(this.db, (query) => this.insertFirstAdmin(query));
    await this.load();
    this.ready = true;
    return migrated;
  }

  private async insertFirstAdmin(query: Query): Promise<void> {
    const { loginName, passwordHash } = this.firstAdmin;
    if (!passwordHash) throw new Error('There are no users yet, so the config needs "passwordHash" for the admin\'s first password.');
    const data: UserData = {
      displayName: "Admin",
      passwordHash,
      admin: true,
      disabled: false,
      sessionVersion: FIRST_SESSION_VERSION,
      createdDateTime: new Date().toISOString(),
    };
    await query("INSERT INTO nwsnotes.users (id, login_name, data) VALUES ($1, $2, $3)", [ADMIN_ID, validLoginName(loginName), JSON.stringify(data)]);
    console.log(`Made user ${ADMIN_ID}, the admin, with the login name "${loginName}".`);
  }

  private async load(): Promise<void> {
    const rows = await this.db.query<{ id: number; login_name: string; data: UserData }>(
      "SELECT id, login_name, data FROM nwsnotes.users ORDER BY id",
    );
    this.users = new Map(rows.map((row) => [Number(row.id), { ...row.data, id: Number(row.id), loginName: row.login_name }]));
  }

  isReady(): boolean {
    return this.ready;
  }

  /** Every user, in id order. */
  list(): User[] {
    return [...this.users.values()].sort((a, b) => a.id - b.id);
  }

  byId(id: number): User | undefined {
    return this.users.get(id);
  }

  /** The user with this login name, ignoring case. */
  byLoginName(name: string): User | undefined {
    const lower = name.trim().toLowerCase();
    return this.list().find((user) => user.loginName.toLowerCase() === lower);
  }

  /** Checks a login: the user, or why not. */
  checkLogin(rawName: unknown, rawPassword: unknown): User | "incorrect" | "disabled" {
    if (!this.ready) throw databaseUnreachable();
    if (typeof rawName !== "string" || typeof rawPassword !== "string") return "incorrect";
    const user = this.byLoginName(rawName);
    if (!user || !verifyPassword(rawPassword, user.passwordHash)) return "incorrect";
    return user.disabled ? "disabled" : user;
  }

  /**
   * Each user's number of notes and the space they take in the database (after its compression, which
   * is what counts towards the free plan's limit), or just one user's with `userId`.
   */
  async noteStats(userId?: number): Promise<Map<number, NoteStats>> {
    const rows = await this.db.query<{ user_id: number; count: number; bytes: number }>(
      `SELECT user_id, count(*)::int AS count, coalesce(sum(pg_column_size(data)), 0)::float8 AS bytes
       FROM nwsnotes.notes WHERE $1::int IS NULL OR user_id = $1::int GROUP BY user_id`,
      [userId ?? null],
    );
    return new Map(rows.map((row) => [Number(row.user_id), { noteCount: Number(row.count), noteBytes: Number(row.bytes) }]));
  }

  /** The users page's list, with each user's number of notes and their size. */
  async summaries(): Promise<UserSummary[]> {
    const stats = await this.noteStats();
    return this.list().map((user) => this.summary(user, stats.get(user.id)));
  }

  summary(user: User, stats: NoteStats = { noteCount: 0, noteBytes: 0 }): UserSummary {
    return {
      ...meOf(user),
      disabled: user.disabled,
      createdDateTime: user.createdDateTime,
      ...(user.lastLoginDateTime !== undefined && { lastLoginDateTime: user.lastLoginDateTime }),
      noteCount: stats.noteCount,
      noteBytes: stats.noteBytes,
    };
  }

  /** Adds a user with a generated password. Their notebook starts empty. */
  create(raw: unknown): Promise<{ user: User; password: string }> {
    return this.enqueue(async () => {
      const body = (raw ?? {}) as { loginName?: unknown; displayName?: unknown };
      const loginName = this.unusedLoginName(body.loginName);
      const displayName = validDisplayName(body.displayName);
      const password = generatePassword();
      const id = Math.max(0, ...this.users.keys()) + 1;
      const user: User = {
        id,
        loginName,
        displayName,
        passwordHash: hashPassword(password),
        admin: false,
        disabled: false,
        sessionVersion: FIRST_SESSION_VERSION,
        createdDateTime: new Date().toISOString(),
      };
      await this.db.transaction(async (query) => {
        await query("INSERT INTO nwsnotes.users (id, login_name, data) VALUES ($1, $2, $3)", [id, loginName, JSON.stringify(dataOf(user))]);
        // The notebook is set up, and empty.
        await query("INSERT INTO nwsnotes.meta (user_id, name, value) VALUES ($1, 'lastNoteId', '0'::jsonb)", [id]);
      });
      this.users.set(id, user);
      return { user, password };
    });
  }

  /**
   * The users page's Edit, Turn off and Turn on. Turning off raises the session version, so the user is
   * logged out everywhere. Returns the user, and whether their logins stopped working.
   */
  update(id: number, raw: unknown): Promise<{ user: User; loggedOut: boolean }> {
    return this.enqueue(async () => {
      const existing = this.required(id);
      const body = (raw ?? {}) as { loginName?: unknown; displayName?: unknown; disabled?: unknown };
      const next: User = { ...existing };
      if (body.loginName !== undefined) next.loginName = this.unusedLoginName(body.loginName, id);
      if (body.displayName !== undefined) next.displayName = validDisplayName(body.displayName);
      let loggedOut = false;
      if (body.disabled !== undefined) {
        if (typeof body.disabled !== "boolean") throw new RequestError(400, '"disabled" must be true or false.');
        if (body.disabled && existing.admin) throw new RequestError(400, "The admin's account can't be turned off.");
        if (body.disabled && !existing.disabled) {
          next.sessionVersion = existing.sessionVersion + 1;
          loggedOut = true;
        }
        next.disabled = body.disabled;
      }
      await this.save(next);
      return { user: next, loggedOut };
    });
  }

  /** Gives a user a new generated password and logs them out everywhere. */
  resetPassword(id: number): Promise<string> {
    return this.enqueue(async () => {
      const existing = this.required(id);
      const password = generatePassword();
      await this.save({ ...existing, passwordHash: hashPassword(password), sessionVersion: existing.sessionVersion + 1 });
      return password;
    });
  }

  /** A person changing their own password: their other logins stop working. Returns the user as it now is. */
  changeOwnPassword(id: number, raw: unknown): Promise<User> {
    return this.enqueue(async () => {
      const existing = this.required(id);
      const { currentPassword, newPassword } = (raw ?? {}) as { currentPassword?: unknown; newPassword?: unknown };
      if (typeof currentPassword !== "string" || !verifyPassword(currentPassword, existing.passwordHash)) {
        throw new RequestError(400, "The current password isn't right.");
      }
      if (typeof newPassword !== "string" || newPassword.length < PASSWORD_MIN_LENGTH) {
        throw new RequestError(400, `The new password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      }
      if (newPassword.length > PASSWORD_MAX_LENGTH) {
        throw new RequestError(400, `The new password must be at most ${PASSWORD_MAX_LENGTH} characters.`);
      }
      const next = { ...existing, passwordHash: hashPassword(newPassword), sessionVersion: existing.sessionVersion + 1 };
      await this.save(next);
      return next;
    });
  }

  /** Notes when a user last logged in (shown on the users page). */
  recordLogin(id: number): Promise<void> {
    return this.enqueue(async () => {
      const existing = this.required(id);
      await this.save({ ...existing, lastLoginDateTime: new Date().toISOString() });
    });
  }

  /**
   * End-to-end tests only: removes every user but user 1 (returning their ids, whose notebooks the caller
   * deletes) and puts user 1 back as it started, with the given password.
   */
  resetForTests(adminLoginName: string, passwordHash: string): Promise<number[]> {
    return this.enqueue(async () => {
      const others = this.list().filter((user) => user.id !== ADMIN_ID).map((user) => user.id);
      await this.db.query("DELETE FROM nwsnotes.users WHERE id <> $1", [ADMIN_ID]);
      for (const id of others) this.users.delete(id);
      const admin = this.required(ADMIN_ID);
      await this.save({
        ...admin,
        loginName: adminLoginName,
        displayName: "Admin",
        passwordHash,
        disabled: false,
        sessionVersion: FIRST_SESSION_VERSION,
      });
      return others;
    });
  }

  /** End-to-end tests only: the old single password, which the next start (with no users yet) gives user 1. */
  setFirstAdminPasswordForTests(passwordHash: string): void {
    this.firstAdmin.passwordHash = passwordHash;
  }

  private required(id: number): User {
    if (!this.ready) throw databaseUnreachable();
    const user = this.users.get(id);
    if (!user) throw new RequestError(404, `There is no user with id ${id}.`);
    return user;
  }

  private unusedLoginName(raw: unknown, ownId?: number): string {
    const name = validLoginName(raw);
    const other = this.byLoginName(name);
    if (other && other.id !== ownId) throw new RequestError(400, `The login name "${name}" is already used.`);
    return name;
  }

  private async save(user: User): Promise<void> {
    await this.db.query("UPDATE nwsnotes.users SET login_name = $2, data = $3 WHERE id = $1", [user.id, user.loginName, JSON.stringify(dataOf(user))]);
    this.users.set(user.id, user);
  }

  private enqueue<T>(change: () => Promise<T>): Promise<T> {
    if (!this.ready) return Promise.reject(databaseUnreachable());
    const result = this.queue.then(change);
    this.queue = result.catch(() => undefined);
    return result;
  }
}

function dataOf(user: User): UserData {
  const { id: _id, loginName: _loginName, ...data } = user;
  return data;
}
