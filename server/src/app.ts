import { existsSync } from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import {
  CONNECTION_ID_HEADER,
  validateDueDate,
  validateNoteDetails,
  validateNoteTitle,
  type LoginRequest,
} from "@nwsnotes/shared";
import { RequestError } from "./errors.js";
import { DEV_ADMIN_LOGIN_NAME, DEV_PASSWORD } from "./config.js";
import { SESSION_COOKIE, SESSION_LENGTH_MS, createSessionToken, hashPassword, readCookie, requireSession, userOf } from "./auth.js";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import type { LiveUpdates } from "./live.js";
import type { PushReminders } from "./push.js";
import type { Notebooks } from "./notebooks.js";
import { accountConfirmedEmail } from "./accountEmail.js";
import { PasswordResets } from "./passwordReset.js";
import type { Mailer } from "./email.js";
import type { SmsNotes } from "./sms.js";
import { actingUser } from "./context.js";
import type { NoteStore } from "./store.js";
import type { Sharing } from "./sharing.js";
import { ADMIN_ID, noteStatsOf, type User } from "./users.js";
import { serverLog } from "./serverLog.js";

/** The logged-in user's notebook (after requireSession and withNotebook). */
function notebookOf(res: Response): NoteStore {
  return res.locals.notebook as NoteStore;
}

