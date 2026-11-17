import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, expect, type Locator, type Page } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The data every test starts from (e2e/fixtures/seed.json): a save-file's contents. */
export const seed = JSON.parse(readFileSync(path.join(here, "..", "fixtures", "seed.json"), "utf8")) as unknown;

/** The dev password: the test server runs outside production, so it's the same as with `npm run dev`. */
export const PASSWORD = "dev";

/** Puts the test server's data back to the seed. */
export async function resetData(page: Page) {
  const response = await page.request.post("/api/test/reset", { data: seed });
  expect(response.ok(), "the test server's reset endpoint").toBe(true);
}

/** The tests' `test`: every test starts from the seed data, so tests don't depend on each other. */
export const test = base.extend<{ resetBeforeEach: void }>({
  resetBeforeEach: [
    async ({ page }, use) => {
      await resetData(page);
      await use();
    },
    { auto: true },
  ],
});

export { expect };

/** Opens the notes page and waits for the list. */
export async function openNotes(page: Page, address = "/") {
  await page.goto(address);
  await expect(page.locator(".note-list li[data-note-id]").first()).toBeVisible();
}

/** The note in the list whose title contains `text`. */
export function noteRow(page: Page, text: string | RegExp): Locator {
  return page.locator(".note-list li[data-note-id]").filter({ hasText: text });
}

/** The titles of the typed notes in the list, top to bottom (handwritten ones are ""). */
export async function noteTitles(page: Page): Promise<string[]> {
  return page.locator(".note-list li[data-note-id] .note-body").evaluateAll((bodies) =>
    bodies.map((body) => {
      // The title is everything in the note's body apart from its pills.
      const copy = body.cloneNode(true) as Element;
      copy.querySelectorAll("ul").forEach((list) => list.remove());
      return (copy.textContent ?? "").trim();
    }),
  );
}

/** Opens a tab by name. */
export async function selectTab(page: Page, name: string) {
  await page.getByRole("tablist", { name: "Tabs" }).getByRole("tab", { name, exact: true }).click();
}

/** The add area at the bottom of the notes page. */
export function addArea(page: Page): Locator {
  return page.locator(".new-note");
}

/** Chooses a tag in one of the add area's single-select dropdowns (e.g. Area: Work). */
export async function chooseTag(page: Page, category: string, tag: string) {
  await addArea(page).getByRole("button", { name: new RegExp(`^${category}: `) }).click();
  await page.getByRole("group", { name: category }).getByRole("button", { name: tag, exact: true }).click();
}

/** Ticks a tag in one of the add area's multi-select dropdowns, then closes the list. */
export async function tickTag(page: Page, category: string, tag: string) {
  await addArea(page).getByRole("button", { name: new RegExp(`^${category}: `) }).click();
  await page.getByRole("group", { name: category }).getByLabel(tag, { exact: true }).check();
  await page.keyboard.press("Escape");
}

/** The filter row above the note list. */
export function filterRow(page: Page): Locator {
  return page.locator(".filter-row");
}

/** Opens one of the filter row's dropdowns, returning its list of tags (check boxes). */
export async function openFilter(page: Page, category: string): Promise<Locator> {
  const list = page.getByRole("group", { name: category, exact: true });
  if (!(await list.isVisible())) await filterRow(page).getByRole("button", { name: new RegExp(`^${category}: `) }).click();
  await expect(list).toBeVisible();
  return list;
}

/** Ticks or unticks a tag in one of the filter row's dropdowns. */
export async function setFilter(page: Page, category: string, tag: string, ticked: boolean) {
  const list = await openFilter(page, category);
  await list.getByRole("checkbox", { name: new RegExp(`^${tag}\\b`) }).setChecked(ticked);
}

/** The notes page's titles of the listed notes, as a retrying check: `await expectTitles(page, [...])`. */
export async function expectTitles(page: Page, titles: string[]) {
  await expect.poll(() => noteTitles(page)).toEqual(titles);
}

/** A note's pills (its tags' names), for example `expect(pills(row)).toHaveText(["Work", "New"])`. */
export function pills(row: Locator): Locator {
  return row.locator(".note-body li");
}
