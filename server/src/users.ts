import {
  ACCOUNT_REQUESTS_MAX,
  DISPLAY_NAME_MAX_LENGTH,
  LOGIN_NAME_RULE,
  isValidLoginName,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  NOTE_LIMIT_DEFAULT,
  NOTE_LIMIT_MAX,
  stylusNoteLimitOf,
  type AccountRequest,
  type Me,
  type NoteStats,
  type UserSummary,
} from "@nwsnotes/shared";
import { generatePassword, hashPassword, verifyPassword } from "./auth.js";
import { databaseUnreachable, type Db, type Query } from "./db.js";
import { RequestError } from "./errors.js";
import { ensureSchema, HISTORY_MAX_CHANGES, markSetUp } from "./persist.js";

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
  /** The most notes they can have (NOTE_LIMIT_DEFAULT when missing). */
  noteLimit?: number;
  /** The phone linked for adding notes by text message, in E.164 (e.g. "+447700900123"). Unique among users. */
  smsPhoneNumber?: string;
  /** When it was linked. */
  smsLinkedDateTime?: string;
  /** Set by the admin: each text of theirs that works gets a text back confirming it (missing means off). */
  smsConfirmations?: boolean;
}

/** A user's maximum number of notes. */
export function noteLimitOf(user: UserData): number {
  return user.noteLimit ?? NOTE_LIMIT_DEFAULT;
}

/** A user's note counts and size, without their limits. */
export type NoteCounts = Omit<NoteStats, "noteLimit" | "stylusNoteLimit">;
const NO_NOTES: NoteCounts = { noteCount: 0, noteBytes: 0, stylusNoteCount: 0, historyBytes: 0 };

/** A user's note counts and size with their limits, as GET /api/me/stats returns them. */
export function noteStatsOf(user: UserData, counts: NoteCounts = NO_NOTES): NoteStats {
  return { ...counts, noteLimit: noteLimitOf(user), stylusNoteLimit: stylusNoteLimitOf(noteLimitOf(user)) };
}

export interface User extends UserData {
  id: number;
  loginName: string;
}

/** The admin: user 1, made on the first start with a new database. */
export const ADMIN_ID = 1;
const FIRST_SESSION_VERSION = 1;

/** What GET /api/me answers. */
export function meOf(user: User): Me {
  return { id: user.id, loginName: user.loginName, displayName: user.displayName, admin: user.admin };
}

function validLoginName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!isValidLoginName(name)) throw new RequestError(400, LOGIN_NAME_RULE);
  return name;
}

