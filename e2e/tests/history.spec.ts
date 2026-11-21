import type { Page } from "@playwright/test";
import { expect, expectTitles, noteRow, openNotes, setFilter, test } from "./fixtures";

/** The seed's notes as the All tab lists them. */
const ALL = ["Plan the team meeting", "Buy milk", "Read the quarterly report", "Old invoice", "", "Holiday plans", "Book flights", "Garden ideas"];

async function openHistory(page: Page) {
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(page.getByRole("heading", { name: "History", level: 1 })).toBeVisible();
}

/** The History page's lines, newest first. */
const historyLines = (page: Page) => page.locator(".history-list > li");
const historyLine = (page: Page, summary: string | RegExp) => historyLines(page).filter({ hasText: summary });

/** Goes back to just after the change with this summary, checking the question first. */
async function goBackTo(page: Page, summary: string | RegExp, later: number) {
  await historyLine(page, summary).getByRole("button", { name: "Go back to here" }).click();
  const dialog = page.locator("dialog.confirm-dialog");
  await expect(dialog).toContainText(`This undoes the ${later === 1 ? "1 later change" : `${later} later changes`}. You can undo this too.`);
  await dialog.getByRole("button", { name: "Go back" }).click();
  await expect(page.getByRole("status")).toContainText(`${later === 1 ? "1 change" : `${later} changes`} undone.`);
}

/** Adds a note; `shown` is its title as the list shows it (formatting markers hidden). */
async function addNote(page: Page, title: string, shown = title) {
  const box = page.getByRole("textbox", { name: "New note" });
  await box.fill(title);
  await box.press("Enter");
  await expect(noteRow(page, shown)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await openNotes(page);
});

test("the History page lists the changes, newest first, with what each did", async ({ page }) => {
  await addNote(page, "Call the *bank*", "Call the bank");
  await noteRow(page, "Garden ideas").getByRole("button", { name: "Archive" }).click();
  await expect(noteRow(page, "Garden ideas").getByRole("button", { name: "Move to bin" })).toBeVisible();
  await openHistory(page);

  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(historyLines(page).locator(".history-summary")).toHaveText([
    'Archived "Garden ideas"',
    'Added "Call the bank"',
    "Imported the test data",
  ]);
  // The newest change is how things are now, so it has no button.
  await expect(historyLines(page).first().getByRole("button")).toHaveCount(0);
  await expect(historyLines(page).nth(1).getByRole("button", { name: "Go back to here" })).toBeVisible();
});

