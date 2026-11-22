import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { createApp, createHttpApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db.js";
import { LiveUpdates } from "./live.js";
import { PushReminders } from "./push.js";
import { Notebooks } from "./notebooks.js";
import { Mailer } from "./email.js";
import { SmsNotes } from "./sms.js";
import { Users } from "./users.js";

/** The value after a command-line option, e.g. `--user admin`. */
function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function main() {
  const config = loadConfig();
  const db = await openDatabase(config);
  const users = new Users(db, { loginName: config.adminLoginName, passwordHash: config.passwordHash });
  const notebooks = new Notebooks(db, config.dataDir, users);

  // `node server.cjs --restore <file> --user <login email>`: replaces that user's notebook with a backup
  // file's, then stops.
  if (process.argv.includes("--restore")) {
    const file = option("--restore");
    const loginName = option("--user");
    if (!file || file.startsWith("--")) throw new Error("Give the backup file to restore: --restore <file> --user <login email>");
    if (!loginName || loginName.startsWith("--")) {
      throw new Error("Give whose notebook to restore it into: --restore <file> --user <login email>. Nothing was restored.");
    }
    await notebooks.init({ dailyJobs: false });
    const user = users.byLoginName(loginName);
    if (!user) throw new Error(`There is no user "${loginName}", so nothing was restored.`);
    const store = await notebooks.for(user.id);
    const count = await store.restore(path.basename(file), readFileSync(file, "utf8"));
    console.log(`Restored ${count} notes from ${file} into ${user.loginName}'s notebook. Restart the app (pm2 restart nwsnotes) so it loads them.`);
    process.exit(0);
  }

  // `node server.cjs --reset-password <login email>`: prints a new generated password for that user and
  // logs them out everywhere, then stops.
  if (process.argv.includes("--reset-password")) {
    const loginName = option("--reset-password");
    if (!loginName || loginName.startsWith("--")) throw new Error("Give whose password to reset: --reset-password <login email>");
    await notebooks.init({ dailyJobs: false });
    const user = users.byLoginName(loginName);
    if (!user) throw new Error(`There is no user "${loginName}".`);
    const password = await users.resetPassword(user.id);
    console.log(`New password for ${user.loginName} (shown only once): ${password}`);
    console.log("They're logged out everywhere. Restart the app (pm2 restart nwsnotes) so it uses the new password.");
    process.exit(0);
  }

  await notebooks.init();
  const push = new PushReminders(config.dataDir, config.pushContact, notebooks, config.testMode);
  await push.init();
  const live = new LiveUpdates(users, config.sessionSecret);
  const mailer = new Mailer(config.email, !config.production);
  if (config.email) console.log(`Emails are sent from ${config.email.from}, through Brevo.`);
  const sms = config.sms && new SmsNotes(config.sms, notebooks, live, push, config.sessionSecret, mailer);
  if (config.sms) console.log(`Notes can be texted to ${config.sms.number}.`);
  const app = createApp(config, notebooks, live, push, db, sms, mailer);

  if (!config.production) {
    http.createServer(app).on("upgrade", live.handleUpgrade).listen(config.httpPort, () => {
      console.log(`Development API on http://localhost:${config.httpPort} (log in as "admin", password "dev")`);
    });
    return;
  }

  const certFile = path.join(config.certDir, "fullchain.pem");
  const keyFile = path.join(config.certDir, "privkey.pem");
  const hasCertificate = existsSync(certFile) && existsSync(keyFile);

  http.createServer(createHttpApp(config, hasCertificate)).listen(config.httpPort, () => {
    console.log(`HTTP on port ${config.httpPort} (${hasCertificate ? "redirects to HTTPS" : "certificate checks only"})`);
  });

  if (hasCertificate) {
    const tls = { cert: readFileSync(certFile), key: readFileSync(keyFile) };
    https.createServer(tls, app).on("upgrade", live.handleUpgrade).listen(config.httpsPort, () => {
      console.log(`HTTPS on port ${config.httpsPort}`);
    });
  } else {
    console.warn(`No certificate in ${config.certDir}; the website isn't available until one is set up.`);
  }
}

main().catch((error) => {
  console.error("Server failed to start:", error);
  process.exit(1);
});
