import type { Page } from "@playwright/test";
import { expect, noteRow, openNotes, pills, selectTab, test } from "./fixtures";

/** Opens the settings page from the notes page. */
async function openSettings(page: Page) {
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
}

test.describe("on a note", () => {
  test.beforeEach(async ({ page }) => {
    await openNotes(page);
  });

  test("Waiting puts a note on hold, and Reinstate makes it Active again", async ({ page }) => {
    const row = noteRow(page, "Plan the team meeting");
    await row.getByRole("button", { name: "Waiting" }).click();
    await expect(row.getByRole("button", { name: "Reinstate" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Waiting" })).toHaveCount(0);

    await selectTab(page, "On hold");
    await expect(noteRow(page, "Plan the team meeting")).toBeVisible();
    await noteRow(page, "Plan the team meeting").getByRole("button", { name: "Reinstate" }).click();
    // It leaves the On hold tab.
    await expect(noteRow(page, "Plan the team meeting")).toHaveCount(0);
    await selectTab(page, "All");
    await expect(noteRow(page, "Plan the team meeting").getByRole("button", { name: "Waiting" })).toBeVisible();
  });

  test("Archive archives a note, which can then be reinstated", async ({ page }) => {
    const row = noteRow(page, "Garden ideas");
    await row.getByRole("button", { name: "Archive" }).click();
    // Archived notes can be reinstated or moved to the bin, but not archived again.
    await expect(row.getByRole("button", { name: "Move to bin" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Reinstate" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Archive" })).toHaveCount(0);
    await page.reload();
    await expect(noteRow(page, "Garden ideas").getByRole("button", { name: "Move to bin" })).toBeVisible();

    await noteRow(page, "Garden ideas").getByRole("button", { name: "Reinstate" }).click();
    await expect(noteRow(page, "Garden ideas").getByRole("button", { name: "Archive" })).toBeVisible();
    await expect(noteRow(page, "Garden ideas").getByRole("button", { name: "Waiting" })).toBeVisible();
  });

  test("Move to bin hides an archived note", async ({ page }) => {
    await noteRow(page, "Old invoice").getByRole("button", { name: "Move to bin" }).click();
    await expect(noteRow(page, "Old invoice")).toHaveCount(0);
    await page.reload();
    await expect(noteRow(page, "Plan the team meeting")).toBeVisible();
    await expect(noteRow(page, "Old invoice")).toHaveCount(0);
  });

  test("tapping a New pill resets the New tags, after asking", async ({ page }) => {
    const row = noteRow(page, "Buy milk");
    await row.getByRole("button", { name: "New" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Do you want to reset the New tags?");
    await dialog.getByRole("button", { name: "No" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(pills(row).filter({ hasText: /^New$/ })).toHaveCount(1);

    await row.getByRole("button", { name: "New" }).click();
    await dialog.getByRole("button", { name: "Yes" }).click();
    await expect(row.getByRole("button", { name: "New" })).toHaveCount(0);
    await expect(pills(row).filter({ hasText: /^New$/ })).toHaveCount(0);
  });
});

test.describe("the Settings page's buttons", () => {
  test.beforeEach(async ({ page }) => {
    await openNotes(page);
    await openSettings(page);
  });

  test("Reset New makes every New note Active", async ({ page }) => {
    await page.getByRole("button", { name: "Reset New (1)" }).click();
    await expect(page.getByRole("status")).toHaveText("1 note changed to Active.");
    await expect(page.getByRole("button", { name: "Reset New (0)" })).toBeVisible();
    await page.getByRole("button", { name: "Reset New (0)" }).click();
    await expect(page.getByRole("status")).toHaveText("There are no New notes.");
  });

  test("Archived to Bin asks first, then moves every archived note to the bin", async ({ page }) => {
    await page.getByRole("button", { name: "Archived to Bin (1)" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Move 1 archived note to the bin?");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("button", { name: "Archived to Bin (1)" })).toBeVisible();

    await page.getByRole("button", { name: "Archived to Bin (1)" }).click();
    await dialog.getByRole("button", { name: "Move to bin" }).click();
    await expect(page.getByRole("status")).toHaveText("1 note moved to the bin.");
    await expect(page.getByRole("button", { name: "Archived to Bin (0)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Empty Bin (2)" })).toBeVisible();
    await page.getByRole("button", { name: "Archived to Bin (0)" }).click();
    await expect(page.getByRole("status")).toHaveText("There are no archived notes.");
  });

  test("Empty Bin asks first, then deletes every note in the bin", async ({ page }) => {
    await page.getByRole("button", { name: "Empty Bin (1)" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Permanently delete 1 note in the bin?");
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("status")).toHaveText("1 note permanently deleted.");
    await expect(page.getByRole("button", { name: "Empty Bin (0)" })).toBeVisible();
    await page.getByRole("button", { name: "Empty Bin (0)" }).click();
    await expect(page.getByRole("status")).toHaveText("The bin is empty.");

    // Gone for good: not even a Bin tab or filter would show it.
    const response = await page.request.get("/api/notes");
    const data = (await response.json()) as { notes: { titleText?: string }[] };
    expect(data.notes.map((note) => note.titleText)).not.toContain("Broken lamp");
  });
});
