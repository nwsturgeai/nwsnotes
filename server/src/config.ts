import { readFileSync } from "node:fs";
import path from "node:path";
import { hashPassword } from "./auth.js";
import type { EmailConfig } from "./email.js";
import { ALEXA_TEST_CERT_PATH, ALEXA_TEST_ROOT } from "./fakeAlexa.js";

export interface Config {
  /** True on the VM; false when running locally with `npm run dev`. */
  production: boolean;
  /**
   * The admin's first password, as a hash in the format produced by hashPassword(). Only used to make
   * user 1 on the first start with a new database; after that, passwords are kept with the users.
   */
  passwordHash?: string;
  /**
   * User 1's (the admin's) login name, an email address, used only when user 1 is made (on the first
   * start with a new database) and by the tests' reset. Development and the tests: "admin@example.com".
   */
  adminLoginName?: string;
  /** Random secret used to sign session cookies. */
  sessionSecret: string;
  /** Folder holding the backups, push keys and devices (and PGlite's database, locally). */
  dataDir: string;
  /** Folder holding fullchain.pem and privkey.pem (production only). */
  certDir: string;
  /** Folder certbot writes its challenge files to (production only). */
  acmeDir: string;
  /** Folder holding the built website. */
  publicDir: string;
  httpPort: number;
  httpsPort: number;
  /**
   * The site's own address (production only, default "nwsnotes.com"). Pages asked for under any other
   * name that points at the VM (www.nwsnotes.com, the old nwsnotes.duckdns.org) are redirected to it.
   * Unset (development and the tests): no redirect.
   */
  siteHost?: string;
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
  /** Adding notes by Alexa (development and the tests: a fake Alexa, signed with test certificates). Missing: turned off. */
  alexa?: AlexaConfig;
  /** Sending email through Brevo (production only; development and the tests keep emails in memory). Missing: turned off. */
  email?: EmailConfig;
  /** Syncing notes with Google Calendar (development and the tests: a fake Google, in this server). Missing: turned off. */
  google?: GoogleConfig;
}

/** The Google Cloud project's OAuth client, and where Google's services are (the fake one's, outside production). */
export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  /** The site's address as Google sees it (e.g. "https://nwsnotes.com"): for the sign-in's return address and the webhook. */
  publicUrl: string;
  /** Google's sign-in page. */
  authUrl: string;
  /** Exchanges a sign-in's code for tokens, and refreshes them. */
  tokenUrl: string;
  /** Revokes a token (disconnecting). */
  revokeUrl: string;
  /** The Calendar API, e.g. "https://www.googleapis.com/calendar/v3". */
  calendarApi: string;
}

/** Google's real addresses, in production. */
const GOOGLE_URLS = {
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  revokeUrl: "https://oauth2.googleapis.com/revoke",
  calendarApi: "https://www.googleapis.com/calendar/v3",
};

/** Development and the tests: the fake Google served by this server (see fakeGoogle.ts). */
export function fakeGoogleConfig(port: number | string): GoogleConfig {
  const base = `http://localhost:${port}/api/test/google`;
  return {
    clientId: "fake-client-id",
    clientSecret: "fake-client-secret",
    publicUrl: `http://localhost:${port}`,
    authUrl: `${base}/oauth/auth`,
    tokenUrl: `${base}/oauth/token`,
    revokeUrl: `${base}/oauth/revoke`,
    calendarApi: `${base}/calendar/v3`,
  };
}

/** The Twilio number that texts are sent to, and what's needed to check that requests come from Twilio. */
export interface SmsConfig {
  /** The Twilio account's auth token: Twilio signs each request with it. */
  authToken: string;
  /** The nwsnotes number, in E.164 (e.g. "+447700900123"). */
  number: string;
  /** The site's address as Twilio sees it (e.g. "https://nwsnotes.com"), part of what Twilio signs. */
  publicUrl: string;
}

/** The Alexa skill that sends requests here (see Specs/alexa.md). */
export interface AlexaConfig {
  /** The skill's ID in Alexa's developer console (e.g. "amzn1.ask.skill.…"): requests from any other skill are refused. */
  skillId: string;
  /** The site's address (e.g. "https://nwsnotes.com"), for links in tab emails. */
  publicUrl: string;
  /**
   * Development and the tests only: certificates are also accepted from this address (this server's own
   * test certificates, see fakeAlexa.ts), and trusted when signed by this root instead of the usual ones.
   */
  test?: { certUrlPrefix: string; rootPem: string };
}

/** Development and the tests: a made-up skill ID, which the tests' requests use. */
export const TEST_ALEXA_SKILL_ID = "amzn1.ask.skill.00000000-0000-0000-0000-000000000000";

/** Development and the tests: a made-up number, and a known token so the tests can sign their texts. */
export const TEST_SMS = { authToken: "test-twilio-auth-token", number: "+447700900000" };

const DEFAULT_SITE_HOST = "nwsnotes.com";
const DEFAULT_PUSH_CONTACT = "mailto:nwsnotes@localhost";
/** The sender of nwsnotes' emails, on the domain authenticated in Brevo. */
const DEFAULT_EMAIL_FROM = "noreply@nwsnotes.com";
const DEFAULT_EMAIL_FROM_NAME = "nwsnotes";

