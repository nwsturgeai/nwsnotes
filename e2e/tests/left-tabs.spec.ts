import type { Page } from "@playwright/test";
import { expect, expectTitles, noteRow, openNotes, test } from "./fixtures";

const topTabs = (page: Page) => page.getByRole("tablist", { name: "Tabs", exact: true }).getByRole("tab");
const leftStrip = (page: Page) => page.getByRole("tablist", { name: "Left tabs" });
const leftTabs = (page: Page) => leftStrip(page).getByRole("tab");

/** The settings page's Tabs section. */
const tabsSection = (page: Page) => page.locator("section").filter({ has: page.getByRole("heading", { name: "Tabs", exact: true }) });

async function openSettings(page: Page) {
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
}

/** Opens a tab's page from Settings, flips its Top / Left switch, and saves. */
async function moveTab(page: Page, name: string) {
  await tabsSection(page).getByRole("link", { name: new RegExp(`^${name}\\b`) }).click();
  // The switch's check box is hidden behind its drawn track, so its label is tapped.
  await page.locator("label.switch").click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await openNotes(page);
});

test("with no tabs set to Left there's no left strip", async ({ page }) => {
  await expect(leftStrip(page)).toHaveCount(0);
  await expect(topTabs(page)).toHaveText(["All", "Work", "Home", "On hold"]);
  // The filter row starts at the screen's edge.
  expect((await page.locator(".filter-row").boundingBox())!.x).toBeLessThan(2);
  // The top tabs start after the top-left corner (the Undo button's place), 40px in.
  expect((await topTabs(page).first().boundingBox())!.x).toBe(40);
});

test("a chevron button at the bottom of the left strip hides it, and floats over the list to show it again, remembered for every tab", async ({ page }) => {
  const hide = page.getByRole("button", { name: "Hide left tabs" });
  const show = page.getByRole("button", { name: "Show left tabs" });
  // No left tabs, no button.
  await expect(hide).toHaveCount(0);
  await expect(show).toHaveCount(0);

  await openSettings(page);
  await moveTab(page, "On hold");
  await page.getByRole("link", { name: "← Notes" }).click();
  await expect(leftStrip(page)).toBeVisible();

  // A chevron pointing left, a 32px square at the bottom of the strip, below its tabs, 4px in from the
  // edge and 4px above the new-note area.
  await expect(hide.locator("svg")).toHaveAttribute("data-icon", "chevron-left");
  const button = (await hide.boundingBox())!;
  const strip = (await leftStrip(page).boundingBox())!;
  const addArea = (await page.locator(".new-note").boundingBox())!;
  expect(button.width).toBe(32);
  expect(button.height).toBe(32);
  expect(button.x).toBe(4);
  expect(button.y).toBeGreaterThanOrEqual(strip.y + strip.height);
  expect(Math.abs(addArea.y - (button.y + button.height) - 4)).toBeLessThan(2);
  // The top tabs line up with the strip.
  expect((await topTabs(page).first().boundingBox())!.x).toBe(39);

  // Hidden: the strip goes, the list uses the full width, the top tabs start 12px in, and the button
  // stays in the same place, over the list, pointing right.
  await hide.click();
  await expect(leftStrip(page)).toHaveCount(0);
  await expect(show.locator("svg")).toHaveAttribute("data-icon", "chevron-right");
  expect((await page.locator(".filter-row").boundingBox())!.x).toBeLessThan(2);
  expect((await topTabs(page).first().boundingBox())!.x).toBe(40);
  expect(await show.boundingBox()).toEqual(button);
  const list = (await page.locator(".note-list").boundingBox())!;
  expect(button.x).toBeGreaterThanOrEqual(list.x);
  expect(button.y + button.height).toBeLessThanOrEqual(list.y + list.height);

  // It stays hidden on other tabs and after a reload.
  await topTabs(page).filter({ hasText: "Work" }).click();
  await expect(leftStrip(page)).toHaveCount(0);
  await page.reload();
  await expect(show).toBeVisible();
  await expect(leftStrip(page)).toHaveCount(0);

  await show.click();
  await expect(leftTabs(page)).toHaveText(["On hold"]);
  await expect(hide).toBeVisible();
});

