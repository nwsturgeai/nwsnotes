import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, openNotes, test } from "./fixtures";

// New versions come through the service worker, so it's allowed here.
test.use({ serviceWorkers: "allow" });

/** The built service worker the test server serves. */
const SW_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "client", "dist", "sw.js");
const original = readFileSync(SW_FILE, "utf8");

/**
 * From now on the server has a "new version": its service worker file is different. (The browser
 * fetches that file itself, which a test can't intercept, so the file is changed, and put back after.)
 */
function publishNewVersion() {
  writeFileSync(SW_FILE, `${original}\n// A new version.\n`);
}

test.afterEach(() => {
  writeFileSync(SW_FILE, original);
});

/**
 * Opens the app and waits until its service worker is running and in charge of the page, as it is
 * whenever the installed app is opened.
 */
async function openWithServiceWorker(page: Page) {
  await openNotes(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null))) {
    await page.reload();
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  }
}

async function openSettings(page: Page) {
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
}

const versionSection = (page: Page) => page.locator("section").filter({ has: page.getByRole("heading", { name: "App version" }) });
const updateBanner = (page: Page) => page.getByRole("status").filter({ hasText: "A new version is ready." });

test("Check for updates says when this is the latest version", async ({ page }) => {
  await openWithServiceWorker(page);
  await openSettings(page);
  await expect(versionSection(page)).toContainText(/Version: \d{1,2} \w{3} \d{4}, \d{2}:\d{2}/);
  await versionSection(page).getByRole("button", { name: "Check for updates" }).click();
  await expect(versionSection(page)).toContainText("You have the latest version.");
});

test("Check for updates finds a new version, and Reload switches to it", async ({ page }) => {
  await openWithServiceWorker(page);
  await openSettings(page);
  publishNewVersion();
  await versionSection(page).getByRole("button", { name: "Check for updates" }).click();
  await expect(versionSection(page)).toContainText("A new version is ready.", { timeout: 15_000 });
  // The header says so too, on every page.
  await expect(updateBanner(page)).toBeVisible();

  const reloaded = page.waitForEvent("load");
  await versionSection(page).getByRole("button", { name: "Reload" }).click();
  await reloaded;
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await expect(page.getByText("A new version is ready.")).toHaveCount(0);
});

test("Reload switches to a new version after a hard refresh", async ({ page }) => {
  await openWithServiceWorker(page);
  // Ctrl+F5 (or Ctrl+Shift+R) loads the page past the service worker, so nothing is in charge of it.
  const cdp = await page.context().newCDPSession(page);
  const hardReloaded = page.waitForEvent("load");
  await cdp.send("Page.reload", { ignoreCache: true });
  await hardReloaded;
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
  await openSettings(page);
  publishNewVersion();
  await versionSection(page).getByRole("button", { name: "Check for updates" }).click();
  await expect(versionSection(page)).toContainText("A new version is ready.", { timeout: 15_000 });

  const reloaded = page.waitForEvent("load");
  await versionSection(page).getByRole("button", { name: "Reload" }).click();
  await reloaded;
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await expect(page.getByText("A new version is ready.")).toHaveCount(0);
});

test("the app checks for a new version by itself once a day", async ({ page }) => {
  await page.clock.install();
  await openWithServiceWorker(page);
  // The check at start-up must have finished first; otherwise (on a slow machine) it's retried an
  // hour later, as designed, and would find the new version before the day is up.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("nwsnotes.lastUpdateCheck")), { timeout: 15_000 })
    .not.toBeNull();
  publishNewVersion();
  // Not yet: it checked when it started.
  await page.clock.fastForward(2 * 60 * 60 * 1000);
  await expect(updateBanner(page)).toHaveCount(0);

  // A day later, the hourly look finds the daily check due.
  await page.clock.fastForward(23 * 60 * 60 * 1000);
  await expect(updateBanner(page)).toBeVisible({ timeout: 15_000 });
});

test.describe("reminders", () => {
  const remindersSection = (page: Page) => page.locator("section").filter({ has: page.getByRole("heading", { name: "Reminders" }) });

  test("when notifications are blocked, the settings page says so", async ({ page }) => {
    await openWithServiceWorker(page);
    await openSettings(page);
    // A test browser that hasn't been allowed to show notifications blocks them.
    await expect(remindersSection(page)).toContainText(
      "This browser blocks notifications from this site. Allow them in the browser's site settings to get reminders.",
    );
    await expect(remindersSection(page).getByRole("button")).toHaveCount(0);
  });

  test("with notifications allowed, reminders can be turned on", async ({ page, context, baseURL }) => {
    await context.grantPermissions(["notifications"], { origin: baseURL });
    // Headless Chromium always reports Notification.permission as "denied", even once granted, so the
    // page is told what the browser's permission settings say.
    await page.addInitScript(() => {
      Object.defineProperty(Notification, "permission", { get: () => "granted" });
    });
    await openWithServiceWorker(page);
    await openSettings(page);
    const section = remindersSection(page);
    await expect(section).toContainText("This device doesn't get reminders when notes fall due.");
    await section.getByRole("button", { name: "Turn on" }).click();
    // Subscribing needs the browser maker's push service, which a test browser may not reach: either
    // reminders are on (with Send test), or the page says why not.
    const sendTest = section.getByRole("button", { name: "Send test" });
    await expect(sendTest.or(section.getByRole("status"))).toBeVisible({ timeout: 15_000 });
    if (await sendTest.isVisible()) {
      await sendTest.click();
      await expect(section.getByRole("status")).toContainText("Test reminder sent to");
      await section.getByRole("button", { name: "Turn off" }).click();
      await expect(section).toContainText("This device doesn't get reminders when notes fall due.");
    }
  });
});
