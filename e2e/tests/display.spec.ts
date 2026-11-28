import type { Page } from "@playwright/test";
import { addArea, expect, filterRow, noteRow, openFilter, openNotes, seed, setFilter, test } from "./fixtures";

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

test("the line between columns matches them, in its own gap so tag colours don't hide it", async ({ page }) => {
  const list = page.locator(".note-list ul").first();
  await expect(list).toHaveCSS("column-rule-color", "rgba(0, 0, 0, 0.2)");
  await expect(list).toHaveCSS("column-rule-width", "1px");
  await expect(list).toHaveCSS("column-gap", "1px");
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

test("Columns: the first column is filled to the bottom of the list before notes go into the next", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1000 });
  await openSettings(page);
  await columnChoice(page, "Narrow").click();
  await page.getByRole("link", { name: "← Notes" }).click();
  const list = page.locator(".note-list ul").first();
  await expect(list).toHaveCSS("column-count", "3");
  const columnLefts = () =>
    list.evaluate((ul) => [...new Set([...ul.children].map((li) => Math.round(li.getBoundingClientRect().left)))].length);

  // The few seeded notes all fit down the first column.
  await expect.poll(columnLefts).toBe(1);

  // On a short screen they don't, so they go on into the other columns.
  await page.setViewportSize({ width: 1000, height: 420 });
  await expect.poll(columnLefts).toBeGreaterThan(1);
});

test("Columns: with empty columns to its right, the last column with notes has a line down its right-hand edge", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1000 });
  await openSettings(page);
  await columnChoice(page, "Narrow").click();
  await page.getByRole("link", { name: "← Notes" }).click();
  const list = page.locator(".note-list ul").first();
  await expect(list).toHaveCSS("column-count", "3");

  // The few seeded notes all fit down the first column, so the other two are empty.
  const row = noteRow(page, "Buy milk");
  await expect(row).toHaveAttribute("data-last-column", "");
  const edge = await row.evaluate((li) => {
    const after = getComputedStyle(li, "::after");
    return { colour: after.backgroundColor, width: after.width, right: after.right };
  });
  expect(edge).toEqual({ colour: "rgba(0, 0, 0, 0.2)", width: "1px", right: "-1px" });

  // In one column there's no line beside the notes.
  await openSettings(page);
  await columnChoice(page, "Single").click();
  await page.getByRole("link", { name: "← Notes" }).click();
  await expect(list).toHaveCSS("column-count", "1");
  await expect(row).not.toHaveAttribute("data-last-column");
});

test.describe("expanded add area", () => {
  test.use({ addAreaStartsCollapsed: false });

  test("the pills reach right down to the bottom of the page", async ({ page }) => {
    const gap = await page.evaluate(() => {
      const area = document.querySelector(".new-note.full")!.getBoundingClientRect();
      const pills = document.querySelector(".new-note.full .tag-mixed-picker")!.getBoundingClientRect();
      return area.bottom - pills.bottom;
    });
    expect(gap).toBe(0);
  });

  test("with no categories (a new account), the add area is still the full width, up to 768px", async ({ page }) => {
    const empty = { ...(seed as object), categories: [], tabs: [], notes: [], noteOrder: [], lastNoteId: 0 };
    expect((await page.request.post("/api/test/reset", { data: empty })).ok()).toBe(true);
    const widths = () =>
      page.evaluate(() => {
        const area = document.querySelector(".new-note.full")!;
        const style = getComputedStyle(area);
        const inside = area.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        return { inside, form: document.querySelector(".new-note.full form")!.getBoundingClientRect().width };
      });

    // A phone: the form fills the area.
    await page.setViewportSize({ width: 412, height: 900 });
    await page.goto("/");
    await expect(page.getByText("No notes yet. Add your first one below.")).toBeVisible();
    await expect(page.locator(".new-note.full .tag-pill-picker")).toHaveCount(0);
    let { inside, form } = await widths();
    expect(Math.abs(form - inside)).toBeLessThan(1);

    // A wide window: 768px, as with categories.
    await page.setViewportSize({ width: 1200, height: 900 });
    ({ inside, form } = await widths());
    expect(Math.round(form)).toBe(768);
  });
});

test("on a window wider than 1280px, the settings page keeps the usual background; only the sides are darker", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 800 });
  await openSettings(page);
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(231, 228, 220)");
  // What shows behind the settings page is the app's own background, the same as on a narrower window.
  await expect(page.locator(".settings-page")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.locator(".app")).toHaveCSS("background-color", "rgb(246, 244, 239)");
});

