import { readFileSync } from "node:fs";
import path from "node:path";
import { hashPassword } from "./auth.js";

export interface Config {
  /** True on the VM; false when running locally with `npm run dev`. */
  production: boolean;
  /** Password hash in the format produced by hashPassword(). */
  passwordHash: string;
  /** Random secret used to sign session cookies. */
  sessionSecret: string;
  /** Folder holding the note save-files. */
  dataDir: string;
  /** Folder holding fullchain.pem and privkey.pem (production only). */
  certDir: string;
  /** Folder certbot writes its challenge files to (production only). */
  acmeDir: string;
  /** Folder holding the built website. */
  publicDir: string;
  httpPort: number;
  httpsPort: number;
  /** The contact (a mailto: or https: address) that push services ask senders of reminders for. */
  pushContact: string;
  /**
   * True when started by the end-to-end tests (NWSNOTES_TEST=1, never in production): adds the
   * test-only reset endpoint.
   */
  testMode: boolean;
  /**
   * The Supabase (Postgres) connection string. Required in production; without it (development and
   * the tests) the server uses PGlite, a local copy of Postgres, in `dataDir`.
   */
  databaseUrl?: string;
  /** Supabase's SSL certificate, to check the database connection against (production only). */
  databaseCaFile?: string;
}

const DEFAULT_PUSH_CONTACT = "mailto:nwsnotes@localhost";

const DEV_PASSWORD = "dev";

/**
 * Production reads /etc/nwsnotes/config.json (or the file named by NWSNOTES_CONFIG).
 * Development uses local defaults, with the password "dev".
 */
export function loadConfig(): Config {
  const production = process.env.NODE_ENV === "production";
  // The bundled server (CommonJS) sits next to public/. In dev (ESM via tsx) there is
  // no __dirname, and the website is normally served by Vite, but a built client
  // in ../client/dist is served too if present.
  const publicDir =
    typeof __dirname !== "undefined" && production
      ? path.join(__dirname, "public")
      : path.resolve("../client/dist");

  if (!production) {
    return {
      production,
      passwordHash: hashPassword(DEV_PASSWORD),
      sessionSecret: "development-only-secret",
      // The end-to-end tests keep their data in their own folder, never with real or dev notes.
      dataDir: path.resolve(process.env.NWSNOTES_DATA_DIR ?? "dev-data"),
      certDir: "",
      acmeDir: "",
      publicDir,
      httpPort: Number(process.env.PORT ?? 3000),
      httpsPort: 0,
      pushContact: DEFAULT_PUSH_CONTACT,
      testMode: process.env.NWSNOTES_TEST === "1",
      // Normally unset, so development uses PGlite; set it to try a real Postgres database.
      databaseUrl: process.env.NWSNOTES_DATABASE_URL,
    };
  }

  const file = process.env.NWSNOTES_CONFIG ?? "/etc/nwsnotes/config.json";
  const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<Config>;
  for (const key of ["passwordHash", "sessionSecret", "databaseUrl"] as const) {
    if (!raw[key]) throw new Error(`${file} is missing "${key}"`);
  }
  return {
    production,
    passwordHash: raw.passwordHash!,
    sessionSecret: raw.sessionSecret!,
    dataDir: raw.dataDir ?? "/var/lib/nwsnotes/data",
    certDir: raw.certDir ?? "/etc/nwsnotes/certs",
    acmeDir: raw.acmeDir ?? "/var/lib/nwsnotes/acme",
    publicDir,
    httpPort: raw.httpPort ?? 80,
    httpsPort: raw.httpsPort ?? 443,
    pushContact: raw.pushContact ?? DEFAULT_PUSH_CONTACT,
    testMode: false,
    databaseUrl: raw.databaseUrl!,
    databaseCaFile: raw.databaseCaFile ?? "/etc/nwsnotes/supabase-ca.crt",
  };
}
