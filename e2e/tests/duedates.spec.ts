import type { Page } from "@playwright/test";
import { addArea, expect, noteRow, openNotes, test } from "./fixtures";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A day `daysAhead` from now in the tests' time zone: as the date box wants it, and as the app shows it. */
function dayFromNow(daysAhead: number) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(Date.now() + daysAhead * DAY_MS))
    .reduce<Record<string, string>>((all, part) => ({ ...all, [part.type]: part.value }), {});
  const thisYear = new Date().getFullYear().toString();
  return {
    input: `${parts.year}-${parts.month}-${parts.day}`,
    shown: `${parts.day}/${parts.month}${parts.year === thisYear ? "" : `/${parts.year!.slice(2)}`}`,
  };
}

/** Sets the due date of the note being added or edited (the button is in the expanded add area). */
async function setDueDate(page: Page, day: string, time: string) {
  await addArea(page).getByRole("button", { name: /^(Set|Change) due date$/ }).click();
  const dialog = page.getByRole("dialog", { name: "Due date" });
  await dialog.getByLabel("Due date").fill(day);
  await dialog.getByLabel("Due time").fill(time);
  await dialog.getByRole("button", { name: "Set Due Date" }).click();
  await expect(dialog).toHaveCount(0);
}

async function addNote(page: Page, title: string) {
  const box = page.getByRole("textbox", { name: "New note" });
  await box.fill(title);
  await box.press("Enter");
  await expect(noteRow(page, title)).toBeVisible();
}

test("a note's due date is shown instead of its created date, and can be changed or cleared", async ({ page }) => {
  await openNotes(page);
  await page.getByRole("button", { name: "Show all tags" }).click();
  const due = dayFromNow(20);
  await setDueDate(page, due.input, "14:30");
  await expect(addArea(page).getByRole("button", { name: "Change due date" })).toBeVisible();
  await addNote(page, "Renew passport");
  const date = noteRow(page, "Renew passport").locator("time");
  await expect(date).toHaveText(`Due ${due.shown} 14:30`);
  // The due date doesn't carry over to the next note.
  await expect(addArea(page).getByRole("button", { name: "Set due date" })).toBeVisible();

  // Editing changes it.
  await noteRow(page, "Renew passport").getByRole("button", { name: "Edit note" }).click();
  await setDueDate(page, due.input, "09:15");
  await addArea(page).getByRole("button", { name: "Update" }).click();
  await expect(date).toHaveText(`Due ${due.shown} 09:15`);

  // Clearing it shows the created date again.
  await noteRow(page, "Renew passport").getByRole("button", { name: "Edit note" }).click();
  await addArea(page).getByRole("button", { name: "Change due date" }).click();
  await page.getByRole("dialog", { name: "Due date" }).getByRole("button", { name: "Clear Due Date" }).click();
  await addArea(page).getByRole("button", { name: "Update" }).click();
  await expect(date).toHaveText(/^Cr\. /);
  await page.reload();
  await expect(noteRow(page, "Renew passport").locator("time")).toHaveText(/^Cr\. /);
});

