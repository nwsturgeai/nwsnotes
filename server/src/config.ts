import { readFileSync } from "node:fs";
import path from "node:path";
import { hashPassword } from "./auth.js";

export interface Config {
  /** True on the VM; false when running locally with `npm run dev`. */
  production: boolean;
  /**
   * The admin's first password, as a hash in the format produced by hashPassword(). Only used on the first
   * start of the version with users (to make user 1, so the old single password keeps working), or with a
   * new database; after that, passwords are kept with the users.
   */
  passwordHash?: string;
  /** User 1's (the admin's) login name when user 1 is made. Default "admin". */
  adminLoginName: string;
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
  /** Adding notes by text message (Twilio). Missing: turned off. */
  sms?: SmsConfig;
}

/** The Twilio number that texts are sent to, and what's needed to check that requests come from Twilio. */
export interface SmsConfig {
  /** The Twilio account's auth token: Twilio signs each request with it. */
  authToken: string;
  /** The nwsnotes number, in E.164 (e.g. "+447700900123"). */
  number: string;
  /** The site's address as Twilio sees it (e.g. "https://nwsnotes.duckdns.org"), part of what Twilio signs. */
  publicUrl: string;
}

/** Development and the tests: a made-up number, and a known token so the tests can sign their texts. */
export const TEST_SMS = { authToken: "test-twilio-auth-token", number: "+447700900000" };

const DEFAULT_PUSH_CONTACT = "mailto:nwsnotes@localhost";

/** The admin's password in development and the tests. */
export const DEV_PASSWORD = "dev";
const DEFAULT_ADMIN_LOGIN_NAME = "admin";

/**
 * Production reads /etc/nwsnotes/config.json (or the file named by NWSNOTES_CONFIG).
 * Development uses local defaults: the admin is "admin", with the password "dev".
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
      adminLoginName: DEFAULT_ADMIN_LOGIN_NAME,
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
      // A fake Twilio: texts are posted to the server by the tests (or by hand), signed with the test token.
      sms: { ...TEST_SMS, publicUrl: `http://localhost:${process.env.PORT ?? 3000}` },
    };
  }

  const file = process.env.NWSNOTES_CONFIG ?? "/etc/nwsnotes/config.json";
  const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<Config> & {
    twilioAuthToken?: string;
    smsNumber?: string;
    publicUrl?: string;
  };
  const smsKeys = ["twilioAuthToken", "smsNumber", "publicUrl"] as const;
  const smsSet = smsKeys.filter((key) => raw[key]);
  if (smsSet.length > 0 && smsSet.length < smsKeys.length) {
    throw new Error(`${file} needs all of ${smsKeys.map((key) => `"${key}"`).join(", ")} for text messages, or none of them.`);
  }
  if (raw.smsNumber && !/^\+[1-9]\d{6,14}$/.test(raw.smsNumber)) {
    throw new Error(`${file}: "smsNumber" must be in international form, e.g. "+447700900123".`);
  }
  for (const key of ["sessionSecret", "databaseUrl"] as const) {
    if (!raw[key]) throw new Error(`${file} is missing "${key}"`);
  }
  return {
    production,
    passwordHash: raw.passwordHash,
    adminLoginName: raw.adminLoginName ?? DEFAULT_ADMIN_LOGIN_NAME,
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
    ...(raw.twilioAuthToken &&
      raw.smsNumber &&
      raw.publicUrl && { sms: { authToken: raw.twilioAuthToken, number: raw.smsNumber, publicUrl: raw.publicUrl.replace(/\/+$/, "") } }),
  };
}
