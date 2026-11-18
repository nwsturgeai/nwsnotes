import type { Page } from "@playwright/test";
import { expect, expectTitles, noteRow, openNotes, seed, test } from "./fixtures";

async function addNote(page: Page, title: string) {
  const box = page.getByRole("textbox", { name: "New note" });
  await box.fill(title);
  await box.press("Enter");
  await expect(noteRow(page, title)).toBeVisible();
}

test("every change is in the database, as a restart shows", async ({ page }) => {
  await openNotes(page);
  await addNote(page, "Stored for good");
  await noteRow(page, "Garden ideas").getByRole("button", { name: "Archive" }).click();
  await expect(noteRow(page, "Garden ideas").getByRole("button", { name: "Move to bin" })).toBeVisible();
  const reordered = await page.request.put("/api/tabs/order", { data: { ids: [3, 1, 2] } });
  expect(reordered.ok()).toBe(true);
  const before = await (await page.request.get("/api/notes")).json();

  // The server forgets everything and loads it again from the database.
  expect((await page.request.post("/api/test/reload")).ok()).toBe(true);
  expect(await (await page.request.get("/api/notes")).json()).toEqual(before);
  await page.reload();
  await expect(noteRow(page, "Stored for good")).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Tabs" }).getByRole("tab")).toHaveText(["All", "On hold", "Work", "Home"]);
});

test("the first start with a new database imports the latest save-file", async ({ page }) => {
  const file = { ...(seed as Record<string, unknown>), notes: [(seed as { notes: unknown[] }).notes[0]] };
  const response = await page.request.post("/api/test/import", { data: file });
  const { file: name } = (await response.json()) as { file: string };
  expect(name).toMatch(/^notes-.*\.json$/);

  await openNotes(page);
  await expectTitles(page, ["Plan the team meeting"]);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(page.locator(".history-list .history-summary")).toHaveText([`Imported from ${name}`]);
});

test("Download backup gives every note in the save-file format", async ({ page }) => {
  await openNotes(page);
  await page.getByRole("link", { name: "Settings" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download backup" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^notes-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/);
  const content = JSON.parse(await (await import("node:fs/promises")).readFile((await file.path())!, "utf8")) as Record<string, unknown>;
  expect(content.version).toBe(2);
  expect((content.notes as unknown[]).length).toBe(9);
  expect(content.lastNoteId).toBe(9);
  expect((content.tabs as unknown[]).length).toBe(3);
  expect((content.categories as unknown[]).length).toBe(2);
});

test("when the database can't be reached, the app works offline and catches up afterwards", async ({ page }) => {
  await openNotes(page);
  await page.request.post("/api/test/database", { data: { reachable: false } });

  await addNote(page, "Written while it was down");
  const offline = page.getByRole("banner").getByRole("img", { name: /^Offline/ });
  await expect(offline).toBeVisible();
  await expect(noteRow(page, "Written while it was down").locator(".note-pending")).toBeVisible();

  await page.request.post("/api/test/database", { data: { reachable: true } });
  // The app checks again every 15 seconds while offline.
  await expect(offline).toHaveCount(0, { timeout: 25_000 });
  await expect(noteRow(page, "Written while it was down").locator(".note-pending")).toHaveCount(0, { timeout: 10_000 });
  await page.reload();
  await expect(noteRow(page, "Written while it was down")).toBeVisible();
});
