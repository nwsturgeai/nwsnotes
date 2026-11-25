import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The data every test starts from (e2e/fixtures/seed.json): a save-file's contents. */
export const seed = JSON.parse(readFileSync(path.join(here, "..", "fixtures", "seed.json"), "utf8")) as unknown;

/** The admin's login name and the dev password: the test server runs outside production, so they're the same as with `npm run dev`. */
export const ADMIN = "admin@example.com";
export const PASSWORD = "dev";

/** Fills in the login page and logs in (or tries to). */
export async function logIn(page: Page, loginName: string, password: string) {
  await page.getByLabel("Email").fill(loginName);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}

/** The link in the latest sharing request emailed to this address (the tests' server keeps emails rather than sending them). */
export async function sharingRequestLink(request: APIRequestContext, loginName: string): Promise<string> {
  const emails = (await (await request.get(`/api/test/emails?to=${encodeURIComponent(loginName)}`)).json()) as { text: string }[];
  const link = emails
    .map((email) => /https?:\/\/\S+\/share-invite#\S+/.exec(email.text)?.[0])
    .filter((found): found is string => found !== undefined)
    .at(-1);
  expect(link, `a sharing request emailed to ${loginName}`).toBeDefined();
  return link!;
}

/** Answers the latest sharing request emailed to this address, as its link's page would. */
export async function answerSharingRequest(request: APIRequestContext, loginName: string, accept = true) {
  const token = decodeURIComponent(new URL(await sharingRequestLink(request, loginName)).hash.slice(1));
  const response = await request.post(`/api/share-invite/${accept ? "accept" : "decline"}`, { data: { token } });
  expect(response.ok(), await response.text()).toBe(true);
}

/**
 * Shares a tag through the API (replacing its list), and accepts for anyone who was asked first, so the
 * shares are in use, as most tests want.
 */
export async function shareTag(request: APIRequestContext, tagId: number, shares: { loginName: string; permission: string }[]) {
  const response = await request.put(`/api/tags/${tagId}/shares`, { data: { shares } });
  expect(response.ok(), await response.text()).toBe(true);
  const saved = (await response.json()) as { userId: number; displayName: string; loginName: string; permission: string; pending?: boolean }[];
  for (const share of saved) if (share.pending) await answerSharingRequest(request, share.loginName);
  return saved.map(({ pending: _pending, ...share }) => share);
}

/** Puts the test server's data back to the seed. */
export async function resetData(page: Page) {
  const response = await page.request.post("/api/test/reset", { data: seed });
  expect(response.ok(), "the test server's reset endpoint").toBe(true);
}

/** The tests' `test`: every test starts from the seed data, so tests don't depend on each other. */
export const test = base.extend<{ resetBeforeEach: void; addAreaStartsCollapsed: boolean }>({
  /**
   * The add area is expanded by default, but the tests were written starting from the collapsed area
   * (they expand it with "Show all tags"). So a device that hasn't chosen starts collapsed here; a test
   * of the default sets this to false. A choice made during a test is still remembered across reloads.
   */
  addAreaStartsCollapsed: [true, { option: true }],
  resetBeforeEach: [
    async ({ page, context, addAreaStartsCollapsed }, use) => {
      if (addAreaStartsCollapsed) {
        await context.addInitScript(() => {
          try {
            if (localStorage.getItem("nwsnotes.fullTagList") === null) localStorage.setItem("nwsnotes.fullTagList", "off");
          } catch {
            // No storage (e.g. a blank page): nothing to set.
          }
        });
      }
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
  await page.getByRole("tablist", { name: "Tabs", exact: true }).getByRole("tab", { name, exact: true }).click();
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

/**
 * Holds a button with a finger for over a second and lifts it, as Chrome on Android does: the pointer
 * events arrive, but no click follows them.
 */
export async function fingerHoldWithoutClick(page: Page, button: Locator) {
  const box = (await button.boundingBox())!;
  const at = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, pointerType: "touch", isPrimary: true, pointerId: 7 };
  await button.dispatchEvent("pointerdown", { ...at, button: 0, buttons: 1 });
  await expect(button).toHaveClass(/(^| )held( |$)/, { timeout: 2_000 });
  await button.dispatchEvent("pointerup", { ...at, button: 0, buttons: 0 });
}
