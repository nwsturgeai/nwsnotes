import type { Page } from "@playwright/test";
import { expect, logIn, test } from "./fixtures";

/** Writes to the test server's log, as if something had gone wrong there. */
async function logOnServer(page: Page, data: { level?: "error" | "warning"; message: string; fail?: boolean }) {
  const response = await page.request.post("/api/test/server-log", { data });
  expect(response.status()).toBe(data.fail ? 500 : 200);
}

const summary = (page: Page) => page.getByTestId("server-log-summary");
const entries = (page: Page) => page.getByRole("list", { name: "Server errors" }).getByTestId("server-log-entry");

async function openServerErrors(page: Page) {
  await page.goto("/settings");
  await page.getByRole("link", { name: "View server errors" }).click();
  await expect(page.getByRole("heading", { name: "Server errors", level: 1 })).toBeVisible();
}

test("an admin sees in Settings whether the server has had errors, and their details on the Server errors page", async ({ page }) => {
  await page.goto("/settings");
  await expect(summary(page)).toHaveText("No errors or warnings on the server in the last 30 days.");

  await logOnServer(page, { level: "warning", message: "The database can't be reached; trying again in 5 seconds." });
  await logOnServer(page, { message: "Couldn't send reminders: push service down" });
  await logOnServer(page, { message: "Couldn't send reminders: push service down" });
  // A failing request: kept with where it happened and its stack trace.
  await logOnServer(page, { message: "Something broke in a route", fail: true });

  await page.reload();
  await expect(summary(page)).toContainText("3 errors and 1 warning on the server in the last 30 days. The latest was at");

  await page.getByRole("link", { name: "View server errors" }).click();
  await expect(page).toHaveURL(/\/settings\/server-errors$/);
  await expect(entries(page)).toHaveCount(3);

  // The most recent first.
  const failed = entries(page).nth(0);
  await expect(failed).toContainText("Error");
  await expect(failed).toContainText("Something broke in a route");
  await expect(failed).toContainText("While answering POST /api/test/server-log");
  await failed.getByText("Details").click();
  await expect(failed.locator("pre")).toContainText("at ");

  // The same error twice is one entry, counted.
  const repeated = entries(page).nth(1);
  await expect(repeated).toContainText("Couldn't send reminders: push service down");
  await expect(repeated).toContainText("2 times, first at");
  await expect(repeated.getByText("Details")).toHaveCount(0);

  await expect(entries(page).nth(2)).toContainText("Warning");
  await expect(entries(page).nth(2)).toContainText("The database can't be reached");

  // Refresh picks up new ones.
  await logOnServer(page, { message: "A new problem" });
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(entries(page)).toHaveCount(4);
  await expect(entries(page).nth(0)).toContainText("A new problem");

  // Clearing asks first.
  await page.getByRole("button", { name: "Clear all" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(entries(page)).toHaveCount(4);
  await page.getByRole("button", { name: "Clear all" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Clear all" }).click();
  await expect(page.getByText("No errors or warnings on the server in the last 30 days.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear all" })).toHaveCount(0);

  await page.getByRole("button", { name: "Done" }).click();
  await expect(summary(page)).toHaveText("No errors or warnings on the server in the last 30 days.");
});

test("refused requests (the user's mistake, not the server's) aren't listed", async ({ page }) => {
  expect((await page.request.put("/api/notes/999999", { data: { title: "Nope" } })).status()).toBeLessThan(500);
  await openServerErrors(page);
  await expect(page.getByText("No errors or warnings on the server in the last 30 days.")).toBeVisible();
});

test("a user who isn't an admin sees no Server errors section, and the API refuses them", async ({ page, browser }) => {
  const response = await page.request.post("/api/users", { data: { displayName: "Pat", loginName: "pat@example.com" } });
  expect(response.status()).toBe(201);
  const { password } = (await response.json()) as { password: string };
  await logOnServer(page, { message: "Something only admins should see" });

  const use = test.info().project.use;
  const context = await browser.newContext({
    baseURL: use.baseURL,
    viewport: use.viewport,
    hasTouch: use.hasTouch,
    isMobile: use.isMobile,
    userAgent: use.userAgent,
    serviceWorkers: "block",
    storageState: { cookies: [], origins: [] },
  });
  const pat = await context.newPage();
  await pat.goto("/");
  await logIn(pat, "pat@example.com", password);
  await pat.getByRole("link", { name: "Settings" }).click();
  await expect(pat.getByRole("heading", { name: "Account" })).toBeVisible();
  await expect(pat.getByRole("heading", { name: "Server errors" })).toHaveCount(0);
  await expect(pat.getByRole("link", { name: "View server errors" })).toHaveCount(0);

  expect((await pat.request.get("/api/server-log")).status()).toBe(403);
  expect((await pat.request.delete("/api/server-log")).status()).toBe(403);
  // Their address for the page shows their notes instead.
  await pat.goto("/settings/server-errors");
  await expect(pat.getByRole("heading", { name: "Server errors" })).toHaveCount(0);
  await context.close();

  // Still there for the admin.
  await openServerErrors(page);
  await expect(entries(page)).toHaveCount(1);
});
