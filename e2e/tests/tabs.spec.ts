import { expect, expectTitles, filterRow, noteRow, openFilter, openNotes, pills, selectTab, setFilter, test } from "./fixtures";

/** The seed's notes as the All tab lists them (Bin notes are hidden; the handwritten note has no text). */
const ALL = ["Plan the team meeting", "Buy milk", "Read the quarterly report", "Old invoice", "", "Holiday plans", "Book flights", "Garden ideas"];

test.beforeEach(async ({ page }) => {
  await openNotes(page);
});

test("each tab lists its own notes", async ({ page }) => {
  await expectTitles(page, ALL);
  await selectTab(page, "Work");
  await expect(page.getByRole("tab", { name: "Work" })).toHaveAttribute("aria-selected", "true");
  await expectTitles(page, ["Plan the team meeting", "Read the quarterly report", "Old invoice"]);
  // The tab only shows Work notes, so their Work pill is left off.
  await expect(pills(noteRow(page, "Read the quarterly report"))).toHaveText(["Reading"]);

  await selectTab(page, "Home");
  await expectTitles(page, ["Buy milk", "", "Holiday plans", "Book flights", "Garden ideas"]);
  await selectTab(page, "On hold");
  await expectTitles(page, ["Read the quarterly report"]);
  await selectTab(page, "All");
  await expectTitles(page, ALL);
});

test("the filter row's dropdowns count the notes each tag would list, and the TOTAL", async ({ page }) => {
  const area = await openFilter(page, "Area");
  await expect(area.getByRole("checkbox", { name: /^Work/ }).locator("..")).toContainText("(3)");
  await expect(area.getByRole("checkbox", { name: /^Home/ }).locator("..")).toContainText("(5)");
  await expect(area).toContainText("TOTAL: 8");
  await page.keyboard.press("Escape");

  // Bin notes are hidden, but counted under Bin.
  const lifetime = await openFilter(page, "Lifetime");
  for (const [tag, count] of [["New", 1], ["Active", 5], ["Waiting", 1], ["Archived", 1], ["Bin", 1]] as const) {
    await expect(lifetime.getByRole("checkbox", { name: new RegExp(`^${tag}`) }).locator("..")).toContainText(`(${count})`);
  }
});

test("ticking filters narrows the list, and Reset filters clears them", async ({ page }) => {
  await expect(filterRow(page)).not.toHaveClass(/\bfiltered\b/);
  await setFilter(page, "Area", "Work", true);
  // The row turns bright yellow while it's filtering.
  await expect(filterRow(page)).toHaveClass(/\bfiltered\b/);
  await expect(filterRow(page)).toHaveCSS("background-color", "rgb(255, 233, 77)");
  await expectTitles(page, ["Plan the team meeting", "Read the quarterly report", "Old invoice"]);
  // The other dropdowns' counts follow the filter.
  const topic = await openFilter(page, "Topic");
  await expect(topic.getByRole("checkbox", { name: /^Reading/ }).locator("..")).toContainText("(1)");
  await expect(topic.getByRole("checkbox", { name: /^Shopping/ }).locator("..")).toContainText("(0)");
  await expect(topic).toContainText("TOTAL: 3");
  await page.keyboard.press("Escape");

  await setFilter(page, "Topic", "Shopping", true);
  await expect(page.locator(".note-list")).toContainText("No notes in this tab yet.");

  await filterRow(page).getByRole("button", { name: "Reset filters" }).click();
  await expectTitles(page, ALL);
  await expect(filterRow(page).getByRole("button", { name: "Reset filters" })).toHaveCount(0);
  await expect(filterRow(page)).toHaveCSS("background-color", "rgb(255, 255, 255)");
});

test("a filter dropdown stays open while tags are ticked in it", async ({ page }) => {
  // A short window, so the note list scrolls (it jumps to the bottom when the filters change).
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 520 });
  await page.locator(".note-list").evaluate((list) => (list.scrollTop = 0));
  const area = await openFilter(page, "Area");
  await area.getByRole("checkbox", { name: /^Work/ }).check();
  await expectTitles(page, ["Plan the team meeting", "Read the quarterly report", "Old invoice"]);
  await expect(area).toBeVisible();
  await area.getByRole("checkbox", { name: /^Home/ }).check();
  await expect(area).toBeVisible();
  await area.getByRole("checkbox", { name: /^Work/ }).uncheck();
  await expect(area).toBeVisible();
  await expectTitles(page, ["Buy milk", "", "Holiday plans", "Book flights", "Garden ideas"]);
});

