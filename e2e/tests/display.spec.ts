import type { Page } from "@playwright/test";
import { addArea, expect, filterRow, noteRow, openNotes, setFilter, test } from "./fixtures";

const topTabs = (page: Page) => page.getByRole("tablist", { name: "Tabs", exact: true }).getByRole("tab");

async function openSettings(page: Page) {
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
}

const columnChoice = (page: Page, name: string) => page.getByRole("radiogroup", { name: "Columns" }).getByRole("radio", { name, exact: true });

test.beforeEach(async ({ page }) => {
  await openNotes(page);
});

test("the lines between notes are see-through black, so they show on every tag colour", async ({ page }) => {
  await expect(noteRow(page, "Plan the team meeting")).toHaveCSS("border-bottom-color", "rgba(0, 0, 0, 0.2)");
  await expect(noteRow(page, "Buy milk")).toHaveCSS("border-bottom-color", "rgba(0, 0, 0, 0.2)");
});

test("Columns: Single, Wide, Medium or Narrow, as many as fit in the list (Medium by default)", async ({ page }) => {
  const list = page.locator(".note-list ul").first();
  const listWidth = () => page.locator(".note-list").evaluate((element) => element.clientWidth);

  await openSettings(page);
  await expect(columnChoice(page, "Medium")).toHaveAttribute("aria-checked", "true");
  for (const [name, minWidth] of [
    ["Single", undefined],
    ["Wide", 500],
    ["Medium", 400],
    ["Narrow", 300],
  ] as const) {
    await columnChoice(page, name).click();
    await expect(columnChoice(page, name)).toHaveAttribute("aria-checked", "true");
    await page.getByRole("link", { name: "← Notes" }).click();
    const width = await listWidth();
    const expected = minWidth === undefined ? 1 : Math.max(1, Math.floor(width / minWidth));
    await expect(list).toHaveCSS("column-count", String(expected));
    await openSettings(page);
  }

  // A number saved before keeps its place: 2 is now Wide.
  await page.evaluate(() => localStorage.setItem("nwsnotes.columns", "2"));
  await page.reload();
  await expect(columnChoice(page, "Wide")).toHaveAttribute("aria-checked", "true");
});

test("Columns are worked out again when the list's width changes", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await openSettings(page);
  await columnChoice(page, "Narrow").click();
  await page.getByRole("link", { name: "← Notes" }).click();
  const list = page.locator(".note-list ul").first();
  await expect(list).toHaveCSS("column-count", "3");
  await page.setViewportSize({ width: 620, height: 800 });
  await expect(list).toHaveCSS("column-count", "2");
});

test("tab counts: each tab shows its number of notes, by its own filters only", async ({ page }) => {
  await expect(topTabs(page)).toHaveText(["All", "Work", "Home", "On hold"]);
  await openSettings(page);
  await page.locator("label.switch").filter({ hasText: "Tab counts" }).click();
  await expect(page.getByRole("switch", { name: "Tab counts" })).toBeChecked();
  await page.getByRole("link", { name: "← Notes" }).click();

  // Bin notes don't count (the Broken lamp is in the bin); archived ones do.
  await expect(topTabs(page)).toHaveText(["All (8)", "Work (3)", "Home (5)", "On hold (1)"]);
  for (const tab of await topTabs(page).all()) expect((await tab.boundingBox())!.width).toBeGreaterThanOrEqual(75);

  // The filter row and search don't change them.
  await setFilter(page, "Topic", "Ideas", true);
  await page.keyboard.press("Escape");
  await expect(topTabs(page)).toHaveText(["All (8)", "Work (3)", "Home (5)", "On hold (1)"]);

  // They follow changes to the notes, and are remembered on this device.
  const box = page.getByRole("textbox", { name: "New note" });
  await setFilter(page, "Topic", "Ideas", false);
  await page.keyboard.press("Escape");
  await box.fill("One more");
  await box.press("Enter");
  await expect(topTabs(page).first()).toHaveText("All (9)");
  await page.reload();
  await expect(topTabs(page).first()).toHaveText("All (9)");
});

test("a long tab name is cut short, but its count always shows", async ({ page }) => {
  const renamed = await page.request.put("/api/tabs/1", {
    data: { name: "A very long tab name", categories: [{ categoryId: 1, tagIds: [1] }] },
  });
  expect(renamed.ok()).toBe(true);
  await page.setViewportSize({ width: 420, height: 800 });
  await page.evaluate(() => localStorage.setItem("nwsnotes.tabCounts", "on"));
  await page.reload();
  const tab = topTabs(page).filter({ hasText: "A very long" });
  await expect(tab.locator(".tab-count")).toHaveText(/\(3\)$/);
  await expect(tab.locator(".tab-count")).toBeVisible();
  // The name is cut (it's wider than the room it has), the count isn't.
  expect(await tab.locator(".tab-name-text").evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  const tabBox = (await tab.boundingBox())!;
  const countBox = (await tab.locator(".tab-count").boundingBox())!;
  expect(countBox.x + countBox.width).toBeLessThanOrEqual(tabBox.x + tabBox.width);
});

test("when the filter row wraps, search follows the last dropdown and edit-order stays top-right", async ({ page }) => {
  await page.setViewportSize({ width: 300, height: 800 });
  await page.reload();
  const dropdowns = filterRow(page).locator(".tag-dropdown-button");
  const first = (await dropdowns.first().boundingBox())!;
  const last = (await dropdowns.last().boundingBox())!;
  // The dropdowns take more than one line here.
  expect(last.y).toBeGreaterThan(first.y + 5);

  const search = (await filterRow(page).getByRole("button", { name: "Search" }).boundingBox())!;
  expect(Math.abs(search.y + search.height / 2 - (last.y + last.height / 2))).toBeLessThan(3);
  expect(search.x).toBeGreaterThan(last.x + last.width);

  const editOrder = (await filterRow(page).getByRole("button", { name: "Edit order" }).boundingBox())!;
  const row = (await filterRow(page).boundingBox())!;
  expect(Math.abs(editOrder.y + editOrder.height / 2 - (first.y + first.height / 2))).toBeLessThan(3);
  expect(row.x + row.width - (editOrder.x + editOrder.width)).toBeLessThan(12);
});

test("with the long-form editor open, the whole chevron shows above it", async ({ page }) => {
  await page.getByRole("button", { name: "Show all tags" }).click();
  await addArea(page).getByRole("button", { name: "Create long-form note" }).click();
  await expect(page.getByRole("dialog", { name: "Long-form note" })).toBeVisible();
  const toggle = page.getByRole("button", { name: "Show tag dropdowns" });
  const box = (await toggle.boundingBox())!;
  // The top half of the round button, which is over the editor, is the button itself.
  const onTop = await page.evaluate(
    ({ x, y }) => (document.elementFromPoint(x, y)?.closest(".area-toggle") ?? null) !== null,
    { x: box.x + box.width / 2, y: box.y + 4 },
  );
  expect(onTop).toBe(true);
});
