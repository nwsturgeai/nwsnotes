import { createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { NextFunction, Request, Response } from "express";
import { databaseUnreachable } from "./db.js";
import type { User, Users } from "./users.js";

/*
 * Password hashes use scrypt and are stored as:  scrypt$<N>$<salt base64>$<hash base64>
 * deploy/setup-vm.sh produces the same format when it generates the password.
 */
const SCRYPT_N = 16384;
const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_N });
  return `scrypt$${SCRYPT_N}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !n || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
  });
  return timingSafeEqual(actual, expected);
}

/**
 * Generated passwords (a new account, or a reset): 16 characters from lowercase letters and digits,
 * leaving out ones easily confused (0, o, 1, l, i), in four groups of four with dashes, which are part of
 * the password. E.g. "kq7m-x4tp-9wfd-hr3c".
 */
const PASSWORD_CHARACTERS = "abcdefghjkmnpqrstuvwxyz23456789";

export function generatePassword(): string {
  const groups = Array.from({ length: 4 }, () =>
    Array.from({ length: 4 }, () => PASSWORD_CHARACTERS[randomInt(PASSWORD_CHARACTERS.length)]).join(""),
  );
  return groups.join("-");
}

/*
 * Sessions: the cookie holds "<user id>.<session version>.<expiry ms>.<signature>", signed with the
 * session secret. A session only counts while its version is the user's current one, so raising a
 * user's version logs them out everywhere.
 */
export const SESSION_COOKIE = "nwsnotes_session";
export const SESSION_LENGTH_MS = 30 * 24 * 60 * 60 * 1000;

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function createSessionToken(secret: string, userId: number, sessionVersion: number, now = Date.now()): string {
  const value = `${userId}.${sessionVersion}.${now + SESSION_LENGTH_MS}`;
  return `${value}.${sign(value, secret)}`;
}

/**
 * Who a session cookie says is logged in, if its signature is right and it hasn't expired. (Whether that
 * user can still use it, by their session version, is checked by the caller.) Cookies from before there
 * were users have no user id, so they're refused.
 */
export function readSessionToken(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): { userId: number; sessionVersion: number } | undefined {
  if (!token) return undefined;
  const parts = token.split(".");
  if (parts.length !== 4) return undefined;
  const [userId, version, expires, signature] = parts as [string, string, string, string];
  const expected = Buffer.from(sign(`${userId}.${version}.${expires}`, secret));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;
  if (!(Number(expires) > now)) return undefined;
  const id = Number(userId);
  const sessionVersion = Number(version);
  if (!Number.isInteger(id) || !Number.isInteger(sessionVersion)) return undefined;
  return { userId: id, sessionVersion };
}

/** Reads one cookie from the request's Cookie header (an API request or a WebSocket connection). */
export function readCookie(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return undefined;
}

/** The user a request's (or WebSocket connection's) session cookie belongs to, if it's still valid. */
export function sessionUser(req: IncomingMessage, users: Users, secret: string): User | undefined {
  const session = readSessionToken(readCookie(req, SESSION_COOKIE), secret);
  if (!session) return undefined;
  const user = users.byId(session.userId);
  if (!user || user.disabled || user.sessionVersion !== session.sessionVersion) return undefined;
  return user;
}

/**
 * Express middleware: rejects the request with 401 unless the session cookie is valid (503 while the
 * users can't be loaded from the database). The user is then in `res.locals.user`.
 */
export function requireSession(users: Users, secret: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!users.isReady()) throw databaseUnreachable();
    const user = sessionUser(req, users, secret);
    if (user) {
      res.locals.user = user;
      next();
    } else {
      res.status(401).json({ error: "Not logged in." });
    }
  };
}

/** The logged-in user (after requireSession). */
export function userOf(res: Response): User {
  return res.locals.user as User;
}

/*
 * Emailed links to choose a new password (a forgotten one): "<user id>.<expiry ms>.<signature>", signed
 * with the session secret over "password-reset.<user id>.<expiry ms>.<the user's current password hash>".
 * Nothing is stored: changing the password in any way changes the hash, so a link works only once, and
 * older links stop working. The "password-reset." start keeps a session's signature from ever passing as a
 * link's, or a link's as a session's.
 */
export const PASSWORD_RESET_LENGTH_MS = 60 * 60 * 1000;

function signPasswordReset(userId: number | string, expires: number | string, passwordHash: string, secret: string): string {
  return sign(`password-reset.${userId}.${expires}.${passwordHash}`, secret);
}

export function createPasswordResetToken(
  secret: string,
  user: Pick<User, "id" | "passwordHash">,
  expires = Date.now() + PASSWORD_RESET_LENGTH_MS,
): string {
  return `${user.id}.${expires}.${signPasswordReset(user.id, expires, user.passwordHash, secret)}`;
}

/**
 * The user an emailed link is for, if it's signed right, hasn't expired, their password hasn't changed
 * since, and their account is still there and turned on.
 */
export function readPasswordResetToken(token: unknown, secret: string, users: Users, now = Date.now()): User | undefined {
  if (typeof token !== "string") return undefined;
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  const [userId, expires, signature] = parts as [string, string, string];
  if (!/^\d+$/.test(userId) || !/^\d+$/.test(expires) || !(Number(expires) > now)) return undefined;
  const user = users.byId(Number(userId));
  if (!user || user.disabled) return undefined;
  const expected = Buffer.from(signPasswordReset(userId, expires, user.passwordHash, secret));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;
  return user;
}
