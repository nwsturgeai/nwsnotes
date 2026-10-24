import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { createApp, createHttpApp } from "./app.js";
import { loadConfig } from "./config.js";
import { LiveUpdates } from "./live.js";
import { NoteStore } from "./store.js";

async function main() {
  const config = loadConfig();
  const store = new NoteStore(config.dataDir);
  await store.init();
  const live = new LiveUpdates(config.sessionSecret);
  const app = createApp(config, store, live);

  if (!config.production) {
    http.createServer(app).on("upgrade", live.handleUpgrade).listen(config.httpPort, () => {
      console.log(`Development API on http://localhost:${config.httpPort} (password: "dev")`);
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
