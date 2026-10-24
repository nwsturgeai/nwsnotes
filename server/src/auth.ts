import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { NextFunction, Request, Response } from "express";

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

/*
 * Sessions: the cookie holds "<expiry ms>.<signature>", signed with the session secret.
 * There's only one user, so nothing else needs to be stored on the server.
 */
export const SESSION_COOKIE = "nwsnotes_session";
export const SESSION_LENGTH_MS = 30 * 24 * 60 * 60 * 1000;

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function createSessionToken(secret: string, now = Date.now()): string {
  const expires = String(now + SESSION_LENGTH_MS);
  return `${expires}.${sign(expires, secret)}`;
}

export function isValidSessionToken(token: string | undefined, secret: string, now = Date.now()): boolean {
  if (!token) return false;
  const [expires, signature] = token.split(".");
  if (!expires || !signature) return false;
  const expected = Buffer.from(sign(expires, secret));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
  return Number(expires) > now;
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

/** Express middleware: rejects the request with 401 unless the session cookie is valid. */
export function requireSession(secret: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isValidSessionToken(readCookie(req, SESSION_COOKIE), secret)) {
      next();
    } else {
      res.status(401).json({ error: "Not logged in." });
    }
  };
}
