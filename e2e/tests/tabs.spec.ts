import { expect, expectTitles, filterRow, noteRow, openFilter, openNotes, pills, seed, selectTab, setFilter, test } from "./fixtures";

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

test("a tab filtering a multi-select category on one tag leaves just that tag's pill off", async ({ page }) => {
  const data = (await (await page.request.get("/api/notes")).json()) as { categories: { id: number; name: string; tags: { id: number; name: string }[] }[] };
  const topic = data.categories.find((category) => category.name === "Topic")!;
  const tagId = (name: string) => topic.tags.find((tag) => tag.name === name)!.id;
  expect((await page.request.post("/api/notes", { data: { titleText: "Shopping ideas", tagIds: [tagId("Ideas"), tagId("Shopping")] } })).ok()).toBe(true);
  expect((await page.request.post("/api/tabs", { data: { name: "Ideas", categories: [{ categoryId: topic.id, tagIds: [tagId("Ideas")] }] } })).ok()).toBe(true);
  await page.reload();
  await selectTab(page, "Ideas");
  // Every note here has Ideas, so its pill is left off; the note's other Topic tag still shows.
  await expect(pills(noteRow(page, "Garden ideas"))).toHaveText(["Home"]);
  await expect(pills(noteRow(page, "Shopping ideas"))).toHaveText(["Shopping", "New"]);
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
  // Every tag, that is: "(None)" is the opposite, so it stays unticked.
  for (const box of await topic.locator("label:not(.tag-dropdown-none) input").all()) await expect(box).toBeChecked();
  await expect(topic.getByRole("checkbox", { name: /^\(None\)/ })).not.toBeChecked();
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

test('"(None)" lists the notes with none of the category\'s tags, and unticks the others', async ({ page }) => {
  const topic = await openFilter(page, "Topic");
  const none = topic.getByRole("checkbox", { name: /^\(None\)/ });
  const reading = topic.getByRole("checkbox", { name: /^Reading/ });
  // It's after the tags, just above the TOTAL, with its own count.
  await expect(topic.locator("label").last()).toContainText("(None)(5)");
  await reading.check();
  await expectTitles(page, ["Read the quarterly report"]);

  // Ticking (None) unticks the tags.
  await none.check();
  await expect(reading).not.toBeChecked();
  await expectTitles(page, ["Plan the team meeting", "Old invoice", "", "Holiday plans", "Book flights"]);
  await expect(topic).toContainText("TOTAL: 5");
  await expect(filterRow(page)).toHaveClass(/\bfiltered\b/);
  await expect(filterRow(page).getByRole("button", { name: /^Topic: \(None\)/ })).toBeVisible();

  // The other dropdowns count with it.
  await page.keyboard.press("Escape");
  const area = await openFilter(page, "Area");
  await expect(area.getByRole("checkbox", { name: /^Work/ }).locator("..")).toContainText("(2)");
  await expect(area.getByRole("checkbox", { name: /^\(None\)/ }).locator("..")).toContainText("(0)");
  // Lifetime has no (None): every note has one.
  await page.keyboard.press("Escape");
  await expect((await openFilter(page, "Lifetime")).getByRole("checkbox", { name: /^\(None\)/ })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Ticking a tag unticks (None); so does "select all".
  const topicAgain = await openFilter(page, "Topic");
  await topicAgain.getByRole("checkbox", { name: /^Ideas/ }).check();
  await expect(topicAgain.getByRole("checkbox", { name: /^\(None\)/ })).not.toBeChecked();
  await expectTitles(page, ["Garden ideas"]);
  await topicAgain.getByRole("checkbox", { name: /^\(None\)/ }).check();
  await topicAgain.getByRole("button", { name: "select all" }).click();
  await expect(topicAgain.getByRole("checkbox", { name: /^\(None\)/ })).not.toBeChecked();
  await expectTitles(page, ["Buy milk", "Read the quarterly report", "Garden ideas"]);

  // It's remembered, like the other filters, and Reset filters clears it.
  await topicAgain.getByRole("checkbox", { name: /^\(None\)/ }).check();
  await page.reload();
  await expectTitles(page, ["Plan the team meeting", "Old invoice", "", "Holiday plans", "Book flights"]);
  await filterRow(page).getByRole("button", { name: "Reset filters" }).click();
  await expectTitles(page, ALL);
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

test('the filter row\'s "Properties" dropdown filters by long-form and due dates, with counts', async ({ page }) => {
  // A fixed time (midday in London), and the seed with three due dates: one passed, one later today, one tomorrow.
  await page.clock.install({ time: new Date("2026-11-23T12:00:00Z") });
  const data = structuredClone(seed) as { notes: { id: number; dueDateTime?: string }[] };
  const dueDates: Record<number, string> = { 1: "2026-11-23T10:00:00.000Z", 2: "2026-11-23T20:00:00.000Z", 9: "2026-11-24T10:00:00.000Z" };
  for (const note of data.notes) if (dueDates[note.id]) note.dueDateTime = dueDates[note.id];
  expect((await page.request.post("/api/test/reset", { data })).ok()).toBe(true);
  await openNotes(page);

  const properties = await openFilter(page, "Properties");
  for (const [rule, count] of [["Long-form", 1], ["Due date set", 3], ["Due today", 2], ["Overdue", 1]] as const) {
    await expect(properties.getByRole("checkbox", { name: new RegExp(`^${rule}`) }).locator("..")).toContainText(`(${count})`);
  }
  await expect(properties).toContainText("TOTAL: 8");

  await properties.getByRole("checkbox", { name: /^Due today/ }).check();
  await expectTitles(page, ["Plan the team meeting", "Buy milk"]);
  await expect(filterRow(page)).toHaveClass(/\bfiltered\b/);
  // Like the tag dropdowns, any ticked rule will do.
  await properties.getByRole("checkbox", { name: /^Long-form/ }).check();
  await expectTitles(page, ["Plan the team meeting", "Buy milk", "Holiday plans"]);
  await properties.getByRole("checkbox", { name: /^Long-form/ }).uncheck();
  await properties.getByRole("checkbox", { name: /^Overdue/ }).check();
  await properties.getByRole("checkbox", { name: /^Due today/ }).uncheck();
  await expectTitles(page, ["Plan the team meeting"]);
  await page.keyboard.press("Escape");

  // The tag dropdowns' counts follow it, and its counts follow them.
  const area = await openFilter(page, "Area");
  await expect(area.getByRole("checkbox", { name: /^Work/ }).locator("..")).toContainText("(1)");
  await expect(area.getByRole("checkbox", { name: /^Home/ }).locator("..")).toContainText("(0)");
  await area.getByRole("checkbox", { name: /^Home/ }).check();
  await page.keyboard.press("Escape");
  await expect(page.locator(".note-list")).toContainText("No notes match the Properties filter.");
  const again = await openFilter(page, "Properties");
  await expect(again.getByRole("checkbox", { name: /^Due date set/ }).locator("..")).toContainText("(2)");
  await again.getByRole("checkbox", { name: /^Overdue/ }).uncheck();
  await again.getByRole("checkbox", { name: /^Due today/ }).check();
  await expectTitles(page, ["Buy milk"]);

  // After midnight, tomorrow's note is due today.
  await page.clock.fastForward(13 * 60 * 60 * 1000);
  await expectTitles(page, ["Buy milk", "Garden ideas"]);

  // Remembered with the tab's other filters, and cleared by Reset filters.
  await page.reload();
  await expectTitles(page, ["Buy milk", "Garden ideas"]);
  await filterRow(page).getByRole("button", { name: "Reset filters" }).click();
  await expectTitles(page, ALL);
  await expect(filterRow(page)).not.toHaveClass(/\bfiltered\b/);
});

type SavedCategory = { id: number; name: string; multiSelect: boolean; tags: { id: number; name: string }[] };
type NotesData = { categories: SavedCategory[]; tabs: { name: string; categories: unknown }[] };

test("a single-select category's tags that no tab uses offer \"Create Tab for this Tag\", which saves the category and makes a tab of just that tag", async ({ page }) => {
  const places = (await (await page.request.post("/api/categories", {
    data: { name: "Places", multiSelect: false, tags: [{ name: "Paris" }, { name: "Rome" }] },
  })).json()) as SavedCategory;
  const rome = places.tags.find((tag) => tag.name === "Rome")!;
  // Rome already has a tab of its own; Paris has none.
  expect((await page.request.post("/api/tabs", { data: { name: "Rome trips", categories: [{ categoryId: places.id, tagIds: [rome.id] }] } })).ok()).toBe(true);
  const topics = (await (await page.request.post("/api/categories", {
    data: { name: "Topics", multiSelect: true, tags: [{ name: "Cooking" }] },
  })).json()) as SavedCategory;
  await page.reload();

  const createLink = (name: string) => page.getByRole("button", { name: `Create Tab for ${name}`, exact: true });
  const multiSelect = page.getByLabel("Multi-select: a note can have several tags from this category");

  // A multi-select category offers none.
  await page.goto(`/settings/categories/${topics.id}`);
  await expect(page.getByRole("textbox", { name: "Tag 1" })).toHaveValue("Cooking");
  await expect(createLink("Cooking")).toHaveCount(0);

  await page.goto(`/settings/categories/${places.id}`);
  await expect(page.getByRole("textbox", { name: "Tag 1" })).toHaveValue("Paris");
  await expect(createLink("Rome")).toHaveCount(0);
  await expect(createLink("Paris")).toHaveText("Create Tab for this Tag");
  await expect(createLink("Paris")).toHaveCSS("font-size", "12.8px");

  // Not while Multi-select is ticked.
  await multiSelect.check();
  await expect(createLink("Paris")).toHaveCount(0);
  await multiSelect.uncheck();

  // Unsaved edits: the category's name, a renamed tag and a new one. Creating the tab saves them all first.
  await page.getByLabel("Name", { exact: true }).fill("Cities");
  await page.getByRole("textbox", { name: "Tag 1" }).fill("Paris, France");
  await page.getByRole("button", { name: "Add tag" }).click();
  await page.getByRole("textbox", { name: "Tag 3" }).fill("Lisbon");
  await expect(createLink("Lisbon")).toBeVisible();
  await createLink("Paris, France").click();
  await expect(page.getByRole("status")).toHaveText('Saved the category and made the tab "Paris, France".');
  await expect(createLink("Paris, France")).toHaveCount(0);
  // Still on the page, with the tags as saved.
  await expect(page.getByRole("heading", { name: "Edit category" })).toBeVisible();
  await expect(createLink("Lisbon")).toBeVisible();

  const data = (await (await page.request.get("/api/notes")).json()) as NotesData;
  const cities = data.categories.find((category) => category.id === places.id)!;
  expect(cities.name).toBe("Cities");
  expect(cities.tags.map((tag) => tag.name)).toEqual(["Paris, France", "Rome", "Lisbon"]);
  const paris = cities.tags.find((tag) => tag.name === "Paris, France")!;
  expect(paris.id).toBe(places.tags.find((tag) => tag.name === "Paris")!.id);
  expect(data.tabs.find((tab) => tab.name === "Paris, France")?.categories).toEqual([{ categoryId: places.id, tagIds: [paris.id] }]);

  // A tag that was new a moment ago, now saved, gets its tab too, and saving again doesn't add it twice.
  await createLink("Lisbon").click();
  await expect(page.getByRole("status").filter({ hasText: "Lisbon" })).toHaveText('Saved the category and made the tab "Lisbon".');
  const again = (await (await page.request.get("/api/notes")).json()) as NotesData;
  expect(again.categories.find((category) => category.id === places.id)!.tags.map((tag) => tag.name)).toEqual(["Paris, France", "Rome", "Lisbon"]);

  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("link", { name: "← Notes" }).click();
  const tabStrip = page.getByRole("tablist", { name: "Tabs", exact: true });
  await expect(tabStrip.getByRole("tab", { name: "Paris, France" })).toBeVisible();
  await expect(tabStrip.getByRole("tab", { name: "Lisbon" })).toBeVisible();
});

test("\"Create Tab for this Tag\" says why when the tab can't be made, and then doesn't save the category", async ({ page }) => {
  const places = (await (await page.request.post("/api/categories", {
    data: { name: "Places", multiSelect: false, tags: [{ name: "Work" }] },
  })).json()) as SavedCategory;
  await page.reload();
  await page.goto(`/settings/categories/${places.id}`);
  await page.getByLabel("Name", { exact: true }).fill("Somewhere");
  // The seed already has a tab called "Work".
  await page.getByRole("button", { name: "Create Tab for Work" }).click();
  await expect(page.getByRole("alert")).toHaveText('The tab wasn\'t made: There is already a tab called "Work".');
  await expect(page.getByRole("button", { name: "Create Tab for Work" })).toBeVisible();
  const data = (await (await page.request.get("/api/notes")).json()) as NotesData;
  expect(data.categories.find((category) => category.id === places.id)!.name).toBe("Places");
});

test("\"Create Tab for this Tag\" asks first where Save would, and saves only once it's confirmed", async ({ page }) => {
  // Multi-select, with a note that has both tags: changing it to single-select trims that note.
  const places = (await (await page.request.post("/api/categories", {
    data: { name: "Places", multiSelect: true, tags: [{ name: "Paris" }, { name: "Rome" }] },
  })).json()) as SavedCategory;
  const tagIds = places.tags.map((tag) => tag.id);
  expect((await page.request.post("/api/notes", { data: { titleText: "City break", tagIds } })).ok()).toBe(true);
  await page.reload();
  await page.goto(`/settings/categories/${places.id}`);
  await page.getByLabel("Multi-select: a note can have several tags from this category").uncheck();
  await page.getByRole("button", { name: "Create Tab for Paris", exact: true }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Change to single-select?");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  let data = (await (await page.request.get("/api/notes")).json()) as NotesData;
  expect(data.categories.find((category) => category.id === places.id)!.multiSelect).toBe(true);
  expect(data.tabs.some((tab) => tab.name === "Paris")).toBe(false);

  await page.getByRole("button", { name: "Create Tab for Paris", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Change and save" }).click();
  await expect(page.getByRole("status")).toHaveText('Saved the category and made the tab "Paris".');
  data = (await (await page.request.get("/api/notes")).json()) as NotesData;
  expect(data.categories.find((category) => category.id === places.id)!.multiSelect).toBe(false);
  expect(data.tabs.some((tab) => tab.name === "Paris")).toBe(true);
});

test("a filter row that wraps onto more lines can be collapsed to its first line, remembered for every tab", async ({ page }) => {
  const collapse = filterRow(page).getByRole("button", { name: "Collapse filters to one row" });
  const expand = filterRow(page).getByRole("button", { name: "Show all filters" });
  const search = filterRow(page).getByRole("button", { name: "Search" });
  // Everything fits on one line, so there's nothing to collapse.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(search).toBeVisible();
  await expect(collapse).toHaveCount(0);

  // Narrow enough that the row wraps: the up chevron sits just left of Edit order.
  await page.setViewportSize({ width: 340, height: 800 });
  await expect(collapse).toBeVisible();
  const editOrder = filterRow(page).getByRole("button", { name: "Edit order" });
  const [chevronBox, editBox] = [await collapse.boundingBox(), await editOrder.boundingBox()];
  expect(chevronBox!.x + chevronBox!.width).toBeLessThanOrEqual(editBox!.x);
  expect(Math.abs(chevronBox!.y - editBox!.y)).toBeLessThan(2);
  const tall = (await filterRow(page).boundingBox())!.height;

  // Collapsed: one line, and what was on the later lines is hidden (and out of the Tab order).
  await collapse.click();
  await expect(expand).toBeVisible();
  const short = (await filterRow(page).boundingBox())!.height;
  expect(short).toBeLessThan(tall - 10);
  await expect(filterRow(page).getByRole("button", { name: /^Area: / })).toBeInViewport();
  await expect(search).not.toBeInViewport({ ratio: 0.5 });
  expect(await search.evaluate((button) => button.closest("[inert]") !== null)).toBe(true);

  // The same on other tabs, and after a reload.
  await selectTab(page, "Work");
  await expect(expand).toBeVisible();
  await page.reload();
  await expect(expand).toBeVisible();

  // Expanding shows everything again.
  await expand.click();
  await expect(collapse).toBeVisible();
  await expect(search).toBeInViewport();
  expect(await search.evaluate((button) => button.closest("[inert]") !== null)).toBe(false);
  expect((await filterRow(page).boundingBox())!.height).toBeCloseTo(tall, 0);
});
