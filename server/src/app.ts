import { existsSync } from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { CONNECTION_ID_HEADER, validateNoteDetails, validateNoteTitle, type LoginRequest } from "@nwsnotes/shared";
import {
  SESSION_COOKIE,
  SESSION_LENGTH_MS,
  createSessionToken,
  requireSession,
  verifyPassword,
} from "./auth.js";
import type { Config } from "./config.js";
import type { LiveUpdates } from "./live.js";
import type { NoteStore } from "./store.js";

/** The main website + API app. */
export function createApp(config: Config, store: NoteStore, live: LiveUpdates) {
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
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many login attempts. Please wait 15 minutes and try again." },
  });

  app.post("/api/login", loginLimiter, (req: Request<object, object, Partial<LoginRequest>>, res) => {
    const password = req.body?.password;
    if (typeof password !== "string" || !verifyPassword(password, config.passwordHash)) {
      res.status(401).json({ error: "Incorrect password." });
      return;
    }
    res.cookie(SESSION_COOKIE, createSessionToken(config.sessionSecret), {
      ...cookieOptions,
      maxAge: SESSION_LENGTH_MS,
    });
    res.json({ ok: true });
  });

  app.post("/api/logout", (_req, res) => {
    res.clearCookie(SESSION_COOKIE, cookieOptions);
    res.json({ ok: true });
  });

  // --- Notes ----------------------------------------------------------------

  const notesRouter = express.Router();
  notesRouter.use(requireSession(config.sessionSecret));

  notesRouter.get("/", (_req, res) => {
    res.json(store.getAll());
  });

  notesRouter.post("/", async (req: Request<object, object, { tagIds?: unknown; parentId?: unknown } | undefined>, res) => {
    const check = validateNoteTitle(req.body);
    const details = validateNoteDetails(req.body);
    if (!check.ok || !details.ok) {
      res.status(400).json({ error: !check.ok ? check.error : !details.ok ? details.error : "" });
      return;
    }
    const note = await store.add(check.title, req.body?.tagIds, details.details, req.body?.parentId);
    live.notifyChanged(req.get(CONNECTION_ID_HEADER));
    res.status(201).json(note);
  });

  notesRouter.put("/:id", async (req: Request<{ id: string }, object, { tagIds?: unknown } | undefined>, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: `There is no note with id ${req.params.id}.` });
      return;
    }
    const check = validateNoteTitle(req.body);
    const details = validateNoteDetails(req.body);
    if (!check.ok || !details.ok) {
      res.status(400).json({ error: !check.ok ? check.error : !details.ok ? details.error : "" });
      return;
    }
    const note = await store.updateNote(id, check.title, req.body?.tagIds, details.details);
    live.notifyChanged(req.get(CONNECTION_ID_HEADER));
    res.json(note);
  });

  // Delete a note (used when cancelling a new long-form note).
  notesRouter.delete("/:id", async (req: Request<{ id: string }>, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: `There is no note with id ${req.params.id}.` });
      return;
    }
    await store.deleteNote(id);
    live.notifyChanged(req.get(CONNECTION_ID_HEADER));
    res.json({ ok: true });
  });

  // Archive, reinstate or bin a note.
  notesRouter.put("/:id/lifetime", async (req: Request<{ id: string }, object, { lifetime?: unknown } | undefined>, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: `There is no note with id ${req.params.id}.` });
      return;
    }
    const note = await store.setLifetime(id, req.body?.lifetime);
    live.notifyChanged(req.get(CONNECTION_ID_HEADER));
    res.json(note);
  });

  // The Settings page's Lifetime buttons. Each returns how many notes it changed or deleted.
  const bulkLifetime = { "reset-new": () => store.resetNew(), "archived-to-bin": () => store.archivedToBin(), "empty-bin": () => store.emptyBin() };
  for (const [action, run] of Object.entries(bulkLifetime)) {
    notesRouter.post(`/${action}`, async (req, res) => {
      const count = await run();
      if (count > 0) live.notifyChanged(req.get(CONNECTION_ID_HEADER));
      res.json({ count });
    });
  }

  // The latest save-file exactly as it is on disk, as a download (for manual backups).
  notesRouter.get("/download", (_req, res, next) => {
    const file = store.latestSaveFile();
    if (!file) {
      res.status(404).json({ error: "No notes have been saved yet, so there's nothing to download." });
      return;
    }
    res.set("Cache-Control", "no-store");
    res.download(file.path, file.name, (error) => {
      if (error && !res.headersSent) next(error);
    });
  });

  app.use("/api/notes", notesRouter);

  // --- Categories (and their tags) ------------------------------------------

  const categoriesRouter = express.Router();
  categoriesRouter.use(requireSession(config.sessionSecret));

  categoriesRouter.post("/", async (req, res) => {
    const category = await store.addCategory(req.body);
    live.notifyChanged(req.get(CONNECTION_ID_HEADER));
    res.status(201).json(category);
  });

  categoriesRouter.put("/:id", async (req: Request<{ id: string }>, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: `There is no category with id ${req.params.id}.` });
      return;
    }
    const category = await store.updateCategory(id, req.body);
    live.notifyChanged(req.get(CONNECTION_ID_HEADER));
    res.json(category);
  });

  app.use("/api/categories", categoriesRouter);

  // --- Tabs (saved filters) -------------------------------------------------

  const tabsRouter = express.Router();
  tabsRouter.use(requireSession(config.sessionSecret));

  tabsRouter.post("/", async (req, res) => {
    const tab = await store.addTab(req.body);
    live.notifyChanged(req.get(CONNECTION_ID_HEADER));
    res.status(201).json(tab);
  });

  tabsRouter.put("/:id", async (req: Request<{ id: string }>, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: `There is no tab with id ${req.params.id}.` });
      return;
    }
    const tab = await store.updateTab(id, req.body);
    live.notifyChanged(req.get(CONNECTION_ID_HEADER));
    res.json(tab);
  });

  tabsRouter.delete("/:id", async (req: Request<{ id: string }>, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: `There is no tab with id ${req.params.id}.` });
      return;
    }
    await store.deleteTab(id);
    live.notifyChanged(req.get(CONNECTION_ID_HEADER));
    res.json({ ok: true });
  });

  app.use("/api/tabs", tabsRouter);

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Unknown API address." });
  });

  // --- Website --------------------------------------------------------------

  const indexFile = path.join(config.publicDir, "index.html");
  if (existsSync(indexFile)) {
    app.use(express.static(config.publicDir, { index: "index.html" }));
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