/** A password someone chooses: at least PASSWORD_MIN_LENGTH characters, at most PASSWORD_MAX_LENGTH. */
function validNewPassword(raw: unknown, what: string): string {
  if (typeof raw !== "string" || raw.length < PASSWORD_MIN_LENGTH) throw new RequestError(400, `${what} must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  if (raw.length > PASSWORD_MAX_LENGTH) throw new RequestError(400, `${what} must be at most ${PASSWORD_MAX_LENGTH} characters.`);
  return raw;
}

/** An account request as kept: what the users page shows, and the password they chose (only its hash). */
interface StoredRequest extends AccountRequest {
  passwordHash: string;
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
  /** Account requests waiting for an admin, by id. */
  private requests = new Map<number, StoredRequest>();
  private ready = false;
  /** Changes run one at a time, so two can't both take the same id or login name. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly db: Db,
    /** Used only when there are no users yet, to make user 1. */
    private readonly firstAdmin: { loginName?: string; passwordHash?: string },
    /** The end-to-end tests' server: an id used by two users (left by an earlier run) is only reported. */
    private readonly testMode = false,
  ) {}

  /** Sets up the tables (making the admin if there are no users yet), then loads the users. */
  async init(): Promise<void> {
    await ensureSchema(this.db, (query) => this.insertFirstAdmin(query), this.testMode);
    await this.load();
    this.ready = true;
  }

  private async insertFirstAdmin(query: Query): Promise<void> {
    const { loginName, passwordHash } = this.firstAdmin;
    if (!passwordHash) throw new Error('There are no users yet, so the config needs "passwordHash" for the admin\'s first password.');
    if (!loginName || !isValidLoginName(loginName)) {
      throw new Error('There are no users yet, so the config needs "adminLoginName": the admin\'s email address, to log in with.');
    }
    const data: UserData = {
      displayName: "Admin",
      passwordHash,
      admin: true,
      disabled: false,
      sessionVersion: FIRST_SESSION_VERSION,
      createdDateTime: new Date().toISOString(),
    };
    await query("INSERT INTO nwsnotes.users (id, login_name, data) VALUES ($1, $2, $3)", [ADMIN_ID, loginName.trim(), JSON.stringify(data)]);
    console.log(`Made user ${ADMIN_ID}, the admin, with the login name "${loginName}".`);
  }

  private async load(): Promise<void> {
    const rows = await this.db.query<{ id: number; login_name: string; data: UserData }>(
      "SELECT id, login_name, data FROM nwsnotes.users ORDER BY id",
    );
    this.users = new Map(rows.map((row) => [Number(row.id), { ...row.data, id: Number(row.id), loginName: row.login_name }]));
    const requests = await this.db.query<{ id: number; login_name: string; data: Omit<StoredRequest, "id" | "loginName"> }>(
      "SELECT id, login_name, data FROM nwsnotes.account_requests ORDER BY id",
    );
    this.requests = new Map(requests.map((row) => [Number(row.id), { ...row.data, id: Number(row.id), loginName: row.login_name }]));
  }

  /** What GET /api/me answers: admins are also told how many account requests are waiting. */
  me(user: User): Me {
    return { ...meOf(user), ...(user.admin && { accountsWaiting: this.requests.size }) };
  }

  /** Account requests waiting for an admin, oldest first. */
  accountRequests(): AccountRequest[] {
    return [...this.requests.values()]
      .sort((a, b) => a.id - b.id)
      .map(({ passwordHash: _hash, ...request }) => request);
  }

  /** The admins' ids, who are told about account requests. */
  adminIds(): number[] {
    return this.list().filter((user) => user.admin).map((user) => user.id);
  }

  /**
   * Someone asking for an account on the public sign-up page, with the password they chose. It waits,
   * and can't log in, until an admin confirms it.
   */
  requestAccount(raw: unknown): Promise<AccountRequest> {
    return this.enqueue(async () => {
      const body = (raw ?? {}) as { loginName?: unknown; displayName?: unknown; password?: unknown };
      const loginName = validLoginName(body.loginName);
      const displayName = validDisplayName(body.displayName);
      const password = validNewPassword(body.password, "The password");
      if (this.byLoginName(loginName) || this.requestByLoginName(loginName)) {
        throw new RequestError(400, "There's already an account, or a request for one, with that email. Try logging in instead.");
      }
      if (this.requests.size >= ACCOUNT_REQUESTS_MAX) {
        throw new RequestError(503, "Too many accounts are waiting to be confirmed just now. Please try again in a few days.");
      }
      const id = Math.max(0, ...this.requests.keys()) + 1;
      const request: StoredRequest = { id, loginName, displayName, requestedDateTime: new Date().toISOString(), passwordHash: hashPassword(password) };
      const { id: _id, loginName: _name, ...data } = request;
      await this.db.query("INSERT INTO nwsnotes.account_requests (id, login_name, data) VALUES ($1, $2, $3)", [id, loginName, JSON.stringify(data)]);
      this.requests.set(id, request);
      const { passwordHash: _hash, ...shown } = request;
      return shown;
    });
  }

  /** An admin confirming a request: it becomes a user, with the password they chose and an empty notebook. */
  confirmRequest(id: number): Promise<User> {
    return this.enqueue(async () => {
      const request = this.requiredRequest(id);
      // Made since? (An admin may have added them by hand.)
      if (this.byLoginName(request.loginName)) throw new RequestError(400, `There's already a user with the login name "${request.loginName}".`);
      const userId = Math.max(0, ...this.users.keys()) + 1;
      const user: User = {
        id: userId,
        loginName: request.loginName,
        displayName: request.displayName,
        passwordHash: request.passwordHash,
        admin: false,
        disabled: false,
        sessionVersion: FIRST_SESSION_VERSION,
        createdDateTime: new Date().toISOString(),
      };
      await this.db.transaction(async (query) => {
        await query("INSERT INTO nwsnotes.users (id, login_name, data) VALUES ($1, $2, $3)", [userId, user.loginName, JSON.stringify(dataOf(user))]);
        await markSetUp(query, userId);
        await query("DELETE FROM nwsnotes.account_requests WHERE id = $1", [id]);
      });
      this.requests.delete(id);
      this.users.set(userId, user);
      return user;
    });
  }

  /** An admin declining a request: it's removed, and nothing is kept. */
  declineRequest(id: number): Promise<void> {
    return this.enqueue(async () => {
      this.requiredRequest(id);
      await this.db.query("DELETE FROM nwsnotes.account_requests WHERE id = $1", [id]);
      this.requests.delete(id);
    });
  }

  private requestByLoginName(name: string): StoredRequest | undefined {
    const lower = name.trim().toLowerCase();
    return [...this.requests.values()].find((request) => request.loginName.toLowerCase() === lower);
  }

  private requiredRequest(id: number): StoredRequest {
    if (!this.ready) throw databaseUnreachable();
    const request = this.requests.get(id);
    if (!request) throw new RequestError(404, "That account request isn't waiting any more.");
    return request;
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

  /** The user whose linked phone this is (E.164). */
  byPhoneNumber(phoneNumber: string): User | undefined {
    return this.list().find((user) => user.smsPhoneNumber === phoneNumber);
  }

  /** Links a phone (E.164) to a user, taking it from anyone else it was linked to, and replacing the user's earlier one. */
  linkPhone(id: number, phoneNumber: string): Promise<User> {
    return this.enqueue(async () => {
      const user = this.required(id);
      const previous = this.byPhoneNumber(phoneNumber);
      if (previous && previous.id !== id) await this.save(withoutPhone(previous));
      const next = { ...user, smsPhoneNumber: phoneNumber, smsLinkedDateTime: new Date().toISOString() };
      await this.save(next);
      return next;
    });
  }

  /** Unlinks the user's phone, if they have one. */
  unlinkPhone(id: number): Promise<void> {
    return this.enqueue(async () => {
      const user = this.required(id);
      if (user.smsPhoneNumber !== undefined) await this.save(withoutPhone(user));
    });
  }

  /** Checks a login: the user, or why not. */
  checkLogin(rawName: unknown, rawPassword: unknown): User | "incorrect" | "disabled" | "waiting" {
    if (!this.ready) throw databaseUnreachable();
    if (typeof rawName !== "string" || typeof rawPassword !== "string") return "incorrect";
    const user = this.byLoginName(rawName);
    if (!user) {
      // Asked for on the sign-up page, and not confirmed yet: said only to someone who knows its password.
      const request = this.requestByLoginName(rawName);
      return request && verifyPassword(rawPassword, request.passwordHash) ? "waiting" : "incorrect";
    }
    if (!verifyPassword(rawPassword, user.passwordHash)) return "incorrect";
    return user.disabled ? "disabled" : user;
  }

  /**
   * Each user's number of notes and the space they and their History's earlier copies take in the
   * database (after its compression, which is what counts towards the free plan's limit), or just one
   * user's with `userId`.
   */
  /** The whole database's size in bytes: every table, index and the database's own overhead. */
  async databaseBytes(): Promise<number> {
    const [row] = await this.db.query<{ bytes: number }>("SELECT pg_database_size(current_database())::float8 AS bytes");
    return Number(row!.bytes);
  }

  async noteStats(userId?: number): Promise<Map<number, NoteCounts>> {
    const user = [userId ?? null];
    const [notes, history] = await Promise.all([
      // Stylus notes as isStylusNote() has them: a handwritten title or handwritten details.
      this.db.query<{ user_id: number; count: number; bytes: number; stylus: number }>(
        `SELECT user_id, count(*)::int AS count, coalesce(sum(pg_column_size(data)), 0)::float8 AS bytes,
                count(*) FILTER (WHERE data ? 'titleImage' OR data ? 'detailsImage')::int AS stylus
         FROM nwsnotes.notes WHERE $1::int IS NULL OR user_id = $1::int GROUP BY user_id`,
        user,
      ),
      // The History's "before" copies (empty for a change that created an item).
      this.db.query<{ user_id: number; bytes: number }>(
        `SELECT c.user_id, coalesce(sum(pg_column_size(i."before")), 0)::float8 AS bytes
         FROM nwsnotes.changes c JOIN nwsnotes.change_items i ON i.change_id = c.id
         WHERE $1::int IS NULL OR c.user_id = $1::int GROUP BY c.user_id`,
        user,
      ),
    ]);
    const stats = new Map<number, NoteCounts>();
    for (const row of notes) {
      stats.set(Number(row.user_id), { ...NO_NOTES, noteCount: Number(row.count), noteBytes: Number(row.bytes), stylusNoteCount: Number(row.stylus) });
    }
    // A user may have History but no notes left (after emptying the Bin, say).
    for (const row of history) {
      const id = Number(row.user_id);
      stats.set(id, { ...(stats.get(id) ?? NO_NOTES), historyBytes: Number(row.bytes) });
    }
    return stats;
  }

  /**
   * Each user's number of changes since `since`, from their History. Its oldest changes are dropped once it
   * has HISTORY_MAX_CHANGES, so when it's full and the oldest kept is since then, some may be gone: `more`.
   */
  async recentChanges(since: Date): Promise<Map<number, { count: number; more: boolean }>> {
    const rows = await this.db.query<{ user_id: number; recent: number; total: number; oldest: Date | string }>(
      `SELECT user_id, count(*) FILTER (WHERE time >= $1)::int AS recent, count(*)::int AS total, min(time) AS oldest
       FROM nwsnotes.changes GROUP BY user_id`,
      [since.toISOString()],
    );
    return new Map(
      rows.map((row) => [
        Number(row.user_id),
        { count: Number(row.recent), more: Number(row.total) >= HISTORY_MAX_CHANGES && new Date(row.oldest) >= since },
      ]),
    );
  }

  /** The users page's list, with each user's number of notes and their size, and their changes since `changesSince`. */
  async summaries(changesSince: Date): Promise<UserSummary[]> {
    const [stats, changes] = await Promise.all([this.noteStats(), this.recentChanges(changesSince)]);
    return this.list().map((user) => ({
      ...this.summary(user, stats.get(user.id)),
      recentChanges: changes.get(user.id) ?? { count: 0, more: false },
    }));
  }

  summary(user: User, counts: NoteCounts = NO_NOTES): UserSummary {
    return {
      ...meOf(user),
      disabled: user.disabled,
      createdDateTime: user.createdDateTime,
      ...(user.lastLoginDateTime !== undefined && { lastLoginDateTime: user.lastLoginDateTime }),
      ...noteStatsOf(user, counts),
      smsLinked: user.smsPhoneNumber !== undefined,
      smsConfirmations: user.smsConfirmations === true,
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
        await markSetUp(query, id);
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
      const body = (raw ?? {}) as { loginName?: unknown; displayName?: unknown; disabled?: unknown; noteLimit?: unknown; smsConfirmations?: unknown };
      const next: User = { ...existing };
      // A name made before login names had to be email addresses can be kept as it is, so the rest can still be edited.
      const unchanged = typeof body.loginName === "string" && body.loginName.trim() === existing.loginName;
      if (body.loginName !== undefined && !unchanged) next.loginName = this.unusedLoginName(body.loginName, id);
      if (body.displayName !== undefined) next.displayName = validDisplayName(body.displayName);
      if (body.noteLimit !== undefined) {
        const limit = body.noteLimit;
        if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > NOTE_LIMIT_MAX) {
          throw new RequestError(400, `The note limit must be a whole number from 1 to ${NOTE_LIMIT_MAX.toLocaleString("en-GB")}.`);
        }
        next.noteLimit = limit;
      }
      if (body.smsConfirmations !== undefined) {
        if (typeof body.smsConfirmations !== "boolean") throw new RequestError(400, '"smsConfirmations" must be true or false.');
        if (body.smsConfirmations) next.smsConfirmations = true;
        else delete next.smsConfirmations;
      }
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
      const next = { ...existing, passwordHash: hashPassword(validNewPassword(newPassword, "The new password")), sessionVersion: existing.sessionVersion + 1 };
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
      await this.db.query("DELETE FROM nwsnotes.account_requests");
      this.requests.clear();
      for (const id of others) this.users.delete(id);
      const admin = this.required(ADMIN_ID);
      const { noteLimit: _limit, smsConfirmations: _confirmations, ...asStarted } = withoutPhone(admin);
      await this.save({
        ...asStarted,
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
    if (this.requestByLoginName(name)) {
      throw new RequestError(400, `"${name}" has asked for an account, which is waiting to be confirmed: confirm or decline it above instead.`);
    }
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

function withoutPhone(user: User): User {
  const { smsPhoneNumber: _phone, smsLinkedDateTime: _linked, ...rest } = user;
  return rest;
}

function dataOf(user: User): UserData {
  const { id: _id, loginName: _loginName, ...data } = user;
  return data;
}
