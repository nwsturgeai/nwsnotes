import express, { type Request, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { CONFIRM_EMAIL_PATH, EMAIL_LINK_NOT_WORKING, isValidLoginName, type EmailChangeLink } from "@nwsnotes/shared";
import { emailChangedEmail, emailChangeLinkEmail } from "./accountEmail.js";
import { createEmailChangeToken, readEmailChangeToken } from "./auth.js";
import type { Config } from "./config.js";
import { databaseUnreachable } from "./db.js";
import type { Mailer } from "./email.js";
import { RequestError } from "./errors.js";
import type { LiveUpdates } from "./live.js";
import type { User, Users } from "./users.js";

/** The parts of a request the site's address comes from. */
type AddressedRequest = Pick<Request, "protocol" | "get">;

/**
 * Changing your own login email (see "Changing your name or email" in Specs/users.md): asking from Settings
 * emails a link to the new address, and the public routes the link's page uses make the change, after which
 * the old address is told.
 */
export class EmailChanges {
  constructor(
    private readonly config: Config,
    private readonly users: Users,
    private readonly live: LiveUpdates,
    private readonly mailer: Mailer | undefined,
    /** The site's own address, ending in "/" (as for password-reset links). */
    private readonly siteAddress: (req: AddressedRequest) => string,
  ) {}

  /**
   * 5 asks an hour for each account (each checks the current password, so this also limits guessing it),
   * and far more in test mode, where many tests ask.
   */
  askLimiter(): RequestHandler {
    return rateLimit({
      windowMs: 60 * 60 * 1000,
      limit: this.config.testMode ? 1000 : 5,
      keyGenerator: (_req, res) => `user:${(res.locals.user as User).id}`,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: { error: "Too many requests to change your email. Please wait an hour and try again." },
    });
  }

  /**
   * POST /api/me/email (logged in): checks the current password and the new email, and emails it the link.
   * Waits for the email, so the page can say if it couldn't be sent.
   */
  async ask(req: AddressedRequest & { body?: unknown }, user: User): Promise<string> {
    if (!this.mailer?.enabled) throw new RequestError(503, "Email isn't set up, so your email can't be changed here. Ask the admin to change it.");
    const newLoginName = this.users.checkOwnEmailChange(user.id, req.body);
    const link = `${this.siteAddress(req)}${CONFIRM_EMAIL_PATH.slice(1)}#${createEmailChangeToken(this.config.sessionSecret, user, newLoginName)}`;
    try {
      await this.mailer.send(emailChangeLinkEmail({ email: newLoginName, name: user.displayName }, user.loginName, link));
    } catch (error) {
      console.error(`Couldn't email user ${user.id}'s new email a link to confirm it:`, error);
      throw new RequestError(502, "The email couldn't be sent just now. Please try again later.");
    }
    console.log(`Emailed user ${user.id}'s new email a link to confirm it.`);
    return newLoginName;
  }

  /** The public routes the link's page uses, under /api/email-change. `loginLimiter` is the login page's, whose count these share. */
  router(loginLimiter: RequestHandler): express.Router {
    const router = express.Router();

    // Whether a link works, and what it changes, before the page offers to confirm it.
    router.post("/check", loginLimiter, (req: Request<object, object, { token?: unknown } | undefined>, res) => {
      res.set("Cache-Control", "no-store");
      const { user, newLoginName } = this.checked(req.body?.token);
      const answer: EmailChangeLink = { loginName: user.loginName, newLoginName };
      res.json(answer);
    });

    router.post("/confirm", loginLimiter, async (req: Request<object, object, { token?: unknown } | undefined>, res) => {
      const { user, newLoginName } = this.checked(req.body?.token);
      const { before, after } = await this.users.changeLoginNameByLink(user, newLoginName);
      // Their open pages show the new email without a reload.
      this.live.notifyChanged(after.id, undefined);
      console.log(`User ${after.id} changed their login email with an emailed link.`);
      res.json({ loginName: after.loginName });
      this.tellOldAddress(before, after.loginName);
    });

    return router;
  }

  /** The user a link is for and its new email, or 400 if it doesn't work. */
  private checked(token: unknown): { user: User; newLoginName: string } {
    if (!this.users.isReady()) throw databaseUnreachable();
    const checked = readEmailChangeToken(token, this.config.sessionSecret, this.users);
    if (!checked) throw new RequestError(400, EMAIL_LINK_NOT_WORKING);
    return checked;
  }

  /** Tells the old address the email has changed, if it can be emailed. Never waited for: the change is made either way. */
  private tellOldAddress(before: User, newLoginName: string): void {
    if (!isValidLoginName(before.loginName) || !this.mailer?.enabled) return;
    this.mailer.send(emailChangedEmail({ email: before.loginName, name: before.displayName }, newLoginName)).catch((error: unknown) => {
      console.error(`Couldn't email user ${before.id}'s old email that it was changed:`, error);
    });
  }
}
