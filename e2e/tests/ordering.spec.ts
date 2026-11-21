import type { Locator, Page } from "@playwright/test";
import { addArea, expect, expectTitles, filterRow, noteRow, noteTitles, openNotes, selectTab, test } from "./fixtures";

/** Waits for the shared note order to be saved. */
const savedOrder = (page: Page) => page.waitForResponse((response) => /\/api\/notes\/order$/.test(response.url()) && response.ok());

const WORK = ["Plan the team meeting", "Read the quarterly report", "Old invoice"];

/** Drags a note by its grip to just above another note. Escape before letting go cancels instead. */
async function dragAbove(page: Page, note: Locator, above: Locator, cancel = false) {
  const grip = note.getByTitle("Drag to reorder");
  const from = (await grip.boundingBox())!;
  const to = (await above.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, to.y + 4, { steps: 10 });
  if (cancel) await page.keyboard.press("Escape");
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  // One column, so the notes are one above another (Medium, the default, gives several on a wide screen).
  await page.addInitScript(() => localStorage.setItem("nwsnotes.columns", "single"));
  await openNotes(page);
  await selectTab(page, "Work");
  await expectTitles(page, WORK);
});

test("dragging a note in edit-order mode changes the tab's order", async ({ page }) => {
  await filterRow(page).getByRole("button", { name: "Edit order" }).click();
  await expect(filterRow(page).getByRole("button", { name: "Finish ordering" })).toBeVisible();

  // Escape during a drag puts the note back.
  await dragAbove(page, noteRow(page, "Old invoice"), noteRow(page, "Plan the team meeting"), true);
  await expectTitles(page, WORK);

  const saved = page.waitForResponse((response) => /\/api\/notes\/order$/.test(response.url()) && response.ok());
  await dragAbove(page, noteRow(page, "Old invoice"), noteRow(page, "Plan the team meeting"));
  await saved;
  await expectTitles(page, ["Old invoice", "Plan the team meeting", "Read the quarterly report"]);

  await filterRow(page).getByRole("button", { name: "Finish ordering" }).click();
  await expect(page.getByTitle("Drag to reorder")).toHaveCount(0);

  // Saved, which a reload shows; All follows the same shared order.
  await page.reload();
  await selectTab(page, "Work");
  await expectTitles(page, ["Old invoice", "Plan the team meeting", "Read the quarterly report"]);
  await selectTab(page, "All");
  await expect.poll(async () => (await noteTitles(page)).slice(0, 2)).toEqual(["Old invoice", "Plan the team meeting"]);
});

test("in edit-order mode, notes have Move to top and Move to bottom instead of their usual buttons", async ({ page }) => {
  await filterRow(page).getByRole("button", { name: "Edit order" }).click();
  const invoice = noteRow(page, "Old invoice");
  await expect(invoice.locator(".note-actions").getByRole("button")).toHaveCount(2);
  await expect(page.locator(".note-list").getByRole("button", { name: "Edit note" })).toHaveCount(0);
  await expect(page.locator(".note-list").getByRole("button", { name: "Archive" })).toHaveCount(0);
  // Already at the top or bottom: that button is greyed out.
  await expect(noteRow(page, "Plan the team meeting").getByRole("button", { name: "Move to top" })).toBeDisabled();
  await expect(invoice.getByRole("button", { name: "Move to bottom" })).toBeDisabled();

  const saved = () => page.waitForResponse((response) => /\/api\/notes\/order$/.test(response.url()) && response.ok());
  let save = saved();
  await invoice.getByRole("button", { name: "Move to top" }).click();
  await save;
  await expectTitles(page, ["Old invoice", "Plan the team meeting", "Read the quarterly report"]);
  save = saved();
  await noteRow(page, "Plan the team meeting").getByRole("button", { name: "Move to bottom" }).click();
  await save;
  await expectTitles(page, ["Old invoice", "Read the quarterly report", "Plan the team meeting"]);

  // Finishing brings the usual buttons back; the order is saved for the tab.
  await filterRow(page).getByRole("button", { name: "Finish ordering" }).click();
  await expect(invoice.getByRole("button", { name: "Edit note" })).toBeVisible();
  await page.reload();
  await selectTab(page, "Work");
  await expectTitles(page, ["Old invoice", "Read the quarterly report", "Plan the team meeting"]);
});

test("edit-order mode isn't available while a note is being edited", async ({ page }) => {
  await noteRow(page, "Old invoice").getByRole("button", { name: "Edit note" }).click();
  await expect(filterRow(page).getByRole("button", { name: "Finish or cancel the edit first" }).last()).toBeDisabled();
  await addArea(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(filterRow(page).getByRole("button", { name: "Edit order" })).toBeEnabled();
});

test("every tab shares one order: a note keeps its place relative to the others on every tab, All included", async ({ page }) => {
  // Moving a note on Work moves it on All too, among the notes it was near.
  await filterRow(page).getByRole("button", { name: "Edit order" }).click();
  let save = savedOrder(page);
  await noteRow(page, "Old invoice").getByRole("button", { name: "Move to top" }).click();
  await save;
  await selectTab(page, "All");
  await expect.poll(async () => (await noteTitles(page)).slice(0, 3)).toEqual(["Old invoice", "Plan the team meeting", "Buy milk"]);

  // All can be ordered too, and that shows on the other tabs.
  await expect(filterRow(page).getByRole("button", { name: "Finish ordering" })).toBeVisible();
  save = savedOrder(page);
  await noteRow(page, "Garden ideas").getByRole("button", { name: "Move to top" }).click();
  await save;
  await expect.poll(async () => (await noteTitles(page))[0]).toBe("Garden ideas");
  await selectTab(page, "Home");
  await expect.poll(async () => (await noteTitles(page))[0]).toBe("Garden ideas");
  // Work doesn't show it, so its order is as it was.
  await selectTab(page, "Work");
  await expectTitles(page, ["Old invoice", "Plan the team meeting", "Read the quarterly report"]);

  // Each move is a change in the History.
  await filterRow(page).getByRole("button", { name: "Finish ordering" }).click();
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(page.locator(".history-list .history-summary").first()).toHaveText("Changed the order of the notes");
});

test("on All, Ctrl+Enter adds the note at the top", async ({ page }) => {
  await selectTab(page, "All");
  const title = page.getByRole("textbox", { name: "New note" });
  await title.fill("Top of everything");
  const save = savedOrder(page);
  await title.press("Control+Enter");
  await save;
  await expect.poll(async () => (await noteTitles(page))[0]).toBe("Top of everything");
  await page.reload();
  await expect.poll(async () => (await noteTitles(page))[0]).toBe("Top of everything");
});
