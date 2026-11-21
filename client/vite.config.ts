import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { buildDocs, docsContentType } from "./docsBuild";

/**
 * The help pages (docs/*.md, see Specs/docs.md): added to the built site before the service worker is
 * made, so it saves them for offline use; and in development, built afresh on each request, so edits
 * show on reloading.
 */
function helpPages(): Plugin {
  return {
    name: "nwsnotes-help-pages",
    generateBundle() {
      for (const file of buildDocs()) this.emitFile({ type: "asset", fileName: file.fileName, source: file.source });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const address = decodeURIComponent((req.url ?? "").split("?")[0]!);
        if (address !== "/docs" && !address.startsWith("/docs/")) return next();
        let files;
        try {
          files = buildDocs();
        } catch (error) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end(error instanceof Error ? error.message : String(error));
          return;
        }
        const name = address.slice(1);
        // /docs and /docs/tabs go to /docs/ and /docs/tabs/, as on the live site.
        if (!name.includes(".") && !name.endsWith("/") && files.some((file) => file.fileName === `${name}/index.html` || (name === "docs" && file.fileName === "docs/index.html"))) {
          res.writeHead(301, { Location: `${address}/` });
          res.end();
          return;
        }
        const wanted = name.endsWith("/") ? `${name}index.html` : name;
        const file = files.find((candidate) => candidate.fileName === wanted) ?? files.find((candidate) => candidate.fileName === "docs/404.html")!;
        res.statusCode = file.fileName === wanted ? 200 : 404;
        res.setHeader("Content-Type", docsContentType(file.fileName));
        res.end(file.source);
      });
    },
  };
}

export default defineConfig({
  // Shown on the settings page as the app's version.
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  plugins: [
    react(),
    helpPages(),
    // Makes the site installable as an Android app (PWA): a web app manifest and a service worker.
    VitePWA({
      // A downloaded new version waits until "Reload" is tapped (appUpdate.ts registers the worker).
      registerType: "prompt",
      injectRegister: false,
      manifest: {
        name: "nwsnotes",
        short_name: "nwsnotes",
        description: "My notes",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#2f5d50",
        background_color: "#f6f4ef",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Only the website's own files are cached. Notes always come from the server, and API
        // addresses (including the backup download link) always go to the network.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "/index.html",
        // The help pages are their own pages, not the app (they're saved for offline use like the rest).
        navigateFallbackDenylist: [/^\/api\//, /^\/ws/, /^\/docs(\/|$)/],
        // Due-date reminders: showing pushed notifications and opening the app when one is tapped.
        importScripts: ["push-sw.js"],
      },
    }),
  ],
  server: {
    port: 5173,
    // In development, API calls and the live-updates WebSocket go to the Express server.
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        // If the Express server isn't running, answer 502 like the live site's proxy does (rather
        // than Vite's 500), so the app treats it as offline, as it would on the live site.
        configure: (proxy) => {
          proxy.on("error", (_error, _req, res) => {
            if ("writeHead" in res && !res.headersSent) {
              res.writeHead(502, { "Content-Type": "text/plain" });
              res.end("The API server isn't running.");
            }
          });
        },
      },
      "/ws": { target: "ws://localhost:3000", ws: true },
    },
  },
});
