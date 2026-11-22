import { existsSync } from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import {
  CONNECTION_ID_HEADER,
  stylusNoteLimitOf,
  validateDueDate,
  validateNoteDetails,
  validateNoteTitle,
  type LoginRequest,
} from "@nwsnotes/shared";
import { RequestError } from "./errors.js";
import { DEV_PASSWORD } from "./config.js";
import { SESSION_COOKIE, SESSION_LENGTH_MS, createSessionToken, hashPassword, requireSession, userOf } from "./auth.js";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import type { LiveUpdates } from "./live.js";
import type { PushReminders } from "./push.js";
import type { Notebooks } from "./notebooks.js";
import type { NoteStore } from "./store.js";
import { ADMIN_ID, meOf, noteLimitOf, noteStatsOf, type User } from "./users.js";

/** The logged-in user's notebook (after requireSession and withNotebook). */
function notebookOf(res: Response): NoteStore {
  return res.locals.notebook as NoteStore;
}

/** The main website + API app. */
export function createApp(config: Config, notebooks: Notebooks, live: LiveUpdates, push: PushReminders, db: Db) {
  const users = notebooks.users;

  /** Loads the logged-in user's notebook (after requireSession): every data route works on it. */
  const withNotebook = async (_req: Request, res: Response, next: NextFunction) => {
    res.locals.notebook = await notebooks.for(userOf(res).id);
    next();
  };
  /** Tells the user's other pages to reload, after a change. */
  const notifyChanged = (req: { get(name: string): string | undefined }, res: Response) => live.notifyChanged(userOf(res).id, req.get(CONNECTION_ID_HEADER));

  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
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
      res.status(401).json({ error: "Incorrect name or password." });
      return;
    }
    if (result === "disabled") {
      res.status(403).json({ error: "This account is turned off." });
      return;
    }
    await users.recordLogin(result.id);
    startSession(res, result);
    res.json({ ok: true });
  });

  app.post("/api/logout", (_req, res) => {
    res.clearCookie(SESSION_COOKIE, cookieOptions);
    res.json({ ok: true });
  });

  // --- The logged-in user ---------------------------------------------------

  const meRouter = express.Router();
  meRouter.use(requireSession(users, config.sessionSecret));

  meRouter.get("/", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(meOf(userOf(res)));
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
  });

  app.use("/api/me", meRouter);

  // --- Users (the admin only) ---------------------------------------------

  const usersRouter = express.Router();
  usersRouter.use(requireSession(users, config.sessionSecret), (_req, res, next) => {
    if (!userOf(res).admin) throw new RequestError(403, "Only the admin can manage users.");
    next();
  });

  usersRouter.get("/", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await users.summaries());
  });

  // The whole database's size, for the users page.
  usersRouter.get("/database-size", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ bytes: await users.databaseBytes() });
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

  notesRouter.get("/", (_req, res) => {
    res.json(notebookOf(res).getAll());
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
      const { note, created } = await notebookOf(res).add(check.title, req.body?.tagIds, details.details, req.body?.parentId, {
        dueDateTime: due.dueDateTime,
        clientId: req.body?.clientId,
        createdDateTime: req.body?.createdDateTime,
        tagsChangedDateTime: req.body?.tagsChangedDateTime,
        noteLimit: noteLimitOf(userOf(res)),
        stylusNoteLimit: stylusNoteLimitOf(noteLimitOf(userOf(res))),
      });
      // An add sent again (its reply was lost) changes nothing, so there's nothing to tell other pages.
      if (created) notifyChanged(req, res);
      res.status(created ? 201 : 200).json(note);
    },
  );

  // Multi-select: add and remove tags on several notes at once. (Before "/:id", which would match it.)
  // The shared note order (moving notes in edit-order mode, or adding at the top). Before "/:id".
  notesRouter.put("/order", async (req, res) => {
    const noteOrder = await notebookOf(res).setNoteOrder(req.body);
    notifyChanged(req, res);
    res.json({ noteOrder });
  });

  notesRouter.put("/bulk-tags", async (req, res) => {
    const notes = await notebookOf(res).bulkTags(req.body);
    notifyChanged(req, res);
    res.json(notes);
  });

  notesRouter.put("/:id", async (req: Request<{ id: string }, object, { tagIds?: unknown; tagsChangedDateTime?: unknown } | undefined>, res) => {
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
    const note = await notebookOf(res).updateNote(id, check.title, req.body?.tagIds, details.details, {
      dueDateTime: due.dueDateTime,
      tagsChangedDateTime: req.body?.tagsChangedDateTime,
      stylusNoteLimit: stylusNoteLimitOf(noteLimitOf(userOf(res))),
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
    await notebookOf(res).deleteNote(id);
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
      const note = await notebookOf(res).setLifetime(id, req.body?.lifetime, req.body?.tagsChangedDateTime);
      notifyChanged(req, res);
      res.json(note);
    },
  );

  // The Settings page's Lifetime buttons. Each returns how many notes it changed or deleted.
  const bulkLifetime = {
    "reset-new": (store: NoteStore) => store.resetNew(),
    "archived-to-bin": (store: NoteStore) => store.archivedToBin(),
    "empty-bin": (store: NoteStore) => store.emptyBin(),
  };
  for (const [action, run] of Object.entries(bulkLifetime)) {
    notesRouter.post(`/${action}`, async (req, res) => {
      const count = await run(notebookOf(res));
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
    res.status(201).json(category);
  });

  // The categories' order (the settings page's up and down buttons). Before "/:id", which would match it.
  categoriesRouter.put("/order", async (req, res) => {
    const categories = await notebookOf(res).reorderCategories(req.body);
    notifyChanged(req, res);
    res.json(categories);
  });

  categoriesRouter.put("/:id", async (req: Request<{ id: string }>, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: `There is no category with id ${req.params.id}.` });
      return;
    }
    const category = await notebookOf(res).updateCategory(id, req.body);
    notifyChanged(req, res);
    res.json(category);
  });

  app.use("/api/categories", categoriesRouter);

  // --- Tabs (saved filters) -------------------------------------------------

  const tabsRouter = express.Router();
  tabsRouter.use(requireSession(users, config.sessionSecret), withNotebook);

  tabsRouter.post("/", async (req, res) => {
    const tab = await notebookOf(res).addTab(req.body);
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
    const tab = await notebookOf(res).updateTab(id, req.body);
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
      await notebooks.resetForTests(config.adminLoginName, hashPassword(DEV_PASSWORD));
      await (await notebooks.for(ADMIN_ID)).resetTo(JSON.stringify(req.body));
      await push.forgetAllDevices();
      res.json({ ok: true });
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

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(error);
    const status =
      typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
        ? error.status
        : 500;
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
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    const port = config.httpsPort === 443 ? "" : `:${config.httpsPort}`;
    res.redirect(301, `https://${host}${port}${req.originalUrl}`);
  });
  return app;
}
