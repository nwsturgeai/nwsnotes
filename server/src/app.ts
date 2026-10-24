import { existsSync } from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { validateTitle, type LoginRequest, type NewNoteRequest } from "@nwsnotes/shared";
import {
  SESSION_COOKIE,
  SESSION_LENGTH_MS,
  createSessionToken,
  requireSession,
  verifyPassword,
} from "./auth.js";
import type { Config } from "./config.js";
import type { NoteStore } from "./store.js";

/** The main website + API app. */
export function createApp(config: Config, store: NoteStore) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(express.json({ limit: "20kb" }));

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

  notesRouter.post("/", async (req: Request<object, object, Partial<NewNoteRequest>>, res) => {
    const check = validateTitle(req.body?.titleText);
    if (!check.ok) {
      res.status(400).json({ error: check.error });
      return;
    }
    const note = await store.add(check.title);
    res.status(201).json(note);
  });

  app.use("/api/notes", notesRouter);

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