test("tab counts: each tab shows its number of notes, by its own filters only", async ({ page }) => {
  await expect(topTabs(page)).toHaveText(["All", "Work", "Home", "On hold"]);
  await openSettings(page);
  await page.locator("label.switch").filter({ hasText: "Tab counts" }).click();
  await expect(page.getByRole("switch", { name: "Tab counts" })).toBeChecked();
  await page.getByRole("link", { name: "← Notes" }).click();

  // Bin notes don't count (the Broken lamp is in the bin); archived ones do.
  await expect(topTabs(page)).toHaveText(["All (8)", "Work (3)", "Home (5)", "On hold (1)"]);
  // Each tab is as wide as its name and count: neither is cut short.
  for (const tab of await topTabs(page).all()) {
    expect(await tab.locator(".tab-name-text").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  }

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
  await page.evaluate(() => localStorage.setItem("nwsnotes.tabCounts", "on"));
  await page.reload();
  const tab = topTabs(page).filter({ hasText: "A very long" });
  // Selected, it always shows; on a window too narrow for it, it's squeezed rather than moved to the "…" menu.
  await tab.click();
  await page.setViewportSize({ width: 220, height: 800 });
  await expect(tab.locator(".tab-count")).toHaveText(/\(3\)$/);
  await expect(tab.locator(".tab-count")).toBeVisible();
  // The name is cut (it's wider than the room it has), the count isn't.
  expect(await tab.locator(".tab-name-text").evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  const tabBox = (await tab.boundingBox())!;
  const countBox = (await tab.locator(".tab-count").boundingBox())!;
  expect(countBox.x + countBox.width).toBeLessThanOrEqual(tabBox.x + tabBox.width);
});

test("when the filter row wraps, search follows the last dropdown and edit-order stays top-right", async ({ page }) => {
  // Wide enough for search to fit after the last dropdown, beside the collapse chevron and edit-order.
  await page.setViewportSize({ width: 340, height: 800 });
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

test("a filter dropdown near the window's right edge opens further left, as wide as its options need", async ({ page }) => {
  const long = "Somewhere far, far away";
  expect((await page.request.post("/api/categories", { data: { name: "Places", multiSelect: false, tags: [{ name: long }] } })).ok()).toBe(true);
  // Narrow, so the Places dropdown is near the right edge.
  await page.setViewportSize({ width: 340, height: 800 });
  await page.reload();
  const button = (await filterRow(page).getByRole("button", { name: /^Places: / }).boundingBox())!;
  const list = await openFilter(page, "Places");
  const box = (await list.boundingBox())!;
  // Inside the window, with its 8px margin, and moved left of its button to make room.
  expect(box.x + box.width).toBeLessThanOrEqual(340 - 8 + 0.5);
  expect(box.x).toBeLessThan(button.x);
  // The long tag's name isn't wrapped (as it would be if the list were squeezed between its button and the edge).
  const option = list.locator("label", { hasText: long });
  const lineHeight = await option.evaluate((element) => parseFloat(getComputedStyle(element).lineHeight));
  expect((await option.boundingBox())!.height).toBeLessThan(2 * lineHeight);

  // Where it fits, it's still left-aligned with its button.
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 800 });
  const wide = (await filterRow(page).getByRole("button", { name: /^Places: / }).boundingBox())!;
  expect(Math.abs((await (await openFilter(page, "Places")).boundingBox())!.x - wide.x)).toBeLessThan(1);
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

test.describe(() => {
  test.use({ addAreaStartsCollapsed: false });

  test("the add area is expanded by default, showing the tag pills", async ({ page }) => {
    await page.reload();
    await expect(addArea(page)).toHaveClass(/\bfull\b/);
    await expect(page.getByRole("button", { name: "Show tag dropdowns" })).toBeVisible();
    // Collapsing it is remembered on this device.
    await page.getByRole("button", { name: "Show tag dropdowns" }).click();
    await page.reload();
    await expect(addArea(page)).not.toHaveClass(/\bfull\b/);
  });
});

test("on a wide screen the new-note area is at most 768px wide and centred", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  const area = (await page.locator(".new-note").boundingBox())!;
  const form = (await page.locator(".new-note form").boundingBox())!;
  expect(form.width).toBeLessThanOrEqual(768);
  const left = form.x - area.x;
  const right = area.x + area.width - (form.x + form.width);
  expect(Math.abs(left - right)).toBeLessThan(2);
});

