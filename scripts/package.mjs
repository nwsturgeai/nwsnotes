// Assembles the deployable app in dist/:
//   dist/server.cjs           - the bundled API server
//   dist/public/              - the built React website
//   dist/ecosystem.config.cjs - pm2 settings
import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });
cpSync("server/dist/server.cjs", "dist/server.cjs");
cpSync("client/dist", "dist/public", { recursive: true });
cpSync("deploy/ecosystem.config.cjs", "dist/ecosystem.config.cjs");
console.log("Build assembled in dist/");