/** The main website + API app. */
export function createApp(
  config: Config,
  notebooks: Notebooks,
  live: LiveUpdates,
  push: PushReminders,
  db: Db,
  sharing: Sharing,
  sms?: SmsNotes,
  mailer?: Mailer,
) {
  const users = notebooks.users;

  /**
   * Loads the logged-in user's notebook (after requireSession): every data route works on it, or (for
   * notes shared with them) on their owners'. Everything the request does runs as this user, so a change
   * they make in someone else's notebook says so in its History.
   */
  const withNotebook = async (req: Request, res: Response, next: NextFunction) => {
    res.locals.notebook = await notebooks.for(userOf(res).id);
    const user = userOf(res);
    actingUser.run({ userId: user.id, displayName: user.displayName, senderId: req.get(CONNECTION_ID_HEADER) }, next);
  };
  /** Tells the user's other pages to reload, after a change. */
  const notifyChanged = (req: { get(name: string): string | undefined }, res: Response) => live.notifyChanged(userOf(res).id, req.get(CONNECTION_ID_HEADER));
  /** Tells these users' pages to reload (their view of someone else's notes changed). */
  const notifyUsers = (ids: number[]) => {
    for (const id of ids) live.notifyChanged(id, undefined);
  };
  // A change to a notebook reloads the pages of everyone it's shared with, and of its owner when someone
  // else made it. The person who made it has their own pages told by the route, as for any change.
  notebooks.onNotebookSaved = (ownerId) => {
    const acting = actingUser.getStore();
    const others = [...sharing.recipientsOf(ownerId), ownerId].filter((id) => id !== (acting?.userId ?? ownerId));
    for (const id of new Set(others)) live.notifyChanged(id, acting?.senderId);
  };

  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(redirectToSiteHost(config));
  // Large enough for a long-form note's handwritten details (at most 2 MB).
  app.use(express.json({ limit: "3mb" }));

  const cookieOptions = {
    httpOnly: true,
    secure: config.production,
    sameSite: "strict" as const,
    path: "/",
  };

  // --- Login / logout -------------------------------------------------------

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    // The end-to-end tests log in many times; the limit still applies everywhere else.
    limit: config.testMode ? 1000 : 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many login attempts. Please wait 15 minutes and try again." },
  });

  /** Gives this browser a session for the user (a fresh cookie, after logging in or changing the password). */
  const startSession = (res: Response, user: User) =>
    res.cookie(SESSION_COOKIE, createSessionToken(config.sessionSecret, user.id, user.sessionVersion), {
      ...cookieOptions,
      maxAge: SESSION_LENGTH_MS,
    });

  app.post("/api/login", loginLimiter, async (req: Request<object, object, Partial<LoginRequest>>, res) => {
    const result = users.checkLogin(req.body?.loginName, req.body?.password);
    if (result === "incorrect") {
      res.status(401).json({ error: "Incorrect email or password." });
      return;
    }
    if (result === "disabled") {
      res.status(403).json({ error: "This account is turned off." });
      return;
    }
    if (result === "waiting") {
      res.status(403).json({ error: "Your account is waiting to be confirmed. You can log in once it has been." });
      return;
    }
    await users.recordLogin(result.id);
    // This browser's other tabs were on the old cookie (maybe someone else's): they check who they're logged in as now.
    live.sessionEnded(readCookie(req, SESSION_COOKIE), req.get(CONNECTION_ID_HEADER));
    startSession(res, result);
    res.json({ ok: true });
  });

  // --- Forgotten passwords (public: an emailed link to choose a new one) ------

  const passwordResets = new PasswordResets(config, users, live, mailer);
  app.use("/api/password-reset", passwordResets.router(loginLimiter));

  // --- Asking for an account (the public sign-up page) ------------------------

  const signUpLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: config.testMode ? 1000 : 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests from here. Please wait an hour and try again." },
  });

  /** Tells the admins' open pages, so the "accounts waiting" icon comes and goes without a reload. */
  const notifyAdmins = () => {
    for (const id of users.adminIds()) live.notifyChanged(id, undefined);
  };

  app.post("/api/account-requests", signUpLimiter, async (req, res) => {
    const request = await users.requestAccount(req.body);
    console.log(`Account request ${request.id} made; waiting to be confirmed.`);
    notifyAdmins();
    res.status(201).json({ ok: true });
  });

  app.post("/api/logout", (req, res) => {
    // This browser's other tabs are logged out too, so they show the login page straight away.
    live.sessionEnded(readCookie(req, SESSION_COOKIE), req.get(CONNECTION_ID_HEADER));
    res.clearCookie(SESSION_COOKIE, cookieOptions);
    res.json({ ok: true });
  });

  // --- Adding notes by text message (only when it's set up) -----------------

  if (sms) {
    const { webhook, me } = sms.routers();
    app.use(webhook);
    app.use("/api/me/sms", me);
  }

  // --- The logged-in user ---------------------------------------------------

  const meRouter = express.Router();
  meRouter.use(requireSession(users, config.sessionSecret));

  meRouter.get("/", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(users.me(userOf(res)));
  });

  // Your number of notes and the space they take, for the top of Settings.
  meRouter.get("/stats", async (_req, res) => {
    const id = userOf(res).id;
    res.set("Cache-Control", "no-store");
    res.json(noteStatsOf(userOf(res), (await users.noteStats(id)).get(id)));
  });

  // Changing your own password: this browser gets a fresh cookie and stays logged in; the others are logged out.
  meRouter.put("/password", async (req, res) => {
    const user = await users.changeOwnPassword(userOf(res).id, req.body);
    startSession(res, user);
    live.logOut(user.id, req.get(CONNECTION_ID_HEADER));
    res.json({ ok: true });
    passwordResets.passwordChanged(req, user, "settings");
  });

  app.use("/api/me", meRouter);

  // --- The server's recent errors (admins only) ------------------------------

  const serverLogRouter = express.Router();
  serverLogRouter.use(requireSession(users, config.sessionSecret), (_req, res, next) => {
    if (!userOf(res).admin) throw new RequestError(403, "Only an admin can see the server's errors.");
    next();
  });
  serverLogRouter.get("/", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(serverLog.list());
  });
  serverLogRouter.delete("/", (_req, res) => {
    serverLog.clear();
    console.log(`Server log cleared by user ${userOf(res).id}.`);
    res.json({ ok: true });
  });
  app.use("/api/server-log", serverLogRouter);

  // --- Users (the admin only) ---------------------------------------------

  const usersRouter = express.Router();
  usersRouter.use(requireSession(users, config.sessionSecret), (_req, res, next) => {
    if (!userOf(res).admin) throw new RequestError(403, "Only the admin can manage users.");
    next();
  });

  // `changesSince`: where "today and the 6 days before" starts in the admin's time zone (their midnight 6 days
  // ago). Without it (or if it isn't a date), the last 7 days from now.
  usersRouter.get("/", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const asked = typeof req.query.changesSince === "string" ? new Date(req.query.changesSince) : undefined;
    const since = asked && !Number.isNaN(asked.getTime()) ? asked : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    res.json(await users.summaries(since));
  });

  // The whole database's size, for the users page.
  usersRouter.get("/database-size", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ bytes: await users.databaseBytes() });
  });

  // Account requests from the sign-up page, waiting to be confirmed or declined.
  usersRouter.get("/requests", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(users.accountRequests());
  });

  const requestIdOf = (req: Request<{ id: string }>): number => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new RequestError(404, "That account request isn't waiting any more.");
    return id;
  };

  // Confirming makes the user, then emails them that it's ready (if email is set up). The account is made
  // either way; `emailed` says whether they were told, so the admin can tell them otherwise.
  usersRouter.post("/requests/:id/confirm", async (req: Request<{ id: string }>, res) => {
    const user = await users.confirmRequest(requestIdOf(req));
    notifyAdmins();
    let emailed = false;
    if (mailer?.enabled) {
      // The address the admin is using, which is the site's own (https://nwsnotes.com in production).
      const loginUrl = `${req.protocol}://${req.get("host") ?? config.siteHost ?? "nwsnotes.com"}/`;
      try {
        await mailer.send(accountConfirmedEmail({ email: user.loginName, name: user.displayName }, loginUrl));
        emailed = true;
      } catch (error) {
        console.error(`Couldn't email user ${user.id} that their account is confirmed:`, error);
      }
    }
    res.status(201).json({ user: users.summary(user), emailed });
  });

  usersRouter.delete("/requests/:id", async (req: Request<{ id: string }>, res) => {
    await users.declineRequest(requestIdOf(req));
    notifyAdmins();
    res.json({ ok: true });
  });

  usersRouter.post("/", async (req, res) => {
    const { user, password } = await users.create(req.body);
    res.status(201).json({ user: users.summary(user), password });
  });

  /** The user id in the address, which must be a user. */
  const userIdOf = (req: Request<{ id: string }>): number => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !users.byId(id)) throw new RequestError(404, `There is no user with id ${req.params.id}.`);
    return id;
  };

  usersRouter.put("/:id", async (req: Request<{ id: string }>, res) => {
    const id = userIdOf(req);
    if (id === userOf(res).id && (req.body as { disabled?: unknown } | undefined)?.disabled === true) {
      throw new RequestError(400, "You can't turn off your own account.");
    }
    const { user, loggedOut } = await users.update(id, req.body);
    if (loggedOut) live.logOut(id);
    res.json(users.summary(user, (await users.noteStats(id)).get(id)));
  });

  usersRouter.post("/:id/reset-password", async (req: Request<{ id: string }>, res) => {
    const id = userIdOf(req);
    if (id === userOf(res).id) throw new RequestError(400, "Change your own password from Settings instead.");
    const password = await users.resetPassword(id);
    live.logOut(id);
    res.json({ password });
  });

  app.use("/api/users", usersRouter);

  // --- Notes ----------------------------------------------------------------

  const notesRouter = express.Router();
  notesRouter.use(requireSession(users, config.sessionSecret), withNotebook);

  notesRouter.get("/", async (_req, res) => {
    res.json(await sharing.dataFor(userOf(res).id));
  });

  // A small request the app sends while offline, to find out when the server can be reached again
  // (and whether the session is still valid) without downloading every note.
  notesRouter.get("/ping", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ ok: true });
  });

  notesRouter.post(
    "/",
    async (
      req: Request<
        object,
        object,
        { tagIds?: unknown; parentId?: unknown; clientId?: unknown; createdDateTime?: unknown; tagsChangedDateTime?: unknown } | undefined
      >,
      res,
    ) => {
      const check = validateNoteTitle(req.body);
      const details = validateNoteDetails(req.body);
      const due = validateDueDate(req.body);
      if (!check.ok || !details.ok || !due.ok) {
        res.status(400).json({ error: !check.ok ? check.error : !details.ok ? details.error : !due.ok ? due.error : "" });
        return;
      }
      const { note, created } = await sharing.addNote(userOf(res), check.title, req.body?.tagIds, details.details, req.body?.parentId, {
        dueDateTime: due.dueDateTime,
        clientId: req.body?.clientId,
        createdDateTime: req.body?.createdDateTime,
        tagsChangedDateTime: req.body?.tagsChangedDateTime,
      });
      // An add sent again (its reply was lost) changes nothing, so there's nothing to tell other pages.
      if (created) notifyChanged(req, res);
      res.status(created ? 201 : 200).json(note);
    },
  );

  // Multi-select: add and remove tags on several notes at once. (Before "/:id", which would match it.)
  // The shared note order (moving notes in edit-order mode, or adding at the top). Before "/:id".
  notesRouter.put("/order", async (req, res) => {
    const noteOrder = await sharing.setNoteOrder(userOf(res), req.body);
    notifyChanged(req, res);
    res.json({ noteOrder });
  });

  notesRouter.put("/bulk-tags", async (req, res) => {
    const notes = await sharing.bulkTags(userOf(res), req.body);
    notifyChanged(req, res);
    res.json(notes);
  });

  notesRouter.put("/:id", async (req: Request<{ id: string }, object, { tagIds?: unknown; tagsChangedDateTime?: unknown; baseModifiedDateTime?: unknown } | undefined>, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: `There is no note with id ${req.params.id}.` });
      return;
    }
    const check = validateNoteTitle(req.body);
    const details = validateNoteDetails(req.body);
    const due = validateDueDate(req.body);
    if (!check.ok || !details.ok || !due.ok) {
      res.status(400).json({ error: !check.ok ? check.error : !details.ok ? details.error : !due.ok ? due.error : "" });
      return;
    }
    const note = await sharing.updateNote(userOf(res), id, check.title, req.body?.tagIds, details.details, {
      dueDateTime: due.dueDateTime,
      tagsChangedDateTime: req.body?.tagsChangedDateTime,
      baseModifiedDateTime: req.body?.baseModifiedDateTime,
    });
    notifyChanged(req, res);
    res.json(note);
  });

  // Delete a note (used when cancelling a new long-form note).
  notesRouter.delete("/:id", async (req: Request<{ id: string }>, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: `There is no note with id ${req.params.id}.` });
      return;
    }
    await sharing.deleteNote(userOf(res), id);
    notifyChanged(req, res);
    res.json({ ok: true });
  });

  // Archive, reinstate or bin a note.
  notesRouter.put(
    "/:id/lifetime",
    async (req: Request<{ id: string }, object, { lifetime?: unknown; tagsChangedDateTime?: unknown } | undefined>, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        res.status(404).json({ error: `There is no note with id ${req.params.id}.` });
        return;
      }
      const note = await sharing.setLifetime(userOf(res), id, req.body?.lifetime, req.body?.tagsChangedDateTime);
      notifyChanged(req, res);
      res.json(note);
    },
  );

  // The Settings page's Lifetime buttons, and edit-order mode's (which send `noteIds`: only the notes
  // listed). Each returns how many notes it changed or deleted. (Shared notes are included as the
  // user's permissions allow: see Sharing.bulkLifetime.)
  for (const action of ["reset-new", "archived-to-bin", "waiting-to-archived", "empty-bin"] as const) {
    notesRouter.post(`/${action}`, async (req: Request<object, object, { noteIds?: unknown } | undefined>, res) => {
      const count = await sharing.bulkLifetime(userOf(res), action, req.body?.noteIds);
      if (count > 0) notifyChanged(req, res);
      res.json({ count });
    });
  }

  // Everything, in the save-file format, as a download (for manual backups).
  notesRouter.get("/download", (_req, res) => {
    const file = notebookOf(res).backup();
    res.set("Cache-Control", "no-store");
    res.attachment(file.name);
    res.type("application/json").send(file.content);
  });

  app.use("/api/notes", notesRouter);

  // --- Categories (and their tags) ------------------------------------------

  const categoriesRouter = express.Router();
  categoriesRouter.use(requireSession(users, config.sessionSecret), withNotebook);

  categoriesRouter.post("/", async (req, res) => {
    const category = await notebookOf(res).addCategory(req.body);
    notifyChanged(req, res);
    res.status(201).json((await sharing.withSharedOut(userOf(res).id, [category]))[0]);
  });

  // The categories' order (the settings page's up and down buttons). Before "/:id", which would match it.
  categoriesRouter.put("/order", async (req, res) => {
    const categories = await notebookOf(res).reorderCategories(req.body);
    notifyChanged(req, res);
    // Shared tags keep their sharing icons.
    res.json(await sharing.withSharedOut(userOf(res).id, categories));
  });

  categoriesRouter.put("/:id", async (req: Request<{ id: string }>, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: `There is no category with id ${req.params.id}.` });
      return;
    }
    const category = await notebookOf(res).updateCategory(id, req.body);
    notifyChanged(req, res);
    // Deleted tags are no longer shared.
    notifyUsers(await sharing.pruneDeletedTags(userOf(res).id));
    res.json((await sharing.withSharedOut(userOf(res).id, [category]))[0]);
  });

  app.use("/api/categories", categoriesRouter);

  // --- Sharing tags ---------------------------------------------------------------

  // Mounted at /api, so the session check is on each route (a router-wide one would catch every /api request).
  const sharingRouter = express.Router();
  const signedIn = [requireSession(users, config.sessionSecret), withNotebook];

  /** The tag id in the address. */
  const tagIdOf = (req: Request<{ id: string }>): number => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new RequestError(404, `There is no tag with id ${req.params.id}.`);
    return id;
  };

  // Who one of your tags is shared with.
  sharingRouter.get("/tags/:id/shares", ...signedIn, async (req: Request<{ id: string }>, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await sharing.sharesOfTag(userOf(res).id, tagIdOf(req)));
  });

  // Replaces who one of your tags is shared with. Their pages reload to show the change, and so do all
  // of yours (this one too), for the sharing icons on the tag's pills.
  sharingRouter.put("/tags/:id/shares", ...signedIn, async (req: Request<{ id: string }>, res) => {
    const { shares, changed } = await sharing.setSharesOfTag(userOf(res), tagIdOf(req), req.body);
    notifyUsers([...changed, userOf(res).id]);
    res.json(shares);
  });

  // People you're linked with by sharing (either way), for choosing who to share with.
  sharingRouter.get("/shares/people", ...signedIn, async (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await sharing.people(userOf(res).id));
  });

  // Your own order and colours for the tags shared with you.
  sharingRouter.put("/shared-tags", ...signedIn, async (req, res) => {
    const category = await sharing.setSharedTagLayout(userOf(res).id, req.body);
    notifyChanged(req, res);
    res.json(category ?? null);
  });

  app.use("/api", sharingRouter);

  // --- Tabs (saved filters) -------------------------------------------------

  const tabsRouter = express.Router();
  tabsRouter.use(requireSession(users, config.sessionSecret), withNotebook);

  tabsRouter.post("/", async (req, res) => {
    const tab = await notebookOf(res).addTab(req.body, await sharing.sharedCategories(userOf(res).id));
    notifyChanged(req, res);
    res.status(201).json(tab);
  });

  // Where the built-in "All" tab shows. Before "/:id", which would match it.
  tabsRouter.put("/all", async (req, res) => {
    const placement = await notebookOf(res).setAllTabPlacement(req.body);
    notifyChanged(req, res);
    res.json({ placement });
  });

  // The tabs' order (the settings page's up and down buttons). Before "/:id", which would match it.
  tabsRouter.put("/order", async (req, res) => {
    const tabs = await notebookOf(res).reorderTabs(req.body);
    notifyChanged(req, res);
    res.json(tabs);
  });

  tabsRouter.put("/:id", async (req: Request<{ id: string }>, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: `There is no tab with id ${req.params.id}.` });
      return;
    }
    const tab = await notebookOf(res).updateTab(id, req.body, await sharing.sharedCategories(userOf(res).id));
    notifyChanged(req, res);
    res.json(tab);
  });


  tabsRouter.delete("/:id", async (req: Request<{ id: string }>, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: `There is no tab with id ${req.params.id}.` });
      return;
    }
    await notebookOf(res).deleteTab(id);
    notifyChanged(req, res);
    res.json({ ok: true });
  });

  app.use("/api/tabs", tabsRouter);

  // --- Reminders (Web Push) ---------------------------------------------------

  const pushRouter = express.Router();
  pushRouter.use(requireSession(users, config.sessionSecret));

  // The server's public key, which the browser needs to subscribe.
  pushRouter.get("/key", (_req, res) => {
    res.json({ publicKey: push.publicKey() });
  });

  pushRouter.post("/subscribe", async (req, res) => {
    await push.subscribe(userOf(res).id, req.body);
    res.json({ ok: true });
  });

  pushRouter.post("/unsubscribe", async (req, res) => {
    await push.unsubscribe(userOf(res).id, req.body);
    res.json({ ok: true });
  });

  // The settings page's "Send test": replies with how many devices it reached.
  pushRouter.post("/test", async (_req, res) => {
    res.json({ count: await push.sendTest(userOf(res).id) });
  });

  app.use("/api/push", pushRouter);

  // --- History ----------------------------------------------------------------

  const historyRouter = express.Router();
  historyRouter.use(requireSession(users, config.sessionSecret), withNotebook);

  historyRouter.get("/", async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await notebookOf(res).history(req.query.before, req.query.limit));
  });

  historyRouter.post("/revert", async (req, res) => {
    const result = await notebookOf(res).revert(req.body);
    notifyChanged(req, res);
    // Going back past a tag's creation ends its shares.
    notifyUsers(await sharing.pruneDeletedTags(userOf(res).id));
    res.json(result);
  });

  app.use("/api/history", historyRouter);

  // --- End-to-end tests only -------------------------------------------------

  // Puts the data back to the seed the tests send. Only exists when the tests start the server
  // (NWSNOTES_TEST=1, never in production), so it can't be called on the live site.
  // The test endpoints work on the logged-in user's notebook, apart from the reset (which goes back to
  // only user 1, so it's always theirs).
  if (config.testMode && !config.production) {
    const testSession = [requireSession(users, config.sessionSecret), withNotebook];
    app.post("/api/test/reset", async (req, res) => {
      db.simulateOutage = false;
      await notebooks.resetForTests(config.adminLoginName ?? DEV_ADMIN_LOGIN_NAME, hashPassword(DEV_PASSWORD));
      await sharing.resetForTests();
      await (await notebooks.for(ADMIN_ID)).resetTo(JSON.stringify(req.body));
      await push.forgetAllDevices();
      sms?.resetForTests();
      mailer?.resetForTests();
      passwordResets.resetForTests();
      serverLog.clear();
      res.json({ ok: true });
    });
    // Writes an error or warning to the server's log, as if something had gone wrong; with `fail`, the
    // request itself fails (a 500), as a bug in a route would.
    app.post("/api/test/server-log", (req: Request<object, object, { level?: unknown; message?: unknown; fail?: unknown }>, res) => {
      const message = typeof req.body?.message === "string" ? req.body.message : "Test error";
      if (req.body?.fail === true) throw new Error(message);
      if (req.body?.level === "warning") console.warn(message);
      else console.error(message);
      res.json({ ok: true });
    });
    // The emails that would have been sent to the logged-in user's login email (Brevo isn't reached from the
    // tests), or with `?to=`, to any address (e.g. one with no account, which should have been sent none).
    app.get("/api/test/emails", (req, res, next) => {
      res.set("Cache-Control", "no-store");
      if (typeof req.query.to === "string") res.json(mailer?.emailsForTests(req.query.to) ?? []);
      else next();
    });
    app.get("/api/test/emails", requireSession(users, config.sessionSecret), (_req, res) => {
      res.json(mailer?.emailsForTests(userOf(res).loginName) ?? []);
    });
    // A forgotten-password link's token, with any expiry (`expires`, ms since 1970), to test one that has expired.
    app.post("/api/test/password-reset-token", (req: Request<object, object, { loginName?: unknown; expires?: unknown } | undefined>, res) => {
      res.json({ token: passwordResets.tokenForTests(req.body?.loginName, req.body?.expires) });
    });
    // The notifications that would have been sent to the logged-in user (push services can't be reached from the tests).
    app.get("/api/test/notifications", requireSession(users, config.sessionSecret), (_req, res) => {
      res.set("Cache-Control", "no-store");
      res.json(push.notificationsForTests(userOf(res).id));
    });
    // Loads the data again from the database, as a restart would.
    app.post("/api/test/reload", ...testSession, async (_req, res) => {
      await notebookOf(res).reloadForTests();
      res.json({ ok: true });
    });
    // Makes the database unreachable (or reachable again), to test what the app does then.
    app.post("/api/test/database", (req: Request<object, object, { reachable?: unknown }>, res) => {
      db.simulateOutage = req.body?.reachable === false;
      res.json({ ok: true });
    });
  }

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Unknown API address." });
  });

  // --- Website --------------------------------------------------------------

  const indexFile = path.join(config.publicDir, "index.html");
  if (existsSync(indexFile)) {
    app.use(express.static(config.publicDir, { index: "index.html" }));
    // A help page that doesn't exist gets a "page not found" help page, not the app.
    const docsNotFound = path.join(config.publicDir, "docs", "404.html");
    app.get(["/docs", "/docs/{*path}"], (_req, res) => res.status(404).sendFile(docsNotFound));
    // Any other page address gets the website, which decides what to show.
    app.get("/{*path}", (_req, res) => res.sendFile(indexFile));
  } else {
    app.get("/", (_req, res) => {
      res.type("text").send("API is running. In development, open the website via Vite (npm run dev).");
    });
  }

  // --- Errors ---------------------------------------------------------------

  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    const status =
      typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
        ? error.status
        : 500;
    // The server's own failures are kept for the admin's "Server errors" page; refused requests (4xx) aren't.
    if (status >= 500) {
      const user = res.locals.user as User | undefined;
      serverLog.error({ request: `${req.method} ${req.originalUrl.split("?")[0]}`, userId: user?.id }, error);
    } else {
      serverLog.printOnly(error);
    }
    const message = error instanceof Error ? error.message : String(error);
    res.status(status).json({ error: status === 500 ? `Server error: ${message}` : message });
  });

  return app;
}

