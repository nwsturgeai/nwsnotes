import { request as newRequest, type APIRequestContext, type Page } from "@playwright/test";
import { addArea, expect, noteRow, noteTitles, openNotes, pills, selectTab, shareTag, test } from "./fixtures";

/*
 * Parent notes: any note, long-form ones included, can go inside a long-form note, making a tree. The
 * seed's "Holiday plans" (note 7, Home) is long-form, with "Book flights" (8, Home) inside it.
 */

const HOLIDAY_PLANS = 7;
const BOOK_FLIGHTS = 8;
const HOME = 2;
const WORK = 1;

interface ApiNote {
  id: number;
  titleText?: string;
  tagIds: number[];
  parentId?: number;
  detailsText?: string;
}

const editor = (page: Page) => page.getByRole("dialog", { name: "Long-form note" });
const parentDialog = (page: Page) => page.getByRole("dialog", { name: "Parent note" });
const longFormFilter = (page: Page) => page.getByRole("group", { name: "Long-form", exact: true });

async function notesOf(request: APIRequestContext): Promise<ApiNote[]> {
  return ((await (await request.get("/api/notes")).json()) as { notes: ApiNote[] }).notes;
}

async function savedNote(request: APIRequestContext, title: string): Promise<ApiNote | undefined> {
  return (await notesOf(request)).find((note) => note.titleText === title);
}

