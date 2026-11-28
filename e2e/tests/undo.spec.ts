import { request as newRequest, type APIRequestContext, type Page } from "@playwright/test";
import { addArea, expect, expectTitles, filterRow, noteRow, noteTitles, openNotes, pills, shareTag, test } from "./fixtures";

/*
 * The Undo / Redo button on the notes page (Specs/undo.md). The seed's All tab lists these notes; "Buy
 * milk" (note 2) has the Home and Shopping (tag 4) tags.
 */
const ALL = ["Plan the team meeting", "Buy milk", "Read the quarterly report", "Old invoice", "", "Holiday plans", "Book flights", "Garden ideas"];
const BUY_MILK = 2;
const SHOPPING = 4;

const undoButton = (page: Page) => page.getByRole("banner").locator(".undo-button");
const notice = (page: Page) => page.locator(".undo-notice");

/** Adds a note from the add area. */
async function addNote(page: Page, title: string, key = "Enter") {
  const box = page.getByRole("textbox", { name: "New note" });
  await box.fill(title);
  await box.press(key);
  await expect(noteRow(page, title)).toBeVisible();
}

/** Checks the History page's newest summaries (opened from the notes page, then back again). */
async function expectHistory(page: Page, newest: string[]) {
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(page.getByRole("heading", { name: "History", level: 1 })).toBeVisible();
  // The list loads after the page opens.
  await expect.poll(async () => (await page.locator(".history-list .history-summary").allTextContents()).slice(0, newest.length)).toEqual(newest);
  await page.getByRole("link", { name: "← Settings" }).click();
  await page.getByRole("link", { name: "← Notes" }).click();
}

test.beforeEach(async ({ page }) => {
  await openNotes(page);
});

test("Undo appears in the top-left corner after a change, undoes it, and becomes Redo", async ({ page }) => {
  // Nothing to undo yet.
  await expect(undoButton(page)).toHaveCount(0);

  await noteRow(page, "Garden ideas").getByRole("button", { name: "Archive" }).click();
  const button = undoButton(page);
  await expect(button).toHaveAccessibleName('Undo: Archived "Garden ideas"');
  await expect(button).toHaveAttribute("title", 'Undo: Archived "Garden ideas"');
  await expect(button.locator("svg")).toHaveAttribute("data-icon", "arrow-rotate-left");
  // In the top-left corner, the cog's size, and before the first tab.
  const cog = (await page.getByRole("link", { name: "Settings" }).boundingBox())!;
  const box = (await button.boundingBox())!;
  const firstTab = (await page.locator(".tab-strip .tab").first().boundingBox())!;
  expect(box.x).toBe(0);
  expect(Math.abs(box.y)).toBeLessThanOrEqual(0.5);
  expect(box.x + box.width).toBeLessThanOrEqual(firstTab.x + 1);
  expect(box.width).toBe(cog.width);
  expect(box.height).toBe(cog.height);

  await button.click();
  await expect(notice(page)).toHaveText(/^Undone: Archived "Garden ideas"/);
  await expect(noteRow(page, "Garden ideas").getByRole("button", { name: "Archive" })).toBeVisible();
  await expect(button).toHaveAccessibleName('Redo: Archived "Garden ideas"');
  await expect(button.locator("svg")).toHaveAttribute("data-icon", "arrow-rotate-right");

  await button.click();
  await expect(notice(page)).toHaveText(/^Redone: Archived "Garden ideas"/);
  await expect(noteRow(page, "Garden ideas").getByRole("button", { name: "Reinstate" })).toBeVisible();
  await expect(button).toHaveAccessibleName('Undo: Archived "Garden ideas"');

  // The message can be closed.
  await notice(page).getByRole("button", { name: "OK" }).click();
  await expect(notice(page)).toHaveCount(0);

  // The History has the undo and the redo. (Settings has no Undo button.)
  await expectHistory(page, ['Redid: Archived "Garden ideas"', 'Undid: Archived "Garden ideas"', 'Archived "Garden ideas"']);
});

