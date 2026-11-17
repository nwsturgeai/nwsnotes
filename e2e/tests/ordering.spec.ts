import type { Locator, Page } from "@playwright/test";
import { addArea, expect, expectTitles, filterRow, noteRow, openNotes, selectTab, test } from "./fixtures";

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

  const saved = page.waitForResponse((response) => /\/api\/tabs\/1\/order$/.test(response.url()) && response.ok());
  await dragAbove(page, noteRow(page, "Old invoice"), noteRow(page, "Plan the team meeting"));
  await saved;
  await expectTitles(page, ["Old invoice", "Plan the team meeting", "Read the quarterly report"]);

  await filterRow(page).getByRole("button", { name: "Finish ordering" }).click();
  await expect(page.getByTitle("Drag to reorder")).toHaveCount(0);

  // Saved for the tab, which a reload shows; All stays in creation order.
  await page.reload();
  await selectTab(page, "Work");
  await expectTitles(page, ["Old invoice", "Plan the team meeting", "Read the quarterly report"]);
  await selectTab(page, "All");
  await expect.poll(async () => (await page.locator(".note-list li[data-note-id]").first().textContent()) ?? "").toContain("Plan the team meeting");
});

test("edit-order mode is only on tabs, and not while a note is being edited", async ({ page }) => {
  await noteRow(page, "Old invoice").getByRole("button", { name: "Edit note" }).click();
  await expect(filterRow(page).getByRole("button", { name: "Finish or cancel the edit first" }).last()).toBeDisabled();
  await addArea(page).getByRole("button", { name: "Cancel", exact: true }).click();

  await expect(filterRow(page).getByRole("button", { name: "Edit order" })).toBeEnabled();
  await selectTab(page, "All");
  await expect(filterRow(page).getByRole("button", { name: "Edit order" })).toHaveCount(0);
});