/** Adds a note through the API: long-form with `long`, inside `parentId` if given. */
async function addNote(request: APIRequestContext, title: string, options: { long?: boolean; parentId?: number; tagIds?: number[] } = {}) {
  const response = await request.post("/api/notes", {
    data: { titleText: title, tagIds: options.tagIds ?? [HOME], ...(options.long && { detailsText: "" }), ...(options.parentId && { parentId: options.parentId }) },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as ApiNote;
}

/** Edits a note through the API, keeping its title, tags and details. */
function editNote(request: APIRequestContext, note: ApiNote, change: Record<string, unknown>) {
  return request.put(`/api/notes/${note.id}`, {
    data: { titleText: note.titleText, tagIds: note.tagIds, ...(note.detailsText !== undefined && { detailsText: note.detailsText }), ...change },
  });
}

/** Opens the Parent pop-up from the expanded add area, ticks `title` (or unticks everything), and sets it. */
async function chooseParent(page: Page, title: string | undefined) {
  await addArea(page).getByRole("button", { name: /^Parent: / }).click();
  const dialog = parentDialog(page);
  if (title) await dialog.getByRole("checkbox", { name: title, exact: true }).check();
  else for (const box of await dialog.getByRole("checkbox", { checked: true }).all()) await box.uncheck();
  await dialog.getByRole("button", { name: "Set Parent" }).click();
  await expect(dialog).toHaveCount(0);
}

test("a long-form note can go inside another, and long-form notes show how many notes are inside them", async ({ page }) => {
  const flights = await addNote(page.request, "Flight options", { long: true, parentId: HOLIDAY_PLANS });
  await addNote(page.request, "Compare prices", { parentId: flights.id });
  // In the Bin: not counted.
  const old = await addNote(page.request, "Old idea", { parentId: HOLIDAY_PLANS });
  await page.request.put(`/api/notes/${old.id}/lifetime`, { data: { lifetime: "Bin" } });
  // Not shown in the Home tab.
  await addNote(page.request, "Ask for leave", { parentId: HOLIDAY_PLANS, tagIds: [WORK] });
  await openNotes(page);

  // "Long Form", then the parent, then the child count (direct children only).
  await expect(pills(noteRow(page, /^Holiday plans/))).toHaveText(["Home", "Long Form", "3"]);
  await expect(pills(noteRow(page, /^Flight options/))).toHaveText(["Home", "New", "Long Form", "Holiday plans", "1"]);
  await expect(pills(noteRow(page, "Compare prices"))).toHaveText(["Home", "New", "Flight options"]);
  // The parent's pill isn't the colour of "Long Form".
  const colour = (text: string) => pills(noteRow(page, /^Flight options/)).filter({ hasText: text }).evaluate((li) => getComputedStyle(li).backgroundColor);
  expect(await colour("Holiday plans")).not.toBe(await colour("Long Form"));
  await expect(noteRow(page, /^Holiday plans/).locator("li.children svg")).toHaveCount(1);

  // In a tab that doesn't show all of them: how many it shows, of how many.
  await selectTab(page, "Home");
  await expect(pills(noteRow(page, /^Holiday plans/))).toHaveText(["Long Form", "2 of 3"]);
});

test("the Long-form filter lists the tab's long-form notes as a tree, and shows a ticked note with everything inside it", async ({ page }) => {
  const flights = await addNote(page.request, "Flight options", { long: true, parentId: HOLIDAY_PLANS });
  await addNote(page.request, "Compare prices", { parentId: flights.id });
  await openNotes(page);

  // Just before Properties.
  const buttons = await page.locator(".filter-row .tag-dropdown-button").allTextContents();
  expect(buttons.indexOf("Long-form")).toBe(buttons.indexOf("Properties") - 1);

  await page.getByRole("button", { name: /^Long-form: / }).click();
  const list = longFormFilter(page);
  await expect(list.locator("label")).toHaveText(["Holiday plans(4)", "Flight options(2)"]);
  // The child is indented under its parent.
  const indent = async (name: string) => list.locator("label").filter({ hasText: name }).evaluate((label) => parseFloat(getComputedStyle(label).paddingLeft));
  expect(await indent("Flight options")).toBeGreaterThan(await indent("Holiday plans"));

  // Ticking the parent ticks (and locks) the long-form note inside it, and lists the whole tree.
  await list.getByRole("checkbox", { name: /^Holiday plans/ }).check();
  await expect(list.getByRole("checkbox", { name: /^Flight options/ })).toBeChecked();
  await expect(list.getByRole("checkbox", { name: /^Flight options/ })).toBeDisabled();
  expect(await noteTitles(page)).toEqual(["Holiday plans", "Book flights", "Flight options", "Compare prices"]);

  // Unticking it unticks them both.
  await list.getByRole("checkbox", { name: /^Holiday plans/ }).uncheck();
  await expect(list.getByRole("checkbox", { name: /^Flight options/ })).not.toBeChecked();
  await expect(list.getByRole("checkbox", { name: /^Flight options/ })).toBeEnabled();

  // Ticking only the child lists its own tree; ticking the parent as well, then unticking it, unticks the child too.
  await list.getByRole("checkbox", { name: /^Flight options/ }).check();
  expect(await noteTitles(page)).toEqual(["Flight options", "Compare prices"]);
  await list.getByRole("checkbox", { name: /^Holiday plans/ }).check();
  await list.getByRole("checkbox", { name: /^Holiday plans/ }).uncheck();
  await expect(list.getByRole("checkbox", { name: /^Flight options/ })).not.toBeChecked();

  // Remembered for the tab, like the other filters.
  await list.getByRole("checkbox", { name: /^Flight options/ }).check();
  await page.reload();
  await expect(noteRow(page, "Compare prices")).toBeVisible();
  expect(await noteTitles(page)).toEqual(["Flight options", "Compare prices"]);
  await page.getByRole("button", { name: "Reset filters" }).click();
  await expect(noteRow(page, "Buy milk")).toBeVisible();

  // A tab with no long-form notes has no Long-form dropdown.
  await selectTab(page, "Work");
  await expect(page.getByRole("button", { name: /^Long-form: / })).toHaveCount(0);
});

test("tapping a long-form note's child count shows it with the notes inside it", async ({ page }) => {
  await openNotes(page);
  await noteRow(page, /^Holiday plans/).locator("li.children").getByRole("button").click();
  expect(await noteTitles(page)).toEqual(["Holiday plans", "Book flights"]);
  await expect(page.getByRole("button", { name: /^Long-form: Holiday plans/ })).toBeVisible();
});

test("the Parent line sets, changes and clears the parent of notes being added and edited", async ({ page }) => {
  await openNotes(page);
  await page.getByRole("button", { name: "Show all tags" }).click();
  await expect(addArea(page).getByRole("button", { name: /^Parent: / })).toHaveText("(none)");

  // A new note goes inside the chosen parent, and so does the next one.
  await chooseParent(page, "Holiday plans");
  await expect(addArea(page).getByRole("button", { name: /^Parent: / })).toHaveText("Holiday plans");
  const box = page.getByRole("textbox", { name: "New note" });
  await box.fill("Pack bags");
  await box.press("Enter");
  await expect(pills(noteRow(page, "Pack bags"))).toHaveText(["New", "Holiday plans"]);
  expect((await savedNote(page.request, "Pack bags"))?.parentId).toBe(HOLIDAY_PLANS);
  await chooseParent(page, undefined);
  await box.fill("Unrelated");
  await box.press("Enter");
  expect((await savedNote(page.request, "Unrelated"))?.parentId).toBeUndefined();

  // Editing: the pill starts on the note's parent; Update saves a new one, or none.
  await noteRow(page, "Garden ideas").getByRole("button", { name: "Edit note" }).click();
  await expect(addArea(page).getByRole("button", { name: /^Parent: / })).toHaveText("(none)");
  await chooseParent(page, "Holiday plans");
  await addArea(page).getByRole("button", { name: "Update" }).click();
  await expect(pills(noteRow(page, "Garden ideas"))).toHaveText(["Home", "Ideas", "Holiday plans"]);
  await noteRow(page, "Garden ideas").getByRole("button", { name: "Edit note" }).click();
  await expect(addArea(page).getByRole("button", { name: /^Parent: / })).toHaveText("Holiday plans");
  await chooseParent(page, undefined);
  await addArea(page).getByRole("button", { name: "Update" }).click();
  await expect(pills(noteRow(page, "Garden ideas"))).toHaveText(["Home", "Ideas"]);
  expect((await savedNote(page.request, "Garden ideas"))?.parentId).toBeUndefined();

  // The History says what moved.
  const changes = ((await (await page.request.get("/api/history?limit=3")).json()) as { changes: { summary: string }[] }).changes;
  expect(changes.map((change) => change.summary)).toContain('Took "Garden ideas" out of "Holiday plans"');
});

test("with one long-form note ticked in the filter, new notes start inside it", async ({ page }) => {
  await openNotes(page);
  await page.getByRole("button", { name: /^Long-form: / }).click();
  await longFormFilter(page).getByRole("checkbox", { name: /^Holiday plans/ }).check();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Show all tags" }).click();
  await expect(addArea(page).getByRole("button", { name: /^Parent: / })).toHaveText("Holiday plans");
  const box = page.getByRole("textbox", { name: "New note" });
  await box.fill("Buy sun cream");
  await box.press("Enter");
  // It's inside, so it stays in the list.
  await expect(noteRow(page, "Buy sun cream")).toBeVisible();
  expect((await savedNote(page.request, "Buy sun cream"))?.parentId).toBe(HOLIDAY_PLANS);
});

test("the Parent pop-up can't make a loop, and a long-form note's parent is set in its editor", async ({ page }) => {
  const flights = await addNote(page.request, "Flight options", { long: true, parentId: HOLIDAY_PLANS });
  await openNotes(page);

  // Holiday plans can't go inside itself, nor inside Flight options (which is inside it).
  await noteRow(page, /^Holiday plans/).getByRole("button", { name: "Edit note" }).click();
  await editor(page).getByRole("button", { name: /^Parent: / }).click();
  await expect(parentDialog(page).getByRole("checkbox", { name: "Holiday plans" })).toBeDisabled();
  await expect(parentDialog(page).getByRole("checkbox", { name: "Flight options" })).toBeDisabled();
  await parentDialog(page).getByRole("button", { name: "Cancel" }).click();
  await editor(page).getByRole("button", { name: "Finish" }).click();

  // A new long-form note, put inside Flight options before its title is accepted.
  await page.getByRole("button", { name: "Show all tags" }).click();
  await addArea(page).getByRole("button", { name: "Create long-form note" }).click();
  await editor(page).getByRole("button", { name: /^Parent: / }).click();
  await parentDialog(page).getByRole("checkbox", { name: "Flight options" }).check();
  await parentDialog(page).getByRole("button", { name: "Set Parent" }).click();
  await expect(editor(page).getByRole("button", { name: /^Parent: / })).toHaveText("Flight options");
  await editor(page).getByRole("textbox", { name: "Long-form note title" }).fill("Airlines");
  await editor(page).getByRole("textbox", { name: "Long-form note title" }).press("Enter");
  await editor(page).getByRole("button", { name: "Finish" }).click();
  expect((await savedNote(page.request, "Airlines"))?.parentId).toBe(flights.id);

  // Taking it out again, in the editor.
  await noteRow(page, "Airlines").getByRole("button", { name: "Edit note" }).click();
  await editor(page).getByRole("button", { name: /^Parent: / }).click();
  await parentDialog(page).getByRole("checkbox", { name: "Flight options" }).uncheck();
  await parentDialog(page).getByRole("button", { name: "Set Parent" }).click();
  await expect(editor(page).getByRole("button", { name: /^Parent: / })).toHaveText("(none)");
  await editor(page).getByRole("button", { name: "Finish" }).click();
  await expect.poll(async () => (await savedNote(page.request, "Airlines"))?.parentId).toBeUndefined();
});

test("a child note can become a long-form note, keeping its parent", async ({ page }) => {
  await openNotes(page);
  await page.getByRole("button", { name: "Show all tags" }).click();
  await noteRow(page, "Book flights").getByRole("button", { name: "Edit note" }).click();
  await addArea(page).getByRole("button", { name: "Convert to long-form note" }).click();
  await editor(page).getByRole("button", { name: "Finish" }).click();
  await expect(pills(noteRow(page, "Book flights"))).toHaveText(["Home", "Long Form", "Holiday plans"]);
  expect((await savedNote(page.request, "Book flights"))?.parentId).toBe(HOLIDAY_PLANS);
});

test("the server refuses loops, and a parent in someone else's notebook", async ({ page, baseURL }) => {
  const admin = page.request;
  const flights = await addNote(admin, "Flight options", { long: true, parentId: HOLIDAY_PLANS });
  const holiday = (await notesOf(admin)).find((note) => note.id === HOLIDAY_PLANS)!;
  // Not inside itself, nor inside a note that's inside it.
  expect((await editNote(admin, holiday, { parentId: HOLIDAY_PLANS })).status()).toBe(400);
  expect((await editNote(admin, holiday, { parentId: flights.id })).status()).toBe(400);
  // Only a long-form note can be a parent.
  expect((await editNote(admin, flights, { parentId: BOOK_FLIGHTS })).status()).toBe(400);
  // Left out, the parent stays; null takes it out.
  expect((await editNote(admin, flights, { titleText: "Flights" })).ok()).toBe(true);
  expect((await savedNote(admin, "Flights"))?.parentId).toBe(HOLIDAY_PLANS);
  expect((await editNote(admin, { ...flights, titleText: "Flights" }, { parentId: null })).ok()).toBe(true);
  expect((await savedNote(admin, "Flights"))?.parentId).toBeUndefined();

  // Sam can see Holiday plans (Home is shared with them), but their own notes can't go inside it.
  const made = await admin.post("/api/users", { data: { displayName: "Sam Smith", loginName: "sam@example.com" } });
  const { password } = (await made.json()) as { password: string };
  const sam = await newRequest.newContext({ baseURL });
  expect((await sam.post("/api/login", { data: { loginName: "sam@example.com", password } })).ok()).toBe(true);
  await shareTag(admin, HOME, [{ loginName: "sam@example.com", permission: "edit" }]);
  const samsLong = await addNote(sam, "Sam's plans", { long: true, tagIds: [] });
  const samsNote = await addNote(sam, "Sam's note", { tagIds: [] });
  expect((await editNote(sam, samsNote, { parentId: HOLIDAY_PLANS })).status()).toBe(400);
  expect((await sam.post("/api/notes", { data: { titleText: "Sneaky", tagIds: [], parentId: HOLIDAY_PLANS } })).status()).toBe(400);
  // Nor can the admin's note go inside Sam's.
  const book = (await notesOf(sam)).find((note) => note.id === BOOK_FLIGHTS)!;
  expect((await editNote(sam, book, { parentId: samsLong.id })).status()).toBe(400);
  await sam.dispose();
});

test("emptying the Bin takes the notes inside a deleted note out of it, and going back puts them back", async ({ page }) => {
  await page.request.put(`/api/notes/${HOLIDAY_PLANS}/lifetime`, { data: { lifetime: "Bin" } });
  const before = ((await (await page.request.get("/api/history?limit=1")).json()) as { changes: { id: number }[] }).changes[0]!;
  expect((await page.request.post("/api/notes/empty-bin")).ok()).toBe(true);
  expect((await savedNote(page.request, "Book flights"))?.parentId).toBeUndefined();
  expect((await page.request.post("/api/history/revert", { data: { toChangeId: before.id } })).ok()).toBe(true);
  expect((await savedNote(page.request, "Book flights"))?.parentId).toBe(HOLIDAY_PLANS);
});

test("the Parent pop-up sorts in note order or alphabetically, with child notes under their parent, and remembers which", async ({ page }) => {
  await addNote(page.request, "Zebra trip", { long: true });
  await addNote(page.request, "Seats", { long: true, parentId: HOLIDAY_PLANS });
  await addNote(page.request, "airlines", { long: true, parentId: HOLIDAY_PLANS });
  await addNote(page.request, "Apple picking", { long: true });
  await openNotes(page);
  await page.getByRole("button", { name: "Show all tags" }).click();
  const titles = () => parentDialog(page).locator(".parent-dialog-list label");

  await addArea(page).getByRole("button", { name: /^Parent: / }).click();
  await expect(parentDialog(page).getByRole("radio", { name: "Note order" })).toBeChecked();
  await expect(titles()).toHaveText(["Holiday plans", "Seats", "airlines", "Zebra trip", "Apple picking"]);

  // Alphabetical (ignoring case): the top-level notes by title, and each one's children by title under it.
  await parentDialog(page).getByRole("radio", { name: "Alphabetical" }).check();
  await expect(titles()).toHaveText(["Apple picking", "Holiday plans", "airlines", "Seats", "Zebra trip"]);
  await parentDialog(page).getByRole("button", { name: "Cancel" }).click();

  // Remembered on this device.
  await page.reload();
  await addArea(page).getByRole("button", { name: /^Parent: / }).click();
  await expect(parentDialog(page).getByRole("radio", { name: "Alphabetical" })).toBeChecked();
  await expect(titles()).toHaveText(["Apple picking", "Holiday plans", "airlines", "Seats", "Zebra trip"]);
});
