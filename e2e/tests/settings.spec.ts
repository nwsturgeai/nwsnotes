import type { Page } from "@playwright/test";
import { addArea, expect, filterRow, noteRow, openNotes, pills, test } from "./fixtures";

async function openSettings(page: Page) {
  await openNotes(page);
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
}

/** One of the settings page's sections, by its heading. */
function section(page: Page, heading: string) {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: heading, exact: true }) });
}

/** Opens a category's page from the settings page. */
async function editCategory(page: Page, name: string) {
  await section(page, "Categories").getByRole("link", { name: new RegExp(`^${name}\\b`) }).click();
  await expect(page.getByRole("heading", { name: "Edit category" })).toBeVisible();
}

/** The settings page's line for a category, e.g. "Area Work, Home". */
function categoryLine(page: Page, name: string) {
  return section(page, "Categories").getByRole("listitem").filter({ has: page.locator(".category-name", { hasText: new RegExp(`^${name}$`) }) });
}

const tabNames = (page: Page) => page.getByRole("tablist", { name: "Tabs", exact: true }).getByRole("tab");

test.beforeEach(async ({ page }) => {
  await openSettings(page);
});

test.describe("categories", () => {
  test("a new category with its tags", async ({ page }) => {
    await section(page, "Categories").getByRole("link", { name: "Add category" }).click();
    await expect(page.getByRole("heading", { name: "New category" })).toBeVisible();
    await page.getByLabel("Name").fill("Priority");
    await page.getByRole("textbox", { name: "Tag 1" }).fill("High");
    // Enter in a tag box adds another tag.
    await page.getByRole("textbox", { name: "Tag 1" }).press("Enter");
    await expect(page.getByRole("textbox", { name: "Tag 2" })).toBeFocused();
    await page.keyboard.type("Low");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(categoryLine(page, "Priority").locator(".category-tags")).toHaveText("High, Low");
    await page.getByRole("link", { name: "← Notes" }).click();
    await expect(addArea(page).getByRole("button", { name: "Priority: no tag" })).toBeVisible();
  });

  test("a category needs a name", async ({ page }) => {
    await section(page, "Categories").getByRole("link", { name: "Add category" }).click();
    await page.getByRole("textbox", { name: "Tag 1" }).fill("Something");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("heading", { name: "New category" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  });

  test("renaming a category and a tag changes them everywhere", async ({ page }) => {
    await editCategory(page, "Area");
    await page.getByLabel("Name").fill("Place");
    await page.getByRole("textbox", { name: "Tag 1" }).fill("Office");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(categoryLine(page, "Place").locator(".category-tags")).toHaveText("Office, Home");

    await page.getByRole("link", { name: "← Notes" }).click();
    await expect(pills(noteRow(page, "Plan the team meeting"))).toHaveText(["Office"]);
    await expect(filterRow(page).getByRole("button", { name: "Place: no tag" })).toBeVisible();
  });

  test("tags and categories can be put in a different order", async ({ page }) => {
    await editCategory(page, "Topic");
    await page.getByRole("button", { name: "Move down Ideas" }).click();
    // The focus stays on the moved tag's arrow, so it can be pressed again.
    await expect(page.getByRole("button", { name: "Move down Ideas" })).toBeFocused();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(categoryLine(page, "Topic").locator(".category-tags")).toHaveText("Shopping, Ideas, Reading");

    await section(page, "Categories").getByRole("button", { name: "Move down Area" }).click();
    await expect(section(page, "Categories").locator(".category-name")).toHaveText(["Topic", "Area", "Lifetime"]);
    await page.reload();
    await expect(section(page, "Categories").locator(".category-name")).toHaveText(["Topic", "Area", "Lifetime"]);
    await page.getByRole("link", { name: "← Notes" }).click();
    await expect(filterRow(page).locator(".tag-dropdown-button")).toHaveText([/^Topic/, /^Area/, /^Lifetime/]);
  });

  test("a tag's colour tints its notes, and can be taken off", async ({ page }) => {
    await editCategory(page, "Topic");
    await page.getByRole("button", { name: "Colour of Ideas: none" }).click();
    const picker = page.getByRole("dialog", { name: "Colour for Ideas" });
    await expect(picker.getByRole("button", { name: "Set colour" })).toBeDisabled();
    await picker.getByRole("button", { name: "Hue 300°" }).click();
    await picker.getByRole("button", { name: "Set colour" }).click();
    await expect(page.getByRole("button", { name: "Colour of Ideas: hue 300°" })).toBeVisible();

    // Work's colour comes off.
    await page.getByRole("button", { name: "Cancel" }).click();
    await editCategory(page, "Area");
    await page.getByRole("button", { name: "Colour of Work: hue 210°" }).click();
    await page.getByRole("dialog", { name: "Colour for Work" }).getByRole("button", { name: "No colour" }).click();
    await expect(page.getByRole("button", { name: "Colour of Work: none" })).toBeVisible();
    await page.getByRole("button", { name: "Save" }).click();

    await page.getByRole("link", { name: "← Notes" }).click();
    const background = (title: string) => noteRow(page, title).evaluate((row) => (row as HTMLElement).style.background);
    // Work notes are no longer tinted; Home notes still are.
    await expect.poll(() => background("Plan the team meeting")).toBe("");
    await expect.poll(() => background("Buy milk")).not.toBe("");
  });

  test("changing to single-select keeps only each note's first tag, after asking", async ({ page }) => {
    // Garden ideas gets two Topic tags: Ideas and Reading.
    const response = await page.request.put("/api/notes/9", { data: { titleText: "Garden ideas", tagIds: [2, 3, 5] } });
    expect(response.ok()).toBe(true);

    await editCategory(page, "Topic");
    await page.getByRole("checkbox", { name: /^Multi-select/ }).uncheck();
    await expect(page.getByText("Notes with more than one of these tags will keep only the first one in the list below.")).toBeVisible();
    await page.getByRole("button", { name: "Save" }).click();
    const dialog = page.locator("dialog.confirm-dialog");
    await expect(dialog).toContainText(
      "Change to single-select? 1 note with more than one of these tags will keep only the first one in the list.",
    );
    await dialog.getByRole("button", { name: "Change and save" }).click();
    await expect(categoryLine(page, "Topic").locator(".category-kind")).toHaveCount(0);

    await page.getByRole("link", { name: "← Notes" }).click();
    await expect(pills(noteRow(page, "Garden ideas"))).toHaveText(["Home", "Ideas"]);
  });

  test("deleting a tag removes it from its notes, after asking", async ({ page }) => {
    await editCategory(page, "Topic");
    await page.getByRole("button", { name: "Delete tag Shopping" }).click();
    await expect(page.getByRole("textbox", { name: "Tag 2" })).toHaveValue("Reading");
    await page.getByRole("button", { name: "Save" }).click();
    const dialog = page.locator("dialog.confirm-dialog");
    await expect(dialog).toContainText('Delete the tag "Shopping"? It will be removed from 1 note.');
    await dialog.getByRole("button", { name: "Delete and save" }).click();
    await expect(categoryLine(page, "Topic").locator(".category-tags")).toHaveText("Ideas, Reading");

    await page.getByRole("link", { name: "← Notes" }).click();
    await expect(pills(noteRow(page, "Buy milk"))).toHaveText(["Home", "New"]);
  });
});

test.describe("tabs", () => {
  test("a new tab shows the notes with its tags; it can be renamed and deleted", async ({ page }) => {
    await section(page, "Tabs").getByRole("link", { name: "Add tab" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Ideas");
    await page.getByRole("button", { name: "Topic: no tag" }).click();
    await page.getByRole("group", { name: "Topic" }).getByRole("checkbox", { name: /^Ideas/ }).check();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(section(page, "Tabs").locator(".category-name")).toHaveText(["All", "Work", "Home", "On hold", "Ideas"]);

    await page.getByRole("link", { name: "← Notes" }).click();
    await expect(tabNames(page)).toHaveText(["All", "Work", "Home", "On hold", "Ideas"]);
    await page.getByRole("tab", { name: "Ideas" }).click();
    await expect(page.locator(".note-list li[data-note-id]")).toHaveCount(1);
    await expect(noteRow(page, "Garden ideas")).toBeVisible();

    await page.getByRole("link", { name: "Settings" }).click();
    await section(page, "Tabs").getByRole("link", { name: /^Ideas/ }).click();
    await page.getByLabel("Name", { exact: true }).fill("Thoughts");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(section(page, "Tabs").locator(".category-name")).toHaveText(["All", "Work", "Home", "On hold", "Thoughts"]);

    await section(page, "Tabs").getByRole("link", { name: /^Thoughts/ }).click();
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(section(page, "Tabs").locator(".category-name")).toHaveText(["All", "Work", "Home", "On hold"]);
  });

  test("tabs can be put in a different order; All stays first", async ({ page }) => {
    await section(page, "Tabs").getByRole("button", { name: "Move up Home" }).click();
    await expect(section(page, "Tabs").locator(".category-name")).toHaveText(["All", "Home", "Work", "On hold"]);
    await expect(section(page, "Tabs").getByRole("button", { name: "Move up Home" })).toBeDisabled();
    await page.reload();
    await page.getByRole("link", { name: "← Notes" }).click();
    await expect(tabNames(page)).toHaveText(["All", "Home", "Work", "On hold"]);
  });
});

test("the settings sections are in order: Help first, Backup after History, App version before Reminders; Pen only in stylus mode", async ({ page }) => {
  const headings = page.locator(".settings-page h2");
  const rest = ["History", "Backup", "Lifetime", "Categories", "Tabs", "App version", "Reminders", "Text messages", "Users", "Account"];
  await expect(page.getByRole("heading", { name: "Pen" })).toHaveCount(0);
  await expect(headings).toHaveText(["Help", ...rest]);

  await page.locator("label.switch").filter({ hasText: "Stylus mode" }).click();
  await expect(headings).toHaveText(["Help", "Pen", ...rest]);

  await page.locator("label.switch").filter({ hasText: "Stylus mode" }).click();
  await expect(page.getByRole("heading", { name: "Pen" })).toHaveCount(0);
});

test("back from saving or cancelling a tab or a category, the settings page opens at that section", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 500 });
  await page.reload();
  const settings = page.locator("main.settings-page");
  /** How far a section's heading is below the top of the settings page's visible area. */
  const offset = (heading: string) =>
    section(page, heading)
      .getByRole("heading", { name: heading, exact: true })
      .evaluate((h2) => h2.getBoundingClientRect().top - h2.closest("main")!.getBoundingClientRect().top);

  await section(page, "Tabs").getByRole("link", { name: /^Work/ }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await expect.poll(() => offset("Tabs")).toBeLessThan(40);
  await expect.poll(() => offset("Tabs")).toBeGreaterThanOrEqual(0);

  await section(page, "Tabs").getByRole("link", { name: /^Home/ }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect.poll(() => offset("Tabs")).toBeLessThan(40);

  await editCategory(page, "Area");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await expect.poll(() => offset("Categories")).toBeLessThan(40);
  await expect.poll(() => offset("Categories")).toBeGreaterThanOrEqual(0);

  await editCategory(page, "Area");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect.poll(() => offset("Categories")).toBeLessThan(40);

  // Opened any other way, it starts at the top.
  await page.getByRole("link", { name: "← Notes" }).click();
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await expect.poll(() => settings.evaluate((main) => main.scrollTop)).toBe(0);
});

test("stylus mode and columns are remembered on this device", async ({ page }) => {
  await page.getByRole("radiogroup", { name: "Columns" }).getByRole("radio", { name: "Single" }).click();
  await expect(page.getByRole("radiogroup", { name: "Columns" }).getByRole("radio", { name: "Single" })).toHaveAttribute("aria-checked", "true");
  await page.locator("label.switch").filter({ hasText: "Stylus mode" }).click();
  await page.getByRole("link", { name: "← Notes" }).click();
  await expect(page.locator(".note-list ul").first()).toHaveCSS("column-count", "1");
  await expect(page.getByRole("img", { name: "Stylus mode is on" })).toBeVisible();

  await page.reload();
  await expect(page.locator(".note-list ul").first()).toHaveCSS("column-count", "1");
  await expect(addArea(page).getByRole("img", { name: "Writing area for a new note" })).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  await page.locator("label.switch").filter({ hasText: "Stylus mode" }).click();
  await expect(page.getByRole("switch", { name: "Stylus mode" })).not.toBeChecked();
  await page.getByRole("link", { name: "← Notes" }).click();
  await expect(page.getByRole("textbox", { name: "New note" })).toBeVisible();
});

/** Drags a row by its grip to just above another row (the shared drag, as for notes). */
async function dragAbove(page: Page, row: import("@playwright/test").Locator, above: import("@playwright/test").Locator) {
  // In the middle of the screen, so the pointer is on it and not near the edges (which scroll the page).
  await row.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const grip = (await row.getByTitle("Drag to reorder").boundingBox())!;
  const to = (await above.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, to.y + 4, { steps: 10 });
  await page.mouse.up();
}

test.describe("drag-and-drop", () => {
  const tabRow = (page: Page, name: string) =>
    section(page, "Tabs").getByRole("listitem").filter({ has: page.locator(".category-name", { hasText: new RegExp(`^${name}$`) }) });

  test("tabs can be dragged into a new order, saved straight away; All has no grip and stays first", async ({ page }) => {
    await expect(tabRow(page, "All").getByTitle("Drag to reorder")).toHaveCount(0);
    await dragAbove(page, tabRow(page, "On hold"), tabRow(page, "Work"));
    await expect(section(page, "Tabs").locator(".category-name")).toHaveText(["All", "On hold", "Work", "Home"]);
    // Dropping above All still puts it just after All.
    await dragAbove(page, tabRow(page, "Home"), tabRow(page, "All"));
    await expect(section(page, "Tabs").locator(".category-name")).toHaveText(["All", "Home", "On hold", "Work"]);
    await page.reload();
    await expect(section(page, "Tabs").locator(".category-name")).toHaveText(["All", "Home", "On hold", "Work"]);
  });

  test("categories can be dragged into a new order, saved straight away; Lifetime stays last", async ({ page }) => {
    await expect(categoryLine(page, "Lifetime").getByTitle("Drag to reorder")).toHaveCount(0);
    await dragAbove(page, categoryLine(page, "Topic"), categoryLine(page, "Area"));
    await expect(section(page, "Categories").locator(".category-name")).toHaveText(["Topic", "Area", "Lifetime"]);
    await page.reload();
    await expect(section(page, "Categories").locator(".category-name")).toHaveText(["Topic", "Area", "Lifetime"]);
  });

  test("tags can be dragged into a new order, saved only with the category", async ({ page }) => {
    const tagRow = (name: string) => page.locator(".tag-row").filter({ has: page.locator(`input[value="${name}"]`) });
    const tagNames = () => page.locator(".tag-row input[type=text]").evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));

    await editCategory(page, "Topic");
    await dragAbove(page, tagRow("Reading"), tagRow("Ideas"));
    await expect.poll(tagNames).toEqual(["Reading", "Ideas", "Shopping"]);
    // Cancel throws it away.
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(categoryLine(page, "Topic").locator(".category-tags")).toHaveText("Ideas, Shopping, Reading");

    await editCategory(page, "Topic");
    await dragAbove(page, tagRow("Reading"), tagRow("Ideas"));
    await expect.poll(tagNames).toEqual(["Reading", "Ideas", "Shopping"]);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(categoryLine(page, "Topic").locator(".category-tags")).toHaveText("Reading, Ideas, Shopping");
  });
});

test("a user can have at most 20 categories, 40 tags in each and 40 tabs", async ({ page }) => {
  const data = (await (await page.request.get("/api/notes")).json()) as {
    categories: { id: number; system?: boolean; tags: { id: number }[] }[];
    tabs: unknown[];
  };
  const categoryCount = data.categories.filter((category) => !category.system).length;
  const tabCount = data.tabs.length;
  const addCategory = (name: string, tagCount = 1) =>
    page.request.post("/api/categories", {
      data: { name, multiSelect: true, tags: Array.from({ length: tagCount }, (_, i) => ({ name: `${name} tag ${i + 1}` })) },
    });

  // 40 tags in a category, but not 41.
  const tooMany = await addCategory("Big", 41);
  expect(tooMany.status()).toBe(400);
  expect(((await tooMany.json()) as { error: string }).error).toBe("A category can have at most 40 tags; this one has 41.");
  expect((await addCategory("Big", 40)).status()).toBe(201);

  // The category page stops offering "Add tag" at 40 tag rows.
  await page.reload();
  await editCategory(page, "Big");
  await expect(page.getByRole("button", { name: "Add tag" })).toHaveCount(0);
  await expect(page.getByText("A category can have at most 40 tags.")).toBeVisible();
  await page.getByRole("button", { name: "Delete tag Big tag 40" }).click();
  await page.getByRole("button", { name: "Add tag" }).click();
  await expect(page.getByRole("button", { name: "Add tag" })).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel" }).click();

  // Up to 20 categories (the built-in Lifetime doesn't count).
  for (let i = categoryCount + 1; i < 20; i++) expect((await addCategory(`Category ${i}`)).status()).toBe(201);
  const twentyFirst = await addCategory("One too many");
  expect(twentyFirst.status()).toBe(400);
  expect(((await twentyFirst.json()) as { error: string }).error).toBe("You can have at most 20 categories.");

  // Up to 40 tabs ("All" doesn't count).
  const area = data.categories.find((category) => !category.system)!;
  const filter = { categoryId: area.id, tagIds: [area.tags[0]!.id] };
  const addTab = (name: string) => page.request.post("/api/tabs", { data: { name, categories: [filter] } });
  for (let i = tabCount + 1; i <= 40; i++) expect((await addTab(`Tab ${i}`)).status()).toBe(201);
  const tab41 = await addTab("One too many");
  expect(tab41.status()).toBe(400);
  expect(((await tab41.json()) as { error: string }).error).toBe('You can have at most 40 tabs, as well as "All".');

  // Settings says so instead of offering to add more.
  await openSettings(page);
  await expect(section(page, "Categories").getByRole("link", { name: "Add category" })).toHaveCount(0);
  await expect(section(page, "Categories")).toContainText("You have the most categories you can (20). Delete one to add another.");
  await expect(section(page, "Tabs").getByRole("link", { name: "Add tab" })).toHaveCount(0);
  await expect(section(page, "Tabs")).toContainText("You have the most tabs you can (40). Delete one to add another.");
});
