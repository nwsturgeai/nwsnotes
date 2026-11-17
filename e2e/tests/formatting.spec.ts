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

test("markers inside words, or without a partner, are left as typed", async ({ page }) => {
  await addNote(page, "Cats and/or dogs on 12/11/2026, snake_case_name, 2*3*4 and *unfinished");
  const row = noteRow(page, "Cats and/or dogs");
  await expect(row).toBeVisible();
  await expect.poll(async () => (await noteTitles(page)).at(-1)).toBe("Cats and/or dogs on 12/11/2026, snake_case_name, 2*3*4 and *unfinished");
  await expect(row.locator(".fmt-bold, .fmt-underline, .fmt-italic")).toHaveCount(0);
});