test("going back undoes every later change: notes, edits, Lifetime and settings", async ({ page }) => {
  await addNote(page, "Added later");
  await noteRow(page, "Buy milk").getByRole("button", { name: "Edit note" }).click();
  await page.getByRole("textbox", { name: "Note title" }).fill("Buy oat milk");
  await page.getByRole("button", { name: "Update" }).click();
  await expect(noteRow(page, "Buy oat milk")).toBeVisible();
  await noteRow(page, "Old invoice").getByRole("button", { name: "Move to bin" }).click();
  await expect(noteRow(page, "Old invoice")).toHaveCount(0);
  const renamed = await page.request.put("/api/tabs/1", { data: { name: "Office", categories: [{ categoryId: 1, tagIds: [1] }] } });
  expect(renamed.ok()).toBe(true);

  await openHistory(page);
  // Cancelling changes nothing.
  await historyLine(page, "Imported the test data").getByRole("button", { name: "Go back to here" }).click();
  await page.locator("dialog.confirm-dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(historyLines(page)).toHaveCount(5);

  await goBackTo(page, "Imported the test data", 4);
  await expect(historyLines(page).first()).toContainText(/Went back to \d{1,2} \w{3} \d{2}:\d{2} \(4 changes undone\)/);

  await page.getByRole("link", { name: "← Settings" }).click();
  await page.getByRole("link", { name: "← Notes" }).click();
  await expectTitles(page, ALL);
  await expect(page.getByRole("tab", { name: "Work" })).toBeVisible();
  await expect(noteRow(page, "Old invoice").getByRole("button", { name: "Move to bin" })).toBeVisible();
  // The note added later is gone; new notes still get new ids.
  await addNote(page, "After going back");
  const response = await page.request.get("/api/notes");
  const data = (await response.json()) as { notes: { id: number; titleText?: string }[] };
  expect(data.notes.find((note) => note.titleText === "After going back")?.id).toBe(11);
});

test("a bulk change is undone in one step", async ({ page }) => {
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Archived to Bin (1)" }).click();
  await page.locator("dialog.confirm-dialog").getByRole("button", { name: "Move to bin" }).click();
  await page.getByRole("button", { name: "Empty Bin (2)" }).click();
  await page.locator("dialog.confirm-dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("button", { name: "Empty Bin (0)" })).toBeVisible();

  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(historyLines(page).locator(".history-summary")).toHaveText([
    "Emptied the bin (2 notes deleted)",
    "Archived to Bin (1 note moved to the bin)",
    "Imported the test data",
  ]);
  await goBackTo(page, "Archived to Bin", 1);

  // Both notes are back in the bin, with their old ids.
  await page.getByRole("link", { name: "← Settings" }).click();
  await expect(page.getByRole("button", { name: "Empty Bin (2)" })).toBeVisible();
  await page.getByRole("link", { name: "← Notes" }).click();
  await setFilter(page, "Lifetime", "Bin", true);
  await expectTitles(page, ["Old invoice", "Broken lamp"]);
});

test("going back can itself be undone", async ({ page }) => {
  await addNote(page, "Keep me");
  await openHistory(page);
  await goBackTo(page, "Imported the test data", 1);
  await expect(historyLines(page)).toHaveCount(3);

  // Going back to just after the add brings it back.
  await goBackTo(page, 'Added "Keep me"', 1);
  await page.getByRole("link", { name: "← Settings" }).click();
  await page.getByRole("link", { name: "← Notes" }).click();
  await expect(noteRow(page, "Keep me")).toBeVisible();
});

test("a long-form note's autosaves are one change", async ({ page }) => {
  const created = await page.request.post("/api/notes", { data: { titleText: "Diary", tagIds: [], detailsText: "" } });
  const { id } = (await created.json()) as { id: number };
  for (const text of ["Monday", "Monday, Tuesday", "Monday, Tuesday, Wednesday"]) {
    const saved = await page.request.put(`/api/notes/${id}`, { data: { titleText: "Diary", tagIds: [], detailsText: text } });
    expect(saved.ok()).toBe(true);
  }
  await page.reload();
  await openHistory(page);
  await expect(historyLines(page).locator(".history-summary")).toHaveText([
    'Edited long-form note "Diary"',
    'Added long-form note "Diary"',
    "Imported the test data",
  ]);
  // Going back to just after it was added empties its details again.
  await goBackTo(page, 'Added long-form note "Diary"', 1);
  const response = await page.request.get("/api/notes");
  const data = (await response.json()) as { notes: { id: number; detailsText?: string }[] };
  expect(data.notes.find((note) => note.id === id)?.detailsText).toBe("");
});

test("other open pages reload after going back", async ({ page, context }) => {
  await addNote(page, "Seen elsewhere");
  const other = await context.newPage();
  await openNotes(other);
  await expect(noteRow(other, "Seen elsewhere")).toBeVisible();

  await openHistory(page);
  await goBackTo(page, "Imported the test data", 1);
  await expect(noteRow(other, "Seen elsewhere")).toHaveCount(0, { timeout: 10_000 });
});

test("going back undoes a change to the note order", async ({ page }) => {
  const moved = await page.request.put("/api/notes/order", { data: { noteOrder: [9, 1, 2] } });
  expect(moved.ok()).toBe(true);
  await page.reload();
  await expect.poll(async () => (await page.locator(".note-list li[data-note-id] .note-body").first().textContent()) ?? "").toContain("Garden ideas");

  await openHistory(page);
  await expect(historyLines(page).first()).toContainText("Changed the order of the notes");
  await goBackTo(page, "Imported the test data", 1);
  await page.getByRole("link", { name: "← Settings" }).click();
  await page.getByRole("link", { name: "← Notes" }).click();
  await expectTitles(page, ALL);
});

test("only the newest 500 changes are kept, and the oldest of them can still be gone back to", async ({ page }) => {
  // 510 changes: the All tab moved to the left and back.
  for (let i = 0; i < 510; i++) {
    const moved = await page.request.put("/api/tabs/all", { data: { placement: i % 2 === 0 ? "left" : "top" } });
    expect(moved.ok()).toBe(true);
  }
  const changes: { id: number; summary: string }[] = [];
  let before: number | undefined;
  for (;;) {
    const page_ = (await (await page.request.get(`/api/history?limit=200${before ? `&before=${before}` : ""}`)).json()) as {
      changes: { id: number; summary: string }[];
      more: boolean;
    };
    changes.push(...page_.changes);
    if (!page_.more) break;
    before = page_.changes.at(-1)!.id;
  }
  expect(changes).toHaveLength(500);
  // The seed's import is long gone; the oldest kept is the 11th move (to the left).
  expect(changes.at(-1)!.summary).toBe("Moved the All tab to the left");

  const back = await page.request.post("/api/history/revert", { data: { toChangeId: changes.at(-1)!.id } });
  expect(back.ok(), await back.text()).toBe(true);
  expect(((await back.json()) as { undone: number }).undone).toBe(499);
  // The 500 kept are now the newest 500, the revert included.
  const after = (await (await page.request.get("/api/history?limit=200")).json()) as { changes: { summary: string }[] };
  expect(after.changes[0]!.summary).toMatch(/^Went back to /);
});