test("the due-date pop-up needs a date and a time", async ({ page }) => {
  await openNotes(page);
  await page.getByRole("button", { name: "Show all tags" }).click();
  await addArea(page).getByRole("button", { name: "Set due date" }).click();
  const dialog = page.getByRole("dialog", { name: "Due date" });
  await dialog.getByLabel("Due date").fill("");
  await expect(dialog.getByRole("button", { name: "Set Due Date" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(addArea(page).getByRole("button", { name: "Set due date" })).toBeVisible();
});

test("a due date still to come is in the text colour, bold in its last week, and red once it has passed", async ({ page }) => {
  await page.clock.install();
  await openNotes(page);
  await page.getByRole("button", { name: "Show all tags" }).click();
  await setDueDate(page, dayFromNow(10).input, "12:00");
  await addNote(page, "Pay the tax bill");
  const date = noteRow(page, "Pay the tax bill").locator("time");
  // In the text colour (the note's title's), not the grey of a creation date.
  const textColour = await noteRow(page, "Pay the tax bill").getByText("Pay the tax bill").evaluate((e) => getComputedStyle(e).color);
  const greyColour = await noteRow(page, "Buy milk").locator("time").evaluate((e) => getComputedStyle(e).color);
  expect(textColour).not.toBe(greyColour);
  await expect(date).not.toHaveClass(/due-soon|overdue/);
  await expect(date).toHaveCSS("font-weight", "400");
  await expect(date).toHaveCSS("color", textColour);

  // Five days on, it's due within the week: bold, and still in the text colour.
  await page.clock.fastForward(5 * DAY_MS);
  await expect(date).toHaveClass(/\bdue-soon\b/);
  await expect(date).toHaveCSS("font-weight", "700");
  await expect(date).toHaveCSS("color", textColour);

  // Past the due date, it's overdue.
  await page.clock.fastForward(6 * DAY_MS);
  await expect(date).toHaveClass(/\boverdue\b/);
  await expect(date).not.toHaveCSS("color", (await noteRow(page, "Buy milk").locator("time").evaluate((e) => getComputedStyle(e).color)));
});

test("tapping a note's date in the list sets, changes or clears its due date", async ({ page }) => {
  await openNotes(page);
  const row = noteRow(page, "Buy milk");
  const date = row.locator("time");
  await expect(date).toHaveText(/^Cr\. /);

  // A created date: tapping it (the "Cr." too) sets a due date.
  await row.getByText("Cr.").click();
  const dialog = page.getByRole("dialog", { name: "Due date" });
  // No due date yet, so nothing to clear.
  await expect(dialog.getByRole("button", { name: "Clear Due Date" })).toHaveCount(0);
  const due = dayFromNow(12);
  await dialog.getByLabel("Due date").fill(due.input);
  await dialog.getByLabel("Due time").fill("10:45");
  await dialog.getByRole("button", { name: "Set Due Date" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(date).toHaveText(`Due ${due.shown} 10:45`);
  await page.reload();
  await expect(date).toHaveText(`Due ${due.shown} 10:45`);

  // A due date: the pop-up starts from it, and changes it.
  await date.click();
  await expect(dialog.getByLabel("Due time")).toHaveValue("10:45");
  await dialog.getByLabel("Due time").fill("16:00");
  await dialog.getByRole("button", { name: "Set Due Date" }).click();
  await expect(date).toHaveText(`Due ${due.shown} 16:00`);

  // Cancel leaves it as it is.
  await date.click();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(date).toHaveText(`Due ${due.shown} 16:00`);

  // Clearing it shows the created date again, and the note keeps its title and tags.
  const pillsBefore = await row.locator(".pills li").allTextContents();
  await date.click();
  await dialog.getByRole("button", { name: "Clear Due Date" }).click();
  await expect(date).toHaveText(/^Cr\. /);
  await page.reload();
  await expect(date).toHaveText(/^Cr\. /);
  expect(await row.locator(".pills li").allTextContents()).toEqual(pillsBefore);
});

test("tapping the date of the note being edited changes the due date saved with the edit", async ({ page }) => {
  await openNotes(page);
  const row = noteRow(page, "Buy milk");
  await row.getByRole("button", { name: "Edit note" }).click();
  await row.locator("time").click();
  const dialog = page.getByRole("dialog", { name: "Due date" });
  const due = dayFromNow(3);
  await dialog.getByLabel("Due date").fill(due.input);
  await dialog.getByLabel("Due time").fill("08:30");
  await dialog.getByRole("button", { name: "Set Due Date" }).click();
  // Not saved until Update.
  await expect(row.locator("time")).toHaveText(/^Cr\. /);
  await addArea(page).getByRole("button", { name: "Update" }).click();
  await expect(row.locator("time")).toHaveText(`Due ${due.shown} 08:30`);
});

const longFormEditor = (page: Page) => page.getByRole("dialog", { name: "Long-form note" });

/** The note with this title, as the server has it. */
async function savedNote(page: Page, title: string) {
  const data = (await (await page.request.get("/api/notes")).json()) as {
    notes: { titleText?: string; detailsText?: string; dueDateTime?: string }[];
  };
  return data.notes.find((note) => note.titleText === title);
}

/** Fills in and sets the due-date pop-up. */
async function chooseDue(page: Page, day: string, time: string) {
  const dialog = page.getByRole("dialog", { name: "Due date" });
  await dialog.getByLabel("Due date").fill(day);
  await dialog.getByLabel("Due time").fill(time);
  await dialog.getByRole("button", { name: "Set Due Date" }).click();
  await expect(dialog).toHaveCount(0);
}

test("a long-form note's due date is set in its editor, saved straight away, and kept by later saves", async ({ page }) => {
  await openNotes(page);
  await page.getByRole("button", { name: "Show all tags" }).click();
  await addArea(page).getByRole("button", { name: "Create long-form note" }).click();
  const editor = longFormEditor(page);
  const setDue = editor.getByRole("button", { name: "Set the long-form note's due date" });
  const changeDue = editor.getByRole("button", { name: "Change the long-form note's due date" });
  // Greyed out until the title is accepted (the note doesn't exist yet).
  await expect(setDue).toBeDisabled();
  await expect(setDue).toHaveAttribute("title", "Accept the title first");
  await editor.getByRole("textbox", { name: "Long-form note title" }).fill("Garden plan");
  await editor.getByRole("textbox", { name: "Long-form note title" }).press("Enter");
  await expect(setDue).toBeEnabled();
  await expect(setDue).toHaveAttribute("title", "Set due date");

  // With typed details there's no Export: it's just before Cancel and Finish, 24px from Cancel.
  const dueBox = (await setDue.boundingBox())!;
  const cancelBox = (await editor.getByRole("button", { name: "Cancel" }).boundingBox())!;
  expect(Math.round(cancelBox.x - (dueBox.x + dueBox.width))).toBe(24);

  // Saved as soon as it's set, without waiting for the 30-second window or Finish.
  const due = dayFromNow(9);
  await setDue.click();
  await chooseDue(page, due.input, "19:15");
  await expect(changeDue).toHaveAttribute("title", `Due ${due.shown} 19:15`);
  await expect(changeDue).toHaveClass(/primary/);
  await expect.poll(async () => (await savedNote(page, "Garden plan"))?.dueDateTime).toBeTruthy();

  // Writing the details and finishing keeps it.
  await editor.getByRole("textbox", { name: "Details" }).fill("Dig the beds");
  await editor.getByRole("button", { name: "Finish" }).click();
  await expect(editor).toHaveCount(0);
  const row = noteRow(page, "Garden plan");
  await expect(row.locator("time")).toHaveText(`Due ${due.shown} 19:15`);
  expect(await savedNote(page, "Garden plan")).toMatchObject({ detailsText: "Dig the beds" });
  expect((await savedNote(page, "Garden plan"))?.dueDateTime).toBeTruthy();

  // Opening it again starts from it; clearing it is saved too.
  await row.getByRole("button", { name: "Edit note" }).click();
  await changeDue.click();
  await expect(page.getByRole("dialog", { name: "Due date" }).getByLabel("Due time")).toHaveValue("19:15");
  await page.getByRole("dialog", { name: "Due date" }).getByRole("button", { name: "Clear Due Date" }).click();
  await expect(setDue).toBeVisible();
  await expect.poll(async () => (await savedNote(page, "Garden plan"))?.dueDateTime).toBeUndefined();
  await editor.getByRole("button", { name: "Finish" }).click();
  await expect(row.locator("time")).toHaveText(/^Cr\. /);
});

test("tapping a long-form note's date in the list sets its due date, keeping its details", async ({ page }) => {
  await openNotes(page);
  const row = noteRow(page, /^Holiday plans/);
  await row.getByText("Cr.").click();
  const due = dayFromNow(5);
  await chooseDue(page, due.input, "07:30");
  await expect(row.locator("time")).toHaveText(`Due ${due.shown} 07:30`);
  await page.reload();
  await expect(noteRow(page, /^Holiday plans/).locator("time")).toHaveText(`Due ${due.shown} 07:30`);
  expect((await savedNote(page, "Holiday plans"))?.detailsText).toBe("Flights\nHotel");
});

test("converting a note with a due date to long-form keeps the due date", async ({ page }) => {
  await openNotes(page);
  await page.getByRole("button", { name: "Show all tags" }).click();
  await noteRow(page, "Buy milk").getByRole("button", { name: "Edit note" }).click();
  const due = dayFromNow(4);
  await setDueDate(page, due.input, "12:00");
  const convert = addArea(page).getByRole("button", { name: "Convert to long-form note" });
  await expect(convert).toHaveAttribute("title", "Convert to long-form note");
  await convert.click();
  const editor = longFormEditor(page);
  await expect(editor.getByRole("button", { name: "Change the long-form note's due date" })).toHaveAttribute("title", `Due ${due.shown} 12:00`);
  await editor.getByRole("textbox", { name: "Details" }).fill("Semi-skimmed");
  await editor.getByRole("button", { name: "Finish" }).click();
  await expect(noteRow(page, "Buy milk").locator("time")).toHaveText(`Due ${due.shown} 12:00`);
});
