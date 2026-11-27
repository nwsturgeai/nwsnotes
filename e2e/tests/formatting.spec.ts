import type { Page } from "@playwright/test";
import { expect, noteRow, noteTitles, openNotes, test } from "./fixtures";

async function addNote(page: Page, title: string) {
  const box = page.getByRole("textbox", { name: "New note" });
  await box.fill(title);
  await box.press("Enter");
  await expect(box).toHaveValue("");
}

test.beforeEach(async ({ page }) => {
  await openNotes(page);
});

test("*bold*, _underline_ and /italic/ are shown formatted, without their markers", async ({ page }) => {
  await addNote(page, "Make *this* _that_ and /other/ *_both_*");
  const row = noteRow(page, "Make this that and other both");
  await expect(row).toBeVisible();
  await expect.poll(async () => (await noteTitles(page)).at(-1)).toBe("Make this that and other both");
  await expect(row.locator(".fmt-bold").first()).toHaveText("this");
  await expect(row.locator(".fmt-underline").first()).toHaveText("that");
  await expect(row.locator(".fmt-italic")).toHaveText("other");
  await expect(row.locator(".fmt-bold.fmt-underline")).toHaveText("both");
  // In the list, bold is the font's real bold, and italic is slanted.
  await expect(row.locator(".fmt-bold").first()).toHaveCSS("font-weight", "700");
  await expect(row.locator(".fmt-italic")).toHaveCSS("font-style", /italic|oblique/);

  // Editing shows the note as it was typed, markers included.
  await row.getByRole("button", { name: "Edit note" }).click();
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Make *this* _that_ and /other/ *_both_*");
});

test("-strikethrough- and #highlight# are shown formatted, without their markers", async ({ page }) => {
  await addNote(page, "Buy -milk- and #eggs# then #-both-#");
  const row = noteRow(page, "Buy milk and eggs then both");
  await expect(row).toBeVisible();
  await expect.poll(async () => (await noteTitles(page)).at(-1)).toBe("Buy milk and eggs then both");
  await expect(row.locator(".fmt-strikethrough").first()).toHaveText("milk");
  await expect(row.locator(".fmt-strikethrough").first()).toHaveCSS("text-decoration-line", "line-through");
  await expect(row.locator(".fmt-highlight").first()).toHaveText("eggs");
  await expect(row.locator(".fmt-highlight").first()).toHaveCSS("background-color", "rgb(255, 255, 0)");
  await expect(row.locator(".fmt-highlight.fmt-strikethrough")).toHaveText("both");
});

test("markers inside words, or without a partner, are left as typed", async ({ page }) => {
  const title = "Cats and/or dogs on 12/11/2026, snake_case_name, 2*3*4, well-known, 10 - 5, C# and *unfinished";
  await addNote(page, title);
  const row = noteRow(page, "Cats and/or dogs");
  await expect(row).toBeVisible();
  await expect.poll(async () => (await noteTitles(page)).at(-1)).toBe(title);
  await expect(row.locator(".fmt-bold, .fmt-underline, .fmt-italic, .fmt-strikethrough, .fmt-highlight")).toHaveCount(0);
});

test("tickboxes are only for long-form details: a title starting [ ] or [x] shows as typed", async ({ page }) => {
  await addNote(page, "[x] Not a tickbox");
  const row = noteRow(page, "[x] Not a tickbox");
  await expect(row).toBeVisible();
  await expect(row.locator(".fmt-tickbox, .fmt-ticked")).toHaveCount(0);
});