test("an edit, an add and an add at the top can each be undone", async ({ page }) => {
  await noteRow(page, "Buy milk").getByRole("button", { name: "Edit note" }).click();
  await page.getByRole("textbox", { name: "Note title" }).fill("Buy oat milk");
  await addArea(page).getByRole("button", { name: "Update" }).click();
  await expect(undoButton(page)).toHaveAccessibleName('Undo: Edited "Buy oat milk"');
  // Greyed out while a note is being edited.
  await noteRow(page, "Garden ideas").getByRole("button", { name: "Edit note" }).click();
  await expect(undoButton(page)).toHaveAttribute("aria-disabled", "true");
  await expect(undoButton(page)).toHaveAttribute("title", "Finish or cancel the edit first");
  // Tapping it does nothing.
  await undoButton(page).click({ force: true });
  await expect(noteRow(page, "Buy oat milk")).toBeVisible();
  await addArea(page).getByRole("button", { name: "Cancel" }).click();
  await expect(undoButton(page)).not.toHaveAttribute("aria-disabled");

  await undoButton(page).click();
  await expect(noteRow(page, "Buy milk")).toBeVisible();
  await expect(noteRow(page, "Buy oat milk")).toHaveCount(0);

  // Undoing an add deletes the note; Redo brings it back.
  await addNote(page, "Ring the plumber");
  await expect(undoButton(page)).toHaveAccessibleName('Undo: Added "Ring the plumber"');
  await undoButton(page).click();
  await expect(noteRow(page, "Ring the plumber")).toHaveCount(0);
  await undoButton(page).click();
  await expect(noteRow(page, "Ring the plumber")).toBeVisible();

  // Added at the top (two saves: the note, then the order): one Undo takes both back.
  const orderSaved = page.waitForResponse((response) => /\/api\/notes\/order$/.test(response.url()) && response.ok());
  await addNote(page, "Top of everything", "Control+Enter");
  await orderSaved;
  await expect.poll(async () => (await noteTitles(page))[0]).toBe("Top of everything");
  await expect(undoButton(page)).toHaveAccessibleName('Undo: Added "Top of everything"');
  await undoButton(page).click();
  await expect(notice(page)).toHaveText(/^Undone: Added "Top of everything"/);
  await expectTitles(page, [...ALL, "Ring the plumber"]);
});

test("a change to the order can be undone", async ({ page }) => {
  await filterRow(page).getByRole("button", { name: "Edit order" }).click();
  await noteRow(page, "Garden ideas").getByRole("button", { name: "Move to top" }).click();
  await expect.poll(async () => (await noteTitles(page))[0]).toBe("Garden ideas");
  await expect(undoButton(page)).toHaveAccessibleName("Undo: Changed the order of the notes");
  await undoButton(page).click();
  await expectTitles(page, ALL);
  await undoButton(page).click();
  await expect.poll(async () => (await noteTitles(page))[0]).toBe("Garden ideas");
});

test("Settings changes don't bring up or replace Undo, and it isn't on Settings", async ({ page }) => {
  await noteRow(page, "Garden ideas").getByRole("button", { name: "Archive" }).click();
  await expect(undoButton(page)).toBeVisible();

  // A change on Settings (moving the All tab to the left and back).
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(undoButton(page)).toHaveCount(0);
  for (let i = 0; i < 2; i++) {
    await page.locator("section").filter({ has: page.getByRole("heading", { name: "Tabs", exact: true }) }).getByRole("link", { name: /^All\b/ }).click();
    await page.locator("label.switch").click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  }
  await page.getByRole("link", { name: "← Notes" }).click();
  await expect(undoButton(page)).toHaveAccessibleName('Undo: Archived "Garden ideas"');

  // It's still there after a reload (this tab remembers it).
  await page.reload();
  await expect(undoButton(page)).toHaveAccessibleName('Undo: Archived "Garden ideas"');
});

test("Undo disappears 5 minutes after the change", async ({ page }) => {
  await page.clock.install();
  await page.reload();
  await noteRow(page, "Garden ideas").getByRole("button", { name: "Archive" }).click();
  await expect(undoButton(page)).toBeVisible();
  await page.clock.fastForward(4 * 60_000);
  await expect(undoButton(page)).toBeVisible();
  await page.clock.fastForward(60_000 + 1000);
  await expect(undoButton(page)).toHaveCount(0);
});

