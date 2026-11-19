import { expect, noteRow, openNotes, test } from "./fixtures";

// Two windows on the same account, as with the app open on the tablet and the PC.

test("a note added or changed in one window appears in the other", async ({ page, context }) => {
  await openNotes(page);
  const other = await context.newPage();
  await openNotes(other);

  const box = page.getByRole("textbox", { name: "New note" });
  await box.fill("From the other window");
  await box.press("Enter");
  await expect(noteRow(other, "From the other window")).toBeVisible({ timeout: 10_000 });

  await noteRow(other, "Plan the team meeting").getByRole("button", { name: "Archive" }).click();
  await expect(noteRow(page, "Plan the team meeting").getByRole("button", { name: "Move to bin" })).toBeVisible({ timeout: 10_000 });
});

test("settings changed in one window appear in the other", async ({ page, context }) => {
  await openNotes(page);
  const other = await context.newPage();
  await openNotes(other);

  await page.getByRole("link", { name: "Settings" }).click();
  await page.locator("section").filter({ hasText: "Tabs" }).getByRole("button", { name: "Move up Home" }).click();
  await expect(other.getByRole("tablist", { name: "Tabs", exact: true }).getByRole("tab")).toHaveText(["All", "Home", "Work", "On hold"], {
    timeout: 10_000,
  });

  await page.getByRole("button", { name: "Empty Bin (1)" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await other.getByRole("link", { name: "Settings" }).click();
  await expect(other.getByRole("button", { name: "Empty Bin (0)" })).toBeVisible({ timeout: 10_000 });
});