/**
 * The port-80 app: answers Let's Encrypt certificate checks and sends everything else to HTTPS.
 * If there is no certificate yet, it says so instead of redirecting.
 */
export function createHttpApp(config: Config, hasCertificate: boolean) {
  const app = express();
  app.disable("x-powered-by");
  if (config.acmeDir) {
    app.use("/.well-known/acme-challenge", express.static(path.join(config.acmeDir, ".well-known/acme-challenge")));
  }
  app.use((req, res) => {
    if (!hasCertificate) {
      res.status(503).type("text").send("nwsnotes is running, but the HTTPS certificate hasn't been set up yet.");
      return;
    }
    // Straight to the site's own address where redirectToSiteHost() would send the page anyway.
    const host = shouldMoveToSiteHost(config, req) ? config.siteHost! : (req.headers.host ?? "").replace(/:\d+$/, "");
    const port = config.httpsPort === 443 ? "" : `:${config.httpsPort}`;
    res.redirect(301, `https://${host}${port}${req.originalUrl}`);
  });
  return app;
}

/** True for a page (not the API) asked for under a name other than the site's own, e.g. the old nwsnotes.duckdns.org. */
function shouldMoveToSiteHost(config: Config, req: Request) {
  if (!config.siteHost) return false;
  const host = (req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
  // Only pages: the API (Twilio's webhook, an app installed from the old address) keeps working under any name.
  return host !== config.siteHost && (req.method === "GET" || req.method === "HEAD") && !req.path.startsWith("/api/");
}

/** Sends pages asked for under another name (www., the old duckdns address) to the site's own address. */
function redirectToSiteHost(config: Config) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!shouldMoveToSiteHost(config, req)) return next();
    const port = config.httpsPort === 443 ? "" : `:${config.httpsPort}`;
    res.redirect(301, `https://${config.siteHost}${port}${req.originalUrl}`);
  };
}
