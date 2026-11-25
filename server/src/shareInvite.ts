import express, { type Request, type RequestHandler } from "express";
import { isValidLoginName, SHARE_INVITE_NOT_WORKING, SHARE_INVITE_PATH, type ShareInviteLink } from "@nwsnotes/shared";
import { shareDeclinedEmail, shareInviteEmail, shareLeftEmail } from "./accountEmail.js";
import { createShareInviteToken, readShareInviteToken } from "./auth.js";
import type { Config } from "./config.js";
import { databaseUnreachable } from "./db.js";
import type { Mailer } from "./email.js";
import { RequestError } from "./errors.js";
import type { LiveUpdates } from "./live.js";
import type { Sharing } from "./sharing.js";
import type { User, Users } from "./users.js";

/** The parts of a request the site's address comes from. */
type AddressedRequest = Pick<Request, "protocol" | "get">;

/**
 * Asking someone new before sharing with them (see "Sharing a tag" in Specs/sharing.md). When an owner
 * shares a tag with someone they aren't linked with by sharing (either way), the share waits and that
 * person is emailed a link. Its page (public, like the email-change one) accepts the sharing, which puts it
 * into use, or turns it down, which removes it and emails the owner. Also emails an owner when someone
 * stops viewing a tag they shared.
 */
export class ShareInvites {
  constructor(
    private readonly config: Config,
    private readonly users: Users,
    private readonly sharing: Sharing,
    private readonly live: LiveUpdates,
    private readonly mailer: Mailer | undefined,
    /** The site's own address, ending in "/" (as for password-reset links). */
    private readonly siteAddress: (req: AddressedRequest) => string,
  ) {}

  /** Whether new people are asked first. Without email (not set up in production) nobody could answer, so shares start straight away. */
  get asksNewPeople(): boolean {
    return this.mailer?.enabled === true;
  }

  /** Emails each person a link to accept or turn down the owner's sharing. Never waited for: the shares are saved either way. */
  async ask(req: AddressedRequest, owner: User, recipients: User[]): Promise<void> {
    for (const recipient of recipients) {
      if (!this.mailer?.enabled || !isValidLoginName(recipient.loginName)) continue;
      const tagNames = await this.sharing.waitingTagNames(owner.id, recipient.id);
      const link = `${this.siteAddress(req)}${SHARE_INVITE_PATH.slice(1)}#${createShareInviteToken(this.config.sessionSecret, owner.id, recipient)}`;
      const email = shareInviteEmail({ email: recipient.loginName, name: recipient.displayName }, { name: owner.displayName, email: owner.loginName }, tagNames, link);
      this.mailer.send(email).then(
        () => console.log(`Emailed user ${recipient.id} to ask if they accept user ${owner.id}'s sharing.`),
        (error: unknown) => console.error(`Couldn't email user ${recipient.id} to ask if they accept user ${owner.id}'s sharing:`, error),
      );
    }
  }

  /** Tells an owner that someone has stopped viewing one of their shared tags. Never waited for. */
  tellOwnerLeft(owner: User, recipient: User, tagName: string): void {
    if (!isValidLoginName(owner.loginName) || !this.mailer?.enabled) return;
    const email = shareLeftEmail({ email: owner.loginName, name: owner.displayName }, { name: recipient.displayName, email: recipient.loginName }, tagName);
    this.mailer.send(email).catch((error: unknown) => {
      console.error(`Couldn't email user ${owner.id} that user ${recipient.id} stopped viewing a shared tag:`, error);
    });
  }

  /** The public routes the link's page uses, under /api/share-invite. `loginLimiter` is the login page's, whose count these share. */
  router(loginLimiter: RequestHandler): express.Router {
    const router = express.Router();

    // What a link is for, before the page offers to accept or turn it down.
    router.post("/check", loginLimiter, async (req: Request<object, object, { token?: unknown } | undefined>, res) => {
      res.set("Cache-Control", "no-store");
      const { owner, tagNames } = await this.checked(req.body?.token);
      const answer: ShareInviteLink = { ownerName: owner.displayName, ownerLoginName: owner.loginName, tagNames };
      res.json(answer);
    });

    router.post("/accept", loginLimiter, async (req: Request<object, object, { token?: unknown } | undefined>, res) => {
      const { owner, recipient } = await this.checked(req.body?.token);
      await this.sharing.answerInvite(owner.id, recipient.id, true);
      // The recipient's pages show the notes; the owner's lose the hourglass.
      this.live.notifyChanged(recipient.id, undefined);
      this.live.notifyChanged(owner.id, undefined);
      console.log(`User ${recipient.id} accepted user ${owner.id}'s sharing.`);
      res.json({ ok: true });
    });

    router.post("/decline", loginLimiter, async (req: Request<object, object, { token?: unknown } | undefined>, res) => {
      const { owner, recipient, tagNames } = await this.checked(req.body?.token);
      await this.sharing.answerInvite(owner.id, recipient.id, false);
      this.live.notifyChanged(owner.id, undefined);
      console.log(`User ${recipient.id} turned down user ${owner.id}'s sharing.`);
      res.json({ ok: true });
      this.tellOwnerDeclined(owner, recipient, tagNames);
    });

    return router;
  }

  /** Who a link is for and the tags waiting, or 400 if it doesn't work (badly signed, or nothing is waiting any more). */
  private async checked(token: unknown): Promise<{ owner: User; recipient: User; tagNames: string[] }> {
    if (!this.users.isReady()) throw databaseUnreachable();
    const checked = readShareInviteToken(token, this.config.sessionSecret, this.users);
    const tagNames = checked ? await this.sharing.waitingTagNames(checked.owner.id, checked.recipient.id) : [];
    if (!checked || tagNames.length === 0) throw new RequestError(400, SHARE_INVITE_NOT_WORKING);
    return { ...checked, tagNames };
  }

  private tellOwnerDeclined(owner: User, recipient: User, tagNames: string[]): void {
    if (!isValidLoginName(owner.loginName) || !this.mailer?.enabled) return;
    const email = shareDeclinedEmail({ email: owner.loginName, name: owner.displayName }, { name: recipient.displayName, email: recipient.loginName }, tagNames);
    this.mailer.send(email).catch((error: unknown) => {
      console.error(`Couldn't email user ${owner.id} that user ${recipient.id} turned down their sharing:`, error);
    });
  }
}
