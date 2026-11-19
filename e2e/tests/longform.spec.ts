import type { Page } from "@playwright/test";
import { addArea, expect, noteRow, openNotes, pills, selectTab, test } from "./fixtures";

const editor = (page: Page) => page.getByRole("dialog", { name: "Long-form note" });

/** The note with this title, as the server has it. */
async function savedNote(page: Page, title: string) {
  const response = await page.request.get("/api/notes");
  const data = (await response.json()) as { notes: { id: number; titleText?: string; detailsText?: string; parentId?: number }[] };
  return data.notes.find((note) => note.titleText === title);
}

/** Opens a new long-form note (its button is in the expanded add area) and accepts a title. */
async function startLongForm(page: Page, title: string) {
  await page.getByRole("button", { name: "Show all tags" }).click();
  await addArea(page).getByRole("button", { name: "Create long-form note" }).click();
  await expect(editor(page)).toBeVisible();
  await expect(editor(page).getByRole("textbox", { name: "Details" })).toBeDisabled();
  await editor(page).getByRole("textbox", { name: "Long-form note title" }).fill(title);
  await editor(page).getByRole("textbox", { name: "Long-form note title" }).press("Enter");
  await expect(editor(page).getByRole("textbox", { name: "Details" })).toBeFocused();
}

test.describe("with the page loaded", () => {
  test.beforeEach(async ({ page }) => {
    await openNotes(page);
  });

  test("a new long-form note is saved with its title, tags and details", async ({ page }) => {
    await startLongForm(page, "Trip to Rome");
    await editor(page).getByRole("button", { name: /^Area: / }).click();
    await editor(page).getByRole("group", { name: "Area" }).getByRole("button", { name: "Home", exact: true }).click();
    await editor(page).getByRole("textbox", { name: "Details" }).fill("Pack\nBook the hotel");
    await editor(page).getByRole("button", { name: "Finish" }).click();
    await expect(editor(page)).toHaveCount(0);

    await expect(pills(noteRow(page, "Trip to Rome"))).toHaveText(["Home", "New", "Long Form"]);
    expect((await savedNote(page, "Trip to Rome"))?.detailsText).toBe("Pack\nBook the hotel");

    // Opening it again shows the details, and the title is locked until Edit title.
    await noteRow(page, "Trip to Rome").getByRole("button", { name: "Edit note" }).click();
    await expect(editor(page).getByRole("textbox", { name: "Details" })).toHaveValue("Pack\nBook the hotel");
    await expect(editor(page).getByRole("textbox", { name: "Long-form note title" })).toHaveAttribute("readonly", "");
    await editor(page).getByRole("button", { name: "Edit title" }).click();
    await editor(page).getByRole("textbox", { name: "Long-form note title" }).fill("Trip to Florence");
    // Ctrl+Enter finishes, saving the title too.
    await editor(page).getByRole("textbox", { name: "Long-form note title" }).press("Control+Enter");
    await expect(editor(page)).toHaveCount(0);
    await expect(noteRow(page, "Trip to Florence")).toBeVisible();
  });

  test("Cancel deletes a new note, asking first if it has details", async ({ page }) => {
    await startLongForm(page, "Nothing yet");
    await editor(page).getByRole("button", { name: "Cancel" }).click();
    await expect(editor(page)).toHaveCount(0);
    await expect(noteRow(page, "Nothing yet")).toHaveCount(0);

    await page.getByRole("button", { name: "Show tag dropdowns" }).click();
    await startLongForm(page, "Some details");
    await editor(page).getByRole("textbox", { name: "Details" }).fill("Written");
    await editor(page).getByRole("button", { name: "Cancel" }).click();
    const dialog = page.locator("dialog.confirm-dialog");
    await expect(dialog).toContainText("Are you sure you want to delete this note?");
    await dialog.getByRole("button", { name: "No" }).click();
    await expect(editor(page)).toBeVisible();
    await editor(page).getByRole("button", { name: "Cancel" }).click();
    await dialog.getByRole("button", { name: "Yes" }).click();
    await expect(editor(page)).toHaveCount(0);
    await expect(noteRow(page, "Some details")).toHaveCount(0);
    expect(await savedNote(page, "Some details")).toBeUndefined();
  });

  test("notes added while a long-form note is open are its children", async ({ page }) => {
    await noteRow(page, /^Holiday plans/).getByRole("button", { name: "Edit note" }).click();
    await expect(editor(page).getByRole("textbox", { name: "Details" })).toHaveValue("Flights\nHotel");
    const title = page.getByRole("textbox", { name: "New note" });
    await title.fill("Book the hotel");
    await title.press("Enter");
    await expect(title).toHaveValue("");
    await editor(page).getByRole("button", { name: "Finish" }).click();

    // A child shows its parent's title as a pill, like the seed's "Book flights".
    await expect(pills(noteRow(page, "Book the hotel"))).toContainText(["Holiday plans"]);
    await expect(pills(noteRow(page, "Book flights"))).toContainText(["Holiday plans"]);
    const parent = await savedNote(page, "Holiday plans");
    expect((await savedNote(page, "Book the hotel"))?.parentId).toBe(parent?.id);
  });

  test("a typed note can be converted to a long-form note", async ({ page }) => {
    await noteRow(page, "Garden ideas").getByRole("button", { name: "Edit note" }).click();
    await page.getByRole("button", { name: "Show all tags" }).click();
    await addArea(page).getByRole("button", { name: "Convert to long-form note" }).click();
    // It opens with the title accepted, ready for the details.
    await expect(editor(page).getByRole("textbox", { name: "Long-form note title" })).toHaveValue("Garden ideas");
    await expect(editor(page).getByRole("textbox", { name: "Details" })).toBeFocused();
    await page.keyboard.type("Plant tulips");
    await editor(page).getByRole("button", { name: "Finish" }).click();

    await expect(pills(noteRow(page, "Garden ideas"))).toHaveText(["Home", "Ideas", "Long Form"]);
    expect((await savedNote(page, "Garden ideas"))?.detailsText).toBe("Plant tulips");
  });

  test("a handwritten or child note can't be converted", async ({ page }) => {
    await page.getByRole("button", { name: "Show all tags" }).click();
    await noteRow(page, "Book flights").getByRole("button", { name: "Edit note" }).click();
    await expect(addArea(page).getByRole("button", { name: "Convert to long-form note" })).toBeDisabled();
    await addArea(page).getByRole("button", { name: "Cancel" }).click();
    await page.locator(".note-list li[data-note-id]").filter({ has: page.getByRole("img", { name: "Handwritten note" }) }).getByRole("button", { name: "Edit note" }).click();
    await expect(addArea(page).getByRole("button", { name: "Convert to long-form note" })).toBeDisabled();
  });

  test("the match-the-tab button sets the tags the tab fixes", async ({ page }) => {
    await startLongForm(page, "Unmatched");
    await expect(editor(page).getByRole("button", { name: "Choose a tab to match its tags" })).toBeDisabled();
    await editor(page).getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("button", { name: "Show tag dropdowns" }).click();
    await selectTab(page, "Work");
    await startLongForm(page, "Matched");
    await expect(editor(page).getByRole("button", { name: "Area: no tag" })).toBeVisible();
    await editor(page).getByRole("button", { name: 'Set the tags to match the "Work" tab' }).click();
    await expect(editor(page).getByRole("button", { name: "Area: Work" })).toBeVisible();
    await editor(page).getByRole("button", { name: "Finish" }).click();
    await expect(noteRow(page, "Matched")).toBeVisible();
  });

  test("the formatted details line up exactly with the text being typed", async ({ page }) => {
    await startLongForm(page, "Formatting");
    const details = editor(page).getByRole("textbox", { name: "Details" });
    await details.fill("Some *bold* and _under_ and /slanted/ words\nA second line");
    const display = editor(page).locator(".lf-text-display");
    // The markers stay, dimmed, so every letter is where it is in the text box.
    await expect(display).toHaveText("Some *bold* and _under_ and /slanted/ words\nA second line");
    await expect(display.locator(".fmt-marker")).toHaveCount(6);
    await expect(details).toHaveCSS("color", "rgba(0, 0, 0, 0)");

    const layout = await page.evaluate(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>(".lf-text textarea")!;
      const layer = document.querySelector<HTMLElement>(".lf-text-display")!;
      // The first line as shown (formatted) and as plain text in the text box's font.
      const range = document.createRange();
      range.setStart(layer, 0);
      const firstLineEnd = [...layer.childNodes].findIndex((node) => node.textContent === "\n");
      range.setEnd(layer, firstLineEnd);
      const plain = document.createElement("span");
      const style = getComputedStyle(textarea);
      plain.style.font = style.font;
      plain.style.letterSpacing = style.letterSpacing;
      plain.style.whiteSpace = "pre";
      plain.textContent = textarea.value.split("\n")[0]!;
      document.body.append(plain);
      const result = {
        shown: range.getBoundingClientRect().width,
        typed: plain.getBoundingClientRect().width,
        layer: layer.getBoundingClientRect().toJSON() as DOMRect,
        box: textarea.getBoundingClientRect().toJSON() as DOMRect,
      };
      plain.remove();
      return result;
    });
    expect(Math.abs(layout.shown - layout.typed)).toBeLessThan(1);
    expect(layout.layer).toEqual(layout.box);
  });
});

test("with a typed long-form note open, the add area can still be collapsed and expanded", async ({ page }) => {
  await openNotes(page);
  await startLongForm(page, "Toggle while open");
  const toggle = page.getByRole("button", { name: "Show tag dropdowns" });
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(addArea(page)).not.toHaveClass(/\bfull\b/);
  await page.getByRole("button", { name: "Show all tags" }).click();
  await expect(addArea(page)).toHaveClass(/\bfull\b/);
});

test("details are saved by themselves after 30 seconds", async ({ page }) => {
  await page.clock.install();
  await openNotes(page);
  await startLongForm(page, "Autosaved");
  await editor(page).getByRole("textbox", { name: "Details" }).fill("Saved without Finish");
  await page.clock.runFor(25_000);
  expect((await savedNote(page, "Autosaved"))?.detailsText).toBe("");

  const saved = page.waitForResponse((response) => response.request().method() === "PUT" && /\/api\/notes\/\d+$/.test(response.url()));
  await page.clock.runFor(6_000);
  await saved;
  expect((await savedNote(page, "Autosaved"))?.detailsText).toBe("Saved without Finish");
  await expect(editor(page)).toBeVisible();
});
