import express, { type Request, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import {
  FORGOT_PASSWORD_PATH,
  PASSWORD_LINK_NOT_WORKING,
  RESET_PASSWORD_PATH,
  isValidLoginName,
  type PasswordResetConfirmRequest,
  type PasswordResetRequest,
} from "@nwsnotes/shared";
import { passwordChangedEmail, passwordResetEmail, type PasswordChangedHow } from "./accountEmail.js";
import { createPasswordResetToken, readPasswordResetToken } from "./auth.js";
import type { Config } from "./config.js";
import { databaseUnreachable } from "./db.js";
import type { Mailer } from "./email.js";
import { RequestError } from "./errors.js";
import type { LiveUpdates } from "./live.js";
import type { User, Users } from "./users.js";

/** The parts of a request the site's address comes from. */
type AddressedRequest = Pick<Request, "protocol" | "get">;

/** At most one link emailed to each account in this long. */
const EMAIL_GAP_MS = 5 * 60 * 1000;

/**
 * End-to-end tests only: requests with this header are counted by it rather than by address, under the
 * real limit, so a test can check the limit without the rest of the tests (all from one address) using it up.
 */
export const TEST_CLIENT_HEADER = "x-test-client";

/**
 * Forgotten passwords (see "Forgotten passwords" in Specs/users.md): the public routes that email a
 * link to choose a new password and take the new one, and the "password changed" email.
 */
export class PasswordResets {
  /** When each account (by user id) was last emailed a link. In memory only, so a restart forgets them. */
  private lastEmailed = new Map<number, number>();

  constructor(
    private readonly config: Config,
    private readonly users: Users,
    private readonly live: LiveUpdates,
    private readonly mailer: Mailer | undefined,
  ) {}

  /**
   * The site's own address, ending in "/". Built from the configured site host, never from the request's
   * Host (anyone can send these requests, with any Host). Development and the tests have no site host, so
   * there it's the address the request came to.
   */
  siteAddress(req: AddressedRequest): string {
    return this.config.siteHost ? `https://${this.config.siteHost}/` : `${req.protocol}://${req.get("host")}/`;
  }

  /** The routes, under /api/password-reset. `loginLimiter` is the login page's, whose count these share. */
  router(loginLimiter: RequestHandler): express.Router {
    const router = express.Router();
    const testMode = this.config.testMode;
    const askLimiter = rateLimit({
      windowMs: 60 * 60 * 1000,
      // The end-to-end tests ask many times from one address; one that sends a test client id gets the real limit.
      limit: (req) => (testMode && !req.get(TEST_CLIENT_HEADER) ? 1000 : 5),
      keyGenerator: (req) => (testMode && req.get(TEST_CLIENT_HEADER) ? `test:${req.get(TEST_CLIENT_HEADER)}` : (req.ip ?? "")),
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: { error: "Too many requests from here. Please wait an hour and try again." },
    });

    // The answer is the same whether or not there's an account, so the page can't be used to find out who has one.
    router.post("/", askLimiter, (req: Request<object, object, Partial<PasswordResetRequest> | undefined>, res) => {
      if (!this.users.isReady()) throw databaseUnreachable();
      const raw = req.body?.loginName;
      const loginName = typeof raw === "string" ? raw.trim() : "";
      if (!isValidLoginName(loginName)) throw new RequestError(400, "Please enter your email address, e.g. pat@example.com.");
      const user = this.users.byLoginName(loginName);
      res.status(204).end();
      // Sent once the answer has gone, so how long it takes doesn't show whether there's an account.
      if (user) this.emailLink(req, user);
    });

    // Whether a link works, before the page shows its boxes.
    router.post("/check", loginLimiter, (req: Request<object, object, { token?: unknown } | undefined>, res) => {
      res.set("Cache-Control", "no-store");
      res.json({ loginName: this.checked(req.body?.token).loginName });
    });

    router.post("/confirm", loginLimiter, async (req: Request<object, object, Partial<PasswordResetConfirmRequest> | undefined>, res) => {
      const user = await this.users.resetPasswordByLink(this.checked(req.body?.token), req.body?.newPassword);
      this.live.logOut(user.id);
      console.log(`User ${user.id} chose a new password with an emailed link.`);
      res.status(204).end();
      this.passwordChanged(req, user, "link");
    });

    return router;
  }

  /** The user a link is for, or 400 if it doesn't work. */
  private checked(token: unknown): User {
    if (!this.users.isReady()) throw databaseUnreachable();
    const user = readPasswordResetToken(token, this.config.sessionSecret, this.users);
    if (!user) throw new RequestError(400, PASSWORD_LINK_NOT_WORKING);
    return user;
  }

  /** Emails the link, if this account can be emailed and hasn't been in the last 5 minutes. */
  private emailLink(req: AddressedRequest, user: User): void {
    if (user.disabled || !isValidLoginName(user.loginName) || !this.mailer?.enabled) return;
    const now = Date.now();
    const last = this.lastEmailed.get(user.id);
    if (last !== undefined && now - last < EMAIL_GAP_MS) return;
    this.lastEmailed.set(user.id, now);
    const link = `${this.siteAddress(req)}${RESET_PASSWORD_PATH.slice(1)}#${createPasswordResetToken(this.config.sessionSecret, user)}`;
    this.mailer.send(passwordResetEmail({ email: user.loginName, name: user.displayName }, link)).then(
      () => console.log(`Emailed user ${user.id} a link to choose a new password.`),
      (error: unknown) => console.error(`Couldn't email user ${user.id} a link to choose a new password:`, error),
    );
  }

  /**
   * Tells someone their password has just been changed (by an emailed link, or in Settings), if they can
   * be emailed. Never waited for: the change is made whether or not it's sent.
   */
  passwordChanged(req: AddressedRequest, user: User, how: PasswordChangedHow): void {
    if (!isValidLoginName(user.loginName) || !this.mailer?.enabled) return;
    const forgotUrl = `${this.siteAddress(req)}${FORGOT_PASSWORD_PATH.slice(1)}`;
    this.mailer.send(passwordChangedEmail({ email: user.loginName, name: user.displayName }, how, forgotUrl)).catch((error: unknown) => {
      console.error(`Couldn't email user ${user.id} that their password was changed:`, error);
    });
  }

  /** End-to-end tests only: a link's token, with any expiry (e.g. one in the past). */
  tokenForTests(loginName: unknown, expires: unknown): string {
    const user = typeof loginName === "string" ? this.users.byLoginName(loginName) : undefined;
    if (!user) throw new RequestError(404, "There's no user with that login name.");
    return createPasswordResetToken(this.config.sessionSecret, user, typeof expires === "number" ? expires : undefined);
  }

  resetForTests(): void {
    this.lastEmailed.clear();
  }
}
