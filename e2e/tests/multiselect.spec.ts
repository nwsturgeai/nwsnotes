import type { Page } from "@playwright/test";
import { addArea, expect, noteRow, openNotes, pills, selectTab, test } from "./fixtures";

/** Turns on multi-select (its button is in the expanded add area). */
async function startSelecting(page: Page) {
  await page.getByRole("button", { name: "Show all tags" }).click();
  await addArea(page).getByRole("button", { name: "Select notes to change their tags" }).click();
  await expect(addArea(page).getByRole("button", { name: "Stop selecting notes" })).toBeVisible();
}

/** Taps a note's row, which selects or unselects it. */
async function tapNote(page: Page, title: string) {
  await noteRow(page, title).locator(".note-body").click();
}

/** A tag pill in multi-select's tag picker. */
function bulkPill(page: Page, category: string, tag: string) {
  return addArea(page).getByRole("group", { name: category }).getByRole("button", { name: tag, exact: true });
}

const selectedRows = (page: Page) => page.locator('.note-list li[aria-selected="true"]');

test.beforeEach(async ({ page }) => {
  await openNotes(page);
});

test("selected notes all get a tag", async ({ page }) => {
  await startSelecting(page);
  await tapNote(page, "Plan the team meeting");
  await tapNote(page, "Garden ideas");
  await tapNote(page, "Buy milk");
  await tapNote(page, "Buy milk");
  await expect(selectedRows(page)).toHaveCount(2);
  await expect(noteRow(page, "Plan the team meeting")).toHaveAttribute("aria-selected", "true");

  await bulkPill(page, "Topic", "Reading").click();
  await addArea(page).getByRole("button", { name: "Accept bulk tag updates" }).click();
  await expect(page.getByRole("status")).toHaveText("Tags updated on 2 notes.");
  await expect(addArea(page).getByRole("button", { name: "Select notes to change their tags" })).toBeVisible();

  await page.reload();
  await expect(pills(noteRow(page, "Plan the team meeting"))).toHaveText(["Work", "Reading"]);
  await expect(pills(noteRow(page, "Garden ideas"))).toHaveText(["Home", "Ideas", "Reading"]);
  await expect(pills(noteRow(page, "Buy milk"))).toHaveText(["Home", "Shopping", "New"]);
});

test("holding the multi-select button starts with every listed note selected", async ({ page }) => {
  await selectTab(page, "Work");
  await page.getByRole("button", { name: "Show all tags" }).click();
  const button = addArea(page).getByRole("button", { name: "Select notes to change their tags" });

  await button.hover();
  await page.mouse.down();
  // The same signals as holding Add: a ring fills, then rings burst out.
  await expect(page.locator(".hold-ring .hold-progress")).toBeVisible();
  await expect(button).toHaveClass(/\bheld\b/, { timeout: 2_000 });
  await expect(page.locator(".hold-ring .hold-burst").first()).toBeVisible();
  await page.mouse.up();

  await expect(addArea(page).getByRole("button", { name: "Stop selecting notes" })).toBeVisible();
  await expect(selectedRows(page)).toHaveCount(3);
  await expect(page.locator(".hold-ring")).toHaveCount(0);

  // A short click turns it off, and another turns it on with nothing selected.
  await addArea(page).getByRole("button", { name: "Stop selecting notes" }).click();
  await addArea(page).getByRole("button", { name: "Select notes to change their tags" }).click();
  await expect(addArea(page).getByRole("button", { name: "Stop selecting notes" })).toBeVisible();
  await expect(selectedRows(page)).toHaveCount(0);
});

test("All and None select every listed note or none, until a pill is clicked", async ({ page }) => {
  await selectTab(page, "Work");
  await startSelecting(page);
  const all = page.getByRole("group", { name: "Select notes" }).getByRole("button", { name: "All" });
  const none = page.getByRole("group", { name: "Select notes" }).getByRole("button", { name: "None" });
  // With nothing selected, the pills can't be clicked.
  await expect(bulkPill(page, "Topic", "Ideas")).toBeDisabled();

  await all.click();
  await expect(selectedRows(page)).toHaveCount(3);
  await none.click();
  await expect(selectedRows(page)).toHaveCount(0);

  await all.click();
  await bulkPill(page, "Topic", "Ideas").click();
  // Once a pill has been clicked, the selection is fixed.
  await expect(all).toBeDisabled();
  await expect(none).toBeDisabled();
  await tapNote(page, "Old invoice");
  await expect(selectedRows(page)).toHaveCount(3);
});

test("a pill some notes have can be removed from all of them", async ({ page }) => {
  await startSelecting(page);
  await tapNote(page, "Buy milk");
  await tapNote(page, "Garden ideas");
  const shopping = bulkPill(page, "Topic", "Shopping");
  // Only one of the two has Shopping.
  await expect(shopping).toHaveAttribute("aria-pressed", "mixed");
  await shopping.click();
  await expect(shopping).toHaveAttribute("aria-pressed", "true");
  await shopping.click();
  await expect(shopping).toHaveAttribute("aria-pressed", "false");
  await addArea(page).getByRole("button", { name: "Accept bulk tag updates" }).click();
  await expect(page.getByRole("status")).toHaveText("Tags updated on 2 notes.");
  await expect(pills(noteRow(page, "Buy milk"))).toHaveText(["Home", "New"]);
  await expect(pills(noteRow(page, "Garden ideas"))).toHaveText(["Home", "Ideas"]);
});

test("a single-select tag replaces the category's other tag, and stopping changes nothing", async ({ page }) => {
  await startSelecting(page);
  await tapNote(page, "Plan the team meeting");
  await bulkPill(page, "Area", "Home").click();
  await expect(bulkPill(page, "Area", "Work")).toHaveAttribute("aria-pressed", "false");

  // Stopping throws the changes away.
  await addArea(page).getByRole("button", { name: "Stop selecting notes" }).click();
  await expect(pills(noteRow(page, "Plan the team meeting"))).toHaveText(["Work"]);

  await addArea(page).getByRole("button", { name: "Select notes to change their tags" }).click();
  await tapNote(page, "Plan the team meeting");
  await bulkPill(page, "Area", "Home").click();
  await addArea(page).getByRole("button", { name: "Accept bulk tag updates" }).click();
  await expect(page.getByRole("status")).toHaveText("Tags updated on 1 note.");
  await expect(pills(noteRow(page, "Plan the team meeting"))).toHaveText(["Home"]);
});