/** The admin's password in development and the tests. */
export const DEV_PASSWORD = "dev";
/** The admin's login name in development and the tests. */
export const DEV_ADMIN_LOGIN_NAME = "admin@example.com";

/**
 * Production reads /etc/nwsnotes/config.json (or the file named by NWSNOTES_CONFIG).
 * Development uses local defaults: the admin is "admin@example.com", with the password "dev".
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
      adminLoginName: DEV_ADMIN_LOGIN_NAME,
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
      // A fake Google Calendar, in this server: connecting and syncing work without a Google account.
      google: fakeGoogleConfig(process.env.PORT ?? 3000),
      // A fake Alexa: requests are posted by the tests, signed with test certificates this server serves.
      alexa: {
        skillId: TEST_ALEXA_SKILL_ID,
        publicUrl: `http://localhost:${process.env.PORT ?? 3000}`,
        test: { certUrlPrefix: `http://localhost:${process.env.PORT ?? 3000}${ALEXA_TEST_CERT_PATH}/`, rootPem: ALEXA_TEST_ROOT },
      },
    };
  }

  const file = process.env.NWSNOTES_CONFIG ?? "/etc/nwsnotes/config.json";
  const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<Config> & {
    twilioAuthToken?: string;
    smsNumber?: string;
    publicUrl?: string;
    brevoApiKey?: string;
    emailFrom?: string;
    emailFromName?: string;
    googleClientId?: string;
    googleClientSecret?: string;
    alexaSkillId?: string;
  };
  const smsKeys = ["twilioAuthToken", "smsNumber", "publicUrl"] as const;
  const smsSet = smsKeys.filter((key) => raw[key]);
  if (smsSet.length > 0 && smsSet.length < smsKeys.length) {
    throw new Error(`${file} needs all of ${smsKeys.map((key) => `"${key}"`).join(", ")} for text messages, or none of them.`);
  }
  if ((raw.googleClientId || raw.googleClientSecret) && !(raw.googleClientId && raw.googleClientSecret && raw.publicUrl)) {
    throw new Error(`${file} needs all of "googleClientId", "googleClientSecret" and "publicUrl" for Google Calendar, or neither Google one.`);
  }
  if (raw.emailFrom && !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(raw.emailFrom)) {
    throw new Error(`${file}: "emailFrom" must be an email address, e.g. "noreply@nwsnotes.com".`);
  }
  if (raw.smsNumber && !/^\+[1-9]\d{6,14}$/.test(raw.smsNumber)) {
    throw new Error(`${file}: "smsNumber" must be in international form, e.g. "+447700900123".`);
  }
  if (raw.alexaSkillId && !/^amzn1\.ask\.skill\.[0-9a-f-]+$/.test(raw.alexaSkillId)) {
    throw new Error(`${file}: "alexaSkillId" must be the skill's ID from Alexa's developer console, e.g. "amzn1.ask.skill.1a2b3c4d-…".`);
  }
  for (const key of ["sessionSecret", "databaseUrl"] as const) {
    if (!raw[key]) throw new Error(`${file} is missing "${key}"`);
  }
  return {
    production,
    passwordHash: raw.passwordHash,
    adminLoginName: raw.adminLoginName,
    sessionSecret: raw.sessionSecret!,
    dataDir: raw.dataDir ?? "/var/lib/nwsnotes/data",
    certDir: raw.certDir ?? "/etc/nwsnotes/certs",
    acmeDir: raw.acmeDir ?? "/var/lib/nwsnotes/acme",
    publicDir,
    httpPort: raw.httpPort ?? 80,
    httpsPort: raw.httpsPort ?? 443,
    siteHost: raw.siteHost ?? DEFAULT_SITE_HOST,
    pushContact: raw.pushContact ?? DEFAULT_PUSH_CONTACT,
    testMode: false,
    databaseUrl: raw.databaseUrl!,
    databaseCaFile: raw.databaseCaFile ?? "/etc/nwsnotes/supabase-ca.crt",
    ...(raw.twilioAuthToken &&
      raw.smsNumber &&
      raw.publicUrl && { sms: { authToken: raw.twilioAuthToken, number: raw.smsNumber, publicUrl: raw.publicUrl.replace(/\/+$/, "") } }),
    ...(raw.googleClientId &&
      raw.googleClientSecret &&
      raw.publicUrl && {
        google: { clientId: raw.googleClientId, clientSecret: raw.googleClientSecret, publicUrl: raw.publicUrl.replace(/\/+$/, ""), ...GOOGLE_URLS },
      }),
    ...(raw.alexaSkillId && {
      alexa: { skillId: raw.alexaSkillId, publicUrl: (raw.publicUrl ?? `https://${raw.siteHost ?? DEFAULT_SITE_HOST}`).replace(/\/+$/, "") },
    }),
    ...(raw.brevoApiKey && {
      email: { brevoApiKey: raw.brevoApiKey, from: raw.emailFrom ?? DEFAULT_EMAIL_FROM, fromName: raw.emailFromName ?? DEFAULT_EMAIL_FROM_NAME },
    }),
  };
}
