import type { Locator, Page } from "@playwright/test";
import { expect, expectTitles, filterRow, noteRow, openNotes, selectTab, test } from "./fixtures";

const WORK = ["Plan the team meeting", "Read the quarterly report", "Old invoice"];

/** A tab in the top strip. */
const topTab = (page: Page, name: string) => page.getByRole("tablist", { name: "Tabs", exact: true }).getByRole("tab", { name, exact: true });

const dialog = (page: Page) => page.getByRole("dialog", { name: /^Move to/ });

/** Waits for a move to be saved. */
const savedMove = (page: Page) => page.waitForResponse((response) => /\/api\/notes\/\d+\/tab-move$/.test(response.url()) && response.ok());

/** Drags a note by its grip onto a tab and lets go there. */
async function dragOnto(page: Page, note: Locator, tab: Locator) {
  const grip = note.getByTitle("Drag to reorder");
  const from = (await grip.boundingBox())!;
  const to = (await tab.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await expect(tab).toHaveClass(/drop-target/);
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("nwsnotes.columns", "single"));
  await openNotes(page);
  await selectTab(page, "Work");
  await expectTitles(page, WORK);
  await filterRow(page).getByRole("button", { name: "Edit order" }).click();
});

test("dragging a note onto another tab asks, then gives it that tab's tags in one History change", async ({ page }) => {
  // Cancel changes nothing.
  await dragOnto(page, noteRow(page, "Old invoice"), topTab(page, "Home"));
  await expect(dialog(page)).toContainText("Area: Work → Home");
  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expectTitles(page, WORK);

  // Escape is Cancel too.
  await dragOnto(page, noteRow(page, "Old invoice"), topTab(page, "Home"));
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expectTitles(page, WORK);

  // OK moves it: it leaves Work, and the tab stays the same, still in edit-order mode.
  await dragOnto(page, noteRow(page, "Old invoice"), topTab(page, "Home"));
  const saved = savedMove(page);
  await dialog(page).getByRole("button", { name: /^OK/ }).click();
  await saved;
  await expectTitles(page, ["Plan the team meeting", "Read the quarterly report"]);
  await expect(topTab(page, "Work")).toHaveAttribute("aria-selected", "true");
  await expect(filterRow(page).getByRole("button", { name: "Finish ordering" })).toBeVisible();

  await selectTab(page, "Home");
  await expect(noteRow(page, "Old invoice")).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(page.locator(".history-list .history-summary").first()).toHaveText('Moved "Old invoice" to tab "Home"');
});

test("the dialog closes by itself after 3 seconds, as if OK had been clicked", async ({ page }) => {
  await dragOnto(page, noteRow(page, "Old invoice"), topTab(page, "Home"));
  await expect(dialog(page).getByRole("button", { name: /^OK \(3\)/ })).toBeVisible();
  const saved = savedMove(page);
  await expect(dialog(page)).toHaveCount(0, { timeout: 6000 });
  await saved;
  await expectTitles(page, ["Plan the team meeting", "Read the quarterly report"]);
});

test("a Lifetime tab sets the note's Lifetime, and the tab it came from loses its tag", async ({ page }) => {
  await dragOnto(page, noteRow(page, "Old invoice"), topTab(page, "On hold"));
  await expect(dialog(page)).toContainText("Area: Work → (none)");
  await expect(dialog(page)).toContainText("Lifetime: Archived → Waiting");
  const saved = savedMove(page);
  await dialog(page).getByRole("button", { name: /^OK/ }).click();
  await saved;
  await selectTab(page, "On hold");
  await expect(noteRow(page, "Old invoice")).toBeVisible();
});

test("ticking auto-accept skips the dialog for later drags in this window", async ({ page }) => {
  await dragOnto(page, noteRow(page, "Old invoice"), topTab(page, "Home"));
  await dialog(page).getByText("Auto-accept note-to-tab drags in this window for the next 5 minutes?").click();
  let saved = savedMove(page);
  await dialog(page).getByRole("button", { name: /^OK/ }).click();
  await saved;

  saved = savedMove(page);
  await dragOnto(page, noteRow(page, "Plan the team meeting"), topTab(page, "Home"));
  await saved;
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator(".toast")).toContainText('Moved to "Home": Area: Work → Home');
  await expectTitles(page, ["Read the quarterly report"]);
});

test("the tab showing and All aren't drop targets, and a note already in the tab isn't changed", async ({ page }) => {
  // Over the tab it's on: nothing to drop on, and the order stays as it was.
  const grip = noteRow(page, "Old invoice").getByTitle("Drag to reorder");
  const from = (await grip.boundingBox())!;
  const work = (await topTab(page, "Work").boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(work.x + work.width / 2, work.y + work.height / 2, { steps: 10 });
  await expect(topTab(page, "Work")).not.toHaveClass(/drop-target/);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(dialog(page)).toHaveCount(0);
  await expectTitles(page, WORK);
  await expect(topTab(page, "All")).not.toHaveAttribute("data-drop-tab");

  // From All, onto a tab the note is already in.
  await selectTab(page, "All");
  await dragOnto(page, noteRow(page, "Plan the team meeting"), topTab(page, "Work"));
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator(".toast")).toHaveText("Already in that tab.");
});

test("a note can be dropped on a tab in the left strip too", async ({ page }) => {
  // Set Home to Left.
  await page.getByRole("link", { name: "Settings" }).click();
  const tabsSection = page.locator("section").filter({ has: page.getByRole("heading", { name: "Tabs", exact: true }) });
  await tabsSection.getByRole("link", { name: /^Home\b/ }).click();
  await page.locator("label.switch").click();
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("link", { name: "← Notes" }).click();
  await expectTitles(page, WORK);
  await filterRow(page).getByRole("button", { name: "Edit order" }).click();

  const home = page.getByRole("tablist", { name: "Left tabs" }).getByRole("tab", { name: "Home" });
  await dragOnto(page, noteRow(page, "Old invoice"), home);
  await expect(dialog(page)).toContainText("Area: Work → Home");
  const saved = savedMove(page);
  await dialog(page).getByRole("button", { name: /^OK/ }).click();
  await saved;
  await expectTitles(page, ["Plan the team meeting", "Read the quarterly report"]);
});
