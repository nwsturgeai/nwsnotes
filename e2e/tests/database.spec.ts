import type { Page } from "@playwright/test";
import { expect, noteRow, noteTitles, openNotes, seed, test } from "./fixtures";

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
  await expect(page.getByRole("tablist", { name: "Tabs", exact: true }).getByRole("tab")).toHaveText(["All", "On hold", "Work", "Home"]);
});

test("a save-file from before the order was shared gets one shared order, the higher tab winning", async ({ page }) => {
  const old = JSON.parse(JSON.stringify(seed)) as { noteOrder?: unknown; tabs: { id: number; noteOrder?: number[] }[] };
  delete old.noteOrder;
  // Work lists Old invoice before Plan the team meeting; Home disagrees, so Work wins.
  const orders: Record<number, number[]> = { 1: [4, 1], 2: [9, 2, 1, 4], 3: [] };
  for (const tab of old.tabs) tab.noteOrder = orders[tab.id] ?? [];
  // Loaded as the tests' seed is, which reads a save-file the way --restore does.
  expect((await page.request.post("/api/test/reset", { data: old })).ok()).toBe(true);

  const data = (await (await page.request.get("/api/notes")).json()) as { noteOrder: number[]; tabs: object[] };
  expect(data.noteOrder).toEqual([4, 9, 2, 1]);
  for (const tab of data.tabs) expect(tab).not.toHaveProperty("noteOrder");
  await openNotes(page);
  await expect.poll(async () => (await noteTitles(page)).slice(0, 5)).toEqual([
    "Old invoice",
    "Garden ideas",
    "Buy milk",
    "Plan the team meeting",
    "Read the quarterly report",
  ]);
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
  expect(content.noteOrder).toEqual([]);
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
