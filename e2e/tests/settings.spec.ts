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

const tabNames = (page: Page) => page.getByRole("tablist", { name: "Tabs" }).getByRole("tab");

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
    await page.getByLabel("Name").fill("Ideas");
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
    await page.getByLabel("Name").fill("Thoughts");
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

test("stylus mode and columns are remembered on this device", async ({ page }) => {
  await page.getByRole("radiogroup", { name: "Columns" }).getByRole("radio", { name: "2" }).click();
  await expect(page.getByRole("radiogroup", { name: "Columns" }).getByRole("radio", { name: "2" })).toHaveAttribute("aria-checked", "true");
  await page.locator("label.switch").filter({ hasText: "Stylus mode" }).click();
  await page.getByRole("link", { name: "← Notes" }).click();
  await expect(page.locator(".note-list ul").first()).toHaveCSS("column-count", "2");
  await expect(page.getByRole("img", { name: "Stylus mode is on" })).toBeVisible();

  await page.reload();
  await expect(page.locator(".note-list ul").first()).toHaveCSS("column-count", "2");
  await expect(addArea(page).getByRole("img", { name: "Writing area for a new note" })).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  await page.locator("label.switch").filter({ hasText: "Stylus mode" }).click();
  await expect(page.getByRole("switch", { name: "Stylus mode" })).not.toBeChecked();
  await page.getByRole("link", { name: "← Notes" }).click();
  await expect(page.getByRole("textbox", { name: "New note" })).toBeVisible();
});
