import type { Page } from "@playwright/test";
import { expect, filterRow, noteRow, openNotes, test } from "./fixtures";

/** The server's copy of the note with this title, if it has one. */
async function savedNote(page: Page, title: string) {
  const response = await page.request.get("/api/notes");
  const data = (await response.json()) as { notes: { id: number; titleText?: string }[] };
  return data.notes.find((note) => note.titleText === title);
}

const offlineIcon = (page: Page) => page.getByRole("banner").getByRole("img", { name: /^Offline/ });
/** The clock on a note whose change is waiting to be sent. */
const pendingIcon = (page: Page, title: string) => noteRow(page, title).locator(".note-pending");

/** Whether the app has stored its offline copy of the data (in IndexedDB), with this many notes. */
function offlineCopyNotes(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const open = indexedDB.open("nwsnotes");
        open.onerror = () => resolve(0);
        open.onsuccess = () => {
          try {
            const get = open.result.transaction("kv").objectStore("kv").get("data");
            get.onsuccess = () => resolve((get.result as { notes?: unknown[] } | undefined)?.notes?.length ?? 0);
            get.onerror = () => resolve(0);
          } catch {
            resolve(0);
          }
        };
      }),
  );
}

async function addNote(page: Page, title: string) {
  const box = page.getByRole("textbox", { name: "New note" });
  await box.fill(title);
  await box.press("Enter");
  await expect(noteRow(page, title)).toBeVisible();
}

test("notes added and edited offline are saved when the server is back", async ({ page, context }) => {
  await openNotes(page);
  await context.setOffline(true);

  await addNote(page, "Written offline");
  await expect(offlineIcon(page)).toBeVisible();
  await expect(offlineIcon(page)).toHaveAccessibleName("Offline: 1 change waiting");
  await expect(pendingIcon(page, "Written offline")).toBeVisible();

  await noteRow(page, "Buy milk").getByRole("button", { name: "Edit note" }).click();
  await page.getByRole("textbox", { name: "Note title" }).fill("Buy oat milk");
  await page.getByRole("button", { name: "Update" }).click();
  await noteRow(page, "Garden ideas").getByRole("button", { name: "Archive" }).click();
  await expect(offlineIcon(page)).toHaveAccessibleName("Offline: 3 changes waiting");
  expect(await savedNote(page, "Written offline")).toBeUndefined();

  await context.setOffline(false);
  await expect(offlineIcon(page)).toHaveCount(0, { timeout: 20_000 });
  await expect(pendingIcon(page, "Written offline")).toHaveCount(0);
  // The waiting changes are sent one at a time.
  await expect.poll(async () => (await savedNote(page, "Written offline")) !== undefined).toBe(true);
  await expect.poll(async () => (await savedNote(page, "Buy oat milk")) !== undefined).toBe(true);

  // Everything is on the server, as a reload shows.
  await page.reload();
  await expect(noteRow(page, "Written offline")).toBeVisible();
  await expect(noteRow(page, "Buy oat milk")).toBeVisible();
  await expect(noteRow(page, "Garden ideas").getByRole("button", { name: "Move to bin" })).toBeVisible();
});

test("what needs the server can't be used offline", async ({ page, context }) => {
  await openNotes(page);
  await page.getByRole("tab", { name: "Work" }).click();
  await context.setOffline(true);
  // The app notices when a change can't be sent.
  await addNote(page, "Noticed offline");
  await expect(offlineIcon(page)).toBeVisible();

  await expect(page.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-disabled", "true");
  await expect(filterRow(page).getByRole("button", { name: /offline/i })).toBeDisabled();
  await page.getByRole("button", { name: "Show all tags" }).click();
  await expect(page.getByRole("button", { name: "Select notes to change their tags" })).toBeDisabled();

  await context.setOffline(false);
  await expect(offlineIcon(page)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole("link", { name: "Settings" })).not.toHaveAttribute("aria-disabled", "true");
  await expect(filterRow(page).getByRole("button", { name: "Edit order" })).toBeEnabled();
});

test.describe(() => {
  // The installed app opens offline from its service worker's cache, with the notes it last had.
  test.use({ serviceWorkers: "allow" });

  test("the app opens offline, and changes made then are saved later", async ({ page, context }) => {
    await openNotes(page);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    // Once the service worker is in charge of the page, it can open it without the server.
    await page.reload();
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    await expect(noteRow(page, "Plan the team meeting")).toBeVisible();
    // The app keeps its offline copy of the data shortly after loading it.
    await expect.poll(() => offlineCopyNotes(page)).toBe(9);

    await context.setOffline(true);
    await page.reload();
    await expect(noteRow(page, "Plan the team meeting")).toBeVisible();
    await expect(offlineIcon(page)).toBeVisible();
    await addNote(page, "Opened offline");
    await expect(pendingIcon(page, "Opened offline")).toBeVisible();

    // Still waiting after the app is closed and opened again.
    await page.reload();
    await expect(pendingIcon(page, "Opened offline")).toBeVisible();

    await context.setOffline(false);
    await expect(pendingIcon(page, "Opened offline")).toHaveCount(0, { timeout: 20_000 });
    await expect.poll(async () => (await savedNote(page, "Opened offline")) !== undefined).toBe(true);
  });
});