test("tabs set to Left show in the left strip, in order, and can be chosen there", async ({ page }) => {
  await openSettings(page);
  await moveTab(page, "On hold");
  await moveTab(page, "Work");
  await expect(tabsSection(page).locator("li").filter({ hasText: "Work" }).locator(".category-kind")).toHaveText("left");

  await page.getByRole("link", { name: "← Notes" }).click();
  await expect(topTabs(page)).toHaveText(["All", "Home"]);
  // The usual tab order: Work comes before On hold.
  await expect(leftTabs(page)).toHaveText(["Work", "On hold"]);

  await leftTabs(page).filter({ hasText: "Work" }).click();
  await expect(leftTabs(page).filter({ hasText: "Work" })).toHaveAttribute("aria-selected", "true");
  await expect(topTabs(page).filter({ hasText: "All" })).toHaveAttribute("aria-selected", "false");
  await expectTitles(page, ["Plan the team meeting", "Read the quarterly report", "Old invoice"]);

  // Layout: the strip is narrow, beside the filter row and list, and down to the new-note area.
  const strip = (await leftStrip(page).boundingBox())!;
  const row = (await page.locator(".filter-row").boundingBox())!;
  const addArea = (await page.locator(".new-note").boundingBox())!;
  // 40px, the same as the top bar's height, with the top tabs starting at its dividing line.
  const header = (await page.getByRole("banner").boundingBox())!;
  expect(strip.width).toBe(40);
  expect(header.height).toBe(40);
  const firstTop = (await topTabs(page).first().boundingBox())!;
  expect(firstTop.x).toBe(strip.x + strip.width - 1);
  expect(firstTop.height).toBe(36);
  expect((await leftTabs(page).first().boundingBox())!.width).toBe(36);
  // Nothing to the right of the cog.
  const cog = (await page.getByRole("link", { name: "Settings" }).boundingBox())!;
  expect(cog.x + cog.width).toBe(page.viewportSize()!.width);
  expect(row.x).toBeGreaterThanOrEqual(strip.x + strip.width - 1);
  expect(Math.abs(strip.y - row.y)).toBeLessThan(2);
  const column = (await page.locator(".left-tabs-column").boundingBox())!;
  expect(Math.abs(column.y + column.height - addArea.y)).toBeLessThan(2);

  // The names read from bottom to top: normal text turned 90 degrees to the left.
  const name = leftTabs(page).first().locator(".left-tab-name");
  await expect(name).toHaveCSS("writing-mode", "vertical-rl");
  await expect(name).toHaveCSS("transform", "matrix(-1, 0, 0, -1, 0, 0)");

  // While a note being edited has no title, the left tabs can't be changed either.
  await noteRow(page, "Old invoice").getByRole("button", { name: "Edit note" }).click();
  await expect(page.getByRole("textbox", { name: "Note title" })).toBeFocused();
  await page.getByRole("textbox", { name: "Note title" }).fill("");
  await expect(leftTabs(page).filter({ hasText: "On hold" })).toHaveAttribute("aria-disabled", "true");
});

test("the All tab can be set to Left too, and is first there", async ({ page }) => {
  await openSettings(page);
  await moveTab(page, "Home");
  await tabsSection(page).getByRole("link", { name: /^All\b/ }).click();
  await expect(page.getByRole("heading", { name: "All tab" })).toBeVisible();
  // Only where it shows can change.
  await expect(page.getByLabel("Name")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await page.locator("label.switch").click();
  await page.getByRole("button", { name: "Save" }).click();

  await page.getByRole("link", { name: "← Notes" }).click();
  await expect(leftTabs(page)).toHaveText(["All", "Home"]);
  await expect(topTabs(page)).toHaveText(["Work", "On hold"]);
  await expect(leftTabs(page).filter({ hasText: "All" })).toHaveAttribute("aria-selected", "true");

  // Saved on the server: a reload keeps it.
  await page.reload();
  await expect(leftTabs(page)).toHaveText(["All", "Home"]);
});

test("a long name is cut short on one line", async ({ page }) => {
  // Twenty wide letters: the longest a name can be, and too long for the strip.
  const response = await page.request.put("/api/tabs/1", {
    data: { name: "W".repeat(20), categories: [{ categoryId: 1, tagIds: [1] }], placement: "left" },
  });
  expect(response.ok()).toBe(true);
  await page.reload();
  const tab = leftTabs(page).first();
  const box = (await tab.boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(160);
  expect(box.width).toBeLessThanOrEqual(48);
  // On one line, cut short with "…" rather than wrapping.
  // The name part is what's cut (a tab count, when shown, stays whole).
  const name = tab.locator(".left-tab-name .tab-name-text");
  await expect(name).toHaveCSS("white-space", "nowrap");
  await expect(name).toHaveCSS("text-overflow", "ellipsis");
  expect(await name.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await expect(tab).toHaveAttribute("title", "W".repeat(20));
});

test("going back in the History undoes a change of where a tab shows", async ({ page }) => {
  await openSettings(page);
  await tabsSection(page).getByRole("link", { name: /^All\b/ }).click();
  await page.locator("label.switch").click();
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(page.locator(".history-list .history-summary").first()).toHaveText("Moved the All tab to the left");
  await page.locator(".history-list > li").filter({ hasText: "Imported the test data" }).getByRole("button", { name: "Go back to here" }).click();
  await page.locator("dialog.confirm-dialog").getByRole("button", { name: "Go back" }).click();
  await expect(page.getByRole("status")).toContainText("1 change undone.");

  await page.getByRole("link", { name: "← Settings" }).click();
  await page.getByRole("link", { name: "← Notes" }).click();
  await expect(leftStrip(page)).toHaveCount(0);
  await expect(topTabs(page)).toHaveText(["All", "Work", "Home", "On hold"]);
});
