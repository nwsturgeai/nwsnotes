import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The test server's own port, so the tests run alongside the dev servers (3000 and 5173). */
const PORT = 3100;

/** The login saved by the setup step, reused by every test apart from the login tests. */
export const SESSION_FILE = path.join(here, ".auth", "session.json");

export default defineConfig({
  testDir: "tests",
  // The tests share one server and its data, so they run one at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Dates show the same wherever the tests run (on GitHub, the computers are on UTC).
    timezoneId: "Europe/London",
    locale: "en-GB",
    // A cached old build mustn't confuse a test; the offline and app-update tests allow them.
    serviceWorkers: "block",
    // Kept for failed tests: `npx playwright show-report` opens them.
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "tablet",
      dependencies: ["setup"],
      use: {
        browserName: "chromium",
        viewport: { width: 768, height: 1024 },
        hasTouch: true,
        isMobile: true,
        userAgent:
          "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        storageState: SESSION_FILE,
      },
    },
    {
      name: "desktop",
      dependencies: ["setup"],
      use: {
        browserName: "chromium",
        viewport: { width: 1280, height: 800 },
        storageState: SESSION_FILE,
      },
    },
  ],
  // The built app (npm run test:e2e builds it first), served by Express as in production, apart from HTTPS.
  webServer: {
    command: "node dist/server.cjs",
    cwd: path.join(here, "..", "server"),
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      PORT: String(PORT),
      // Its own data folder: never real or dev notes. The data is put back to the seed before each test.
      NWSNOTES_DATA_DIR: path.join(here, ".test-data"),
      NWSNOTES_TEST: "1",
    },
  },
});