test("an undo is refused when the note has changed since, and Undo then goes", async ({ page }) => {
  await noteRow(page, "Buy milk").getByRole("button", { name: "Archive" }).click();
  await expect(undoButton(page)).toBeVisible();
  // Changed elsewhere (as from another device).
  expect((await page.request.put(`/api/notes/${BUY_MILK}/lifetime`, { data: { lifetime: "Waiting" } })).ok()).toBe(true);

  await undoButton(page).click();
  await expect(notice(page)).toHaveText(/That note has changed since, so it can't be undone here\. Use History to go back further\./);
  await expect(notice(page)).toHaveClass(/error/);
  await expect(undoButton(page)).toHaveCount(0);
});

test("Undo is hidden offline, and a change made offline doesn't bring it up", async ({ page, context }) => {
  await context.setOffline(true);
  const box = page.getByRole("textbox", { name: "New note" });
  await box.fill("Written offline");
  await box.press("Enter");
  await expect(page.getByRole("banner").getByRole("img", { name: /^Offline/ })).toBeVisible();
  await expect(undoButton(page)).toHaveCount(0);
  await context.setOffline(false);
});

test("multi-select tag changes can be undone", async ({ page }) => {
  await noteRow(page, "Old invoice").getByRole("button", { name: "Move to bin" }).click();
  await expect(undoButton(page)).toBeVisible();
  await page.getByRole("button", { name: "Show all tags" }).click();
  await addArea(page).getByRole("button", { name: "Select notes to change their tags" }).click();
  // Greyed out while selecting.
  await expect(undoButton(page)).toHaveAttribute("aria-disabled", "true");
  await noteRow(page, "Garden ideas").locator(".note-body").click();
  await addArea(page).getByRole("group", { name: "Topic" }).getByRole("button", { name: "Reading", exact: true }).click();
  await addArea(page).getByRole("button", { name: "Accept bulk tag updates" }).click();
  await expect(undoButton(page)).toHaveAccessibleName('Undo: Changed the tags on "Garden ideas"');
  await expect(pills(noteRow(page, "Garden ideas")).filter({ hasText: "Reading" })).toHaveCount(1);
  await undoButton(page).click();
  await expect(pills(noteRow(page, "Garden ideas")).filter({ hasText: "Reading" })).toHaveCount(0);
});

test("the undo API: only the person who made a change can undo it, as their permission now allows", async ({ page, baseURL }) => {
  const admin = page.request;
  const made = await admin.post("/api/users", { data: { displayName: "Sam Smith", loginName: "sam@example.com" } });
  const { password } = (await made.json()) as { password: string };
  const sam: APIRequestContext = await newRequest.newContext({ baseURL });
  expect((await sam.post("/api/login", { data: { loginName: "sam@example.com", password } })).ok()).toBe(true);
  await shareTag(admin, SHOPPING, [{ loginName: "sam@example.com", permission: "edit" }]);

  // Sam sets the admin's Buy milk to Waiting: the reply says which change that was.
  const changed = await sam.put(`/api/notes/${BUY_MILK}/lifetime`, { data: { lifetime: "Waiting" } });
  expect(changed.ok()).toBe(true);
  const made1 = JSON.parse(decodeURIComponent(changed.headers()["x-changes"]!)) as { id: number; summary: string }[];
  expect(made1).toEqual([{ id: expect.any(Number), summary: 'Set "Buy milk" to Waiting' }]);
  const changeIds = made1.map((change) => change.id);

  // The admin didn't make it, so can't undo it this way.
  const byAdmin = await admin.post("/api/history/undo", { data: { changeIds } });
  expect(byAdmin.status()).toBe(403);

  // Sam can.
  const undone = await sam.post("/api/history/undo", { data: { changeIds } });
  expect(undone.ok()).toBe(true);
  const { changes } = (await undone.json()) as { changes: { id: number; summary: string }[] };
  expect(changes).toEqual([{ id: expect.any(Number), summary: 'Undid: Set "Buy milk" to Waiting' }]);
  const lifetime = async () => {
    const data = (await (await admin.get("/api/notes")).json()) as { notes: { id: number; tagIds: number[] }[] };
    return data.notes.find((note) => note.id === BUY_MILK)!.tagIds.filter((id) => id < 0);
  };
  expect(await lifetime()).toEqual([-1]);

  // Once only reading is allowed, Sam can't redo it.
  await shareTag(admin, SHOPPING, [{ loginName: "sam@example.com", permission: "read" }]);
  const redo = await sam.post("/api/history/undo", { data: { changeIds: changes.map((change) => change.id) } });
  expect(redo.status()).toBe(403);
  expect(await lifetime()).toEqual([-1]);

  // The owner's History says who did what.
  await page.reload();
  await expectHistory(page, ['Undid: Set "Buy milk" to Waiting (by Sam Smith)', 'Set "Buy milk" to Waiting (by Sam Smith)']);
  await sam.dispose();
});
