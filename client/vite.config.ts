import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    // Makes the site installable as an Android app (PWA): a web app manifest and a service worker.
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "script",
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
        globPatterns: ["**/*.{js,css,html,svg,png}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/ws/],
      },
    }),
  ],
  server: {
    port: 5173,
    // In development, API calls and the live-updates WebSocket go to the Express server.
    proxy: {
      "/api": "http://localhost:3000",
      "/ws": { target: "ws://localhost:3000", ws: true },
    },
  },
});