test('"select all" ticks every tag in a filter dropdown', async ({ page }) => {
  const topic = await openFilter(page, "Topic");
  const selectAll = topic.getByRole("button", { name: "select all" });
  await expect(selectAll).toBeEnabled();
  await selectAll.click();
  for (const box of await topic.getByRole("checkbox").all()) await expect(box).toBeChecked();
  // Every tag is ticked now, so the link is greyed out.
  await expect(selectAll).toBeDisabled();
  // Notes with no Topic tag are hidden.
  await expectTitles(page, ["Buy milk", "Read the quarterly report", "Garden ideas"]);
  await expect(filterRow(page)).toHaveClass(/\bfiltered\b/);
  await page.keyboard.press("Escape");

  // For Lifetime, every tag includes Bin, so notes in the bin show too.
  await filterRow(page).getByRole("button", { name: "Reset filters" }).click();
  const lifetime = await openFilter(page, "Lifetime");
  await lifetime.getByRole("button", { name: "select all" }).click();
  await expectTitles(page, [...ALL.slice(0, 4), "Broken lamp", ...ALL.slice(4)]);
});

test("each tab remembers its own filters", async ({ page }) => {
  await setFilter(page, "Topic", "Ideas", true);
  await expectTitles(page, ["Garden ideas"]);
  await selectTab(page, "Work");
  await expectTitles(page, ["Plan the team meeting", "Read the quarterly report", "Old invoice"]);
  await selectTab(page, "All");
  await expectTitles(page, ["Garden ideas"]);
  await page.reload();
  await expectTitles(page, ["Garden ideas"]);
});

test("ticking Bin shows the notes in the bin", async ({ page }) => {
  await setFilter(page, "Lifetime", "Bin", true);
  await expectTitles(page, ["Broken lamp"]);
  await expect(noteRow(page, "Broken lamp").getByRole("button", { name: "Reinstate" })).toBeVisible();
});

test("search narrows the list by title and long-form text", async ({ page }) => {
  await filterRow(page).getByRole("button", { name: "Search" }).click();
  const search = page.getByRole("searchbox", { name: "Search notes" });
  await expect(search).toBeFocused();
  // An empty search doesn't narrow the list, so the row isn't yellow yet.
  await expect(filterRow(page)).not.toHaveClass(/\bfiltered\b/);

  await search.fill("MILK");
  await expectTitles(page, ["Buy milk"]);
  await expect(filterRow(page)).toHaveClass(/\bfiltered\b/);
  // Long-form notes' text is searched too, and every word must match.
  await search.fill("hotel");
  await expectTitles(page, ["Holiday plans"]);
  await search.fill("plan team");
  await expectTitles(page, ["Plan the team meeting"]);
  await search.fill("nothing like this");
  await expect(page.locator(".note-list")).toContainText("No notes match the search.");

  // Escape closes the search and shows every note again.
  await search.press("Escape");
  await expect(search).toHaveCount(0);
  await expect(filterRow(page)).not.toHaveClass(/\bfiltered\b/);
  await expectTitles(page, ALL);
});

test("tabs that don't fit are in the … menu", async ({ page }) => {
  await page.setViewportSize({ width: 240, height: 800 });
  const more = page.getByRole("button", { name: /^\d+ more tabs?$/ });
  await expect(more).toBeVisible();
  await expect(page.getByRole("tab", { name: "On hold" })).toHaveCount(0);

  await more.click();
  await page.getByRole("menuitem", { name: "On hold" }).click();
  // The chosen tab moves into the strip.
  await expect(page.getByRole("tab", { name: "On hold" })).toHaveAttribute("aria-selected", "true");
  await expectTitles(page, ["Read the quarterly report"]);
});

test("tabs can't be changed while a note is being edited", async ({ page }) => {
  await noteRow(page, "Buy milk").getByRole("button", { name: "Edit note" }).click();
  const work = page.getByRole("tab", { name: "Work" });
  await expect(work).toHaveAttribute("aria-disabled", "true");
  // Tapping it does nothing.
  await work.dispatchEvent("click");
  await expect(page.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
  await expectTitles(page, ALL);
});
