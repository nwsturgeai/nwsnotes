import type { Page } from "@playwright/test";
import { expect, noteRow, openNotes, test } from "./fixtures";

/*
 * Several tabs of the app open in one browser. They share the session cookie and the offline outbox, so
 * logging in or out in one affects the others, and changes one tab queues are seen (and sent) by the others.
 */

/** The server's copy of the note with this title, if it has one. */
async function savedNote(page: Page, title: string) {
  const response = await page.request.get("/api/notes");
  const data = (await response.json()) as { notes: { id: number; titleText?: string; detailsText?: string }[] };
  return data.notes.find((note) => note.titleText === title);
}

const editor = (page: Page) => page.getByRole("dialog", { name: "Long-form note" });
const changedElsewhere = /changed somewhere else/;

async function addNote(page: Page, title: string) {
  const box = page.getByRole("textbox", { name: "New note" });
  await box.fill(title);
  await box.press("Enter");
  await expect(noteRow(page, title)).toBeVisible();
}

test("logging out in one tab logs out the others", async ({ page, context }) => {
  await openNotes(page);
  const other = await context.newPage();
  await openNotes(other);

  await other.getByRole("link", { name: "Settings" }).click();
  await other.getByRole("button", { name: "Log out" }).click();
  await expect(other.getByLabel("Password")).toBeVisible({ timeout: 6_000 });
  await expect(page.getByLabel("Password")).toBeVisible({ timeout: 10_000 });
});

test("logging in as someone else in another tab sends this one to the login page", async ({ page, context }) => {
  const made = await page.request.post("/api/users", { data: { displayName: "Sam Smith", loginName: "sam@example.com" } });
  expect(made.status()).toBe(201);
  const { password } = (await made.json()) as { password: string };
  await openNotes(page);

  // Another tab logs in as Sam: the browser's cookie is now Sam's.
  const login = await page.request.post("/api/login", { data: { loginName: "sam@example.com", password } });
  expect(login.ok()).toBe(true);
  await expect(page.getByLabel("Password")).toBeVisible({ timeout: 10_000 });

  // A page still showing the admin's notes can't use Sam's session as if it were the admin's.
  const asAdmin = await page.request.get("/api/notes", { headers: { "X-User-Id": "1" } });
  expect(asAdmin.status()).toBe(401);
  // Sam's notebook didn't get any of the admin's notes.
  expect(await savedNote(page, "Buy milk")).toBeUndefined();
});

test("a change queued in a tab that's offline is shown and sent by another tab", async ({ page, context }) => {
  await openNotes(page);
  const other = await context.newPage();
  await openNotes(other);

  // Only the first tab loses the server.
  await page.route("**/api/**", (route) => route.abort());
  await addNote(page, "Queued in one tab");
  await expect(page.getByRole("banner").getByRole("img", { name: /^Offline/ })).toBeVisible();

  // The other tab, which can still reach the server, shows it and sends it.
  await expect(noteRow(other, "Queued in one tab")).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => (await savedNote(other, "Queued in one tab")) !== undefined, { timeout: 10_000 }).toBe(true);
  // The first tab no longer has it waiting.
  await expect(noteRow(page, "Queued in one tab").locator(".note-pending")).toHaveCount(0, { timeout: 10_000 });
  await page.unroute("**/api/**");
});

test("saving an edit of a note changed in another tab asks first", async ({ page, context }) => {
  await openNotes(page);
  const other = await context.newPage();
  await openNotes(other);

  await noteRow(page, "Buy milk").getByRole("button", { name: "Edit note" }).click();
  await page.getByRole("textbox", { name: "Note title" }).fill("Buy oat milk");

  await noteRow(other, "Buy milk").getByRole("button", { name: "Edit note" }).click();
  await other.getByRole("textbox", { name: "Note title" }).fill("Buy bread");
  await other.getByRole("button", { name: "Update" }).click();
  await expect(noteRow(other, "Buy bread")).toBeVisible();

  // The first tab's save would replace that change, so it's refused, keeping what was typed.
  await page.getByRole("button", { name: "Update" }).click();
  await expect(page.getByText(changedElsewhere)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Buy oat milk");
  expect(await savedNote(page, "Buy bread")).toBeDefined();

  // Saving again replaces it.
  await page.getByRole("button", { name: "Update" }).click();
  await expect(noteRow(page, "Buy oat milk")).toBeVisible();
  await expect.poll(async () => (await savedNote(page, "Buy oat milk")) !== undefined).toBe(true);
  await expect(noteRow(other, "Buy oat milk")).toBeVisible({ timeout: 10_000 });
});

test("a long-form note changed in another tab asks which version to keep", async ({ page, context }) => {
  await openNotes(page);
  await page.getByRole("button", { name: "Show all tags" }).click();
  await page.locator(".new-note").getByRole("button", { name: "Create long-form note" }).click();
  await editor(page).getByRole("textbox", { name: "Long-form note title" }).fill("Trip to Rome");
  await editor(page).getByRole("textbox", { name: "Long-form note title" }).press("Enter");
  await expect(editor(page).getByRole("textbox", { name: "Details" })).toBeFocused();
  await editor(page).getByRole("textbox", { name: "Details" }).fill("Mine");

  // Meanwhile another tab edits the same note.
  const other = await context.newPage();
  await openNotes(other);
  await noteRow(other, "Trip to Rome").getByRole("button", { name: "Edit note" }).click();
  await editor(other).getByRole("textbox", { name: "Details" }).fill("Theirs");
  await editor(other).getByRole("button", { name: "Finish" }).click();
  await expect(editor(other)).toHaveCount(0);
  await expect.poll(async () => (await savedNote(page, "Trip to Rome"))?.detailsText).toBe("Theirs");

  // Finishing here asks; keeping mine saves it and finishes.
  await editor(page).getByRole("button", { name: "Finish" }).click();
  const question = page.locator("dialog.confirm-dialog").filter({ hasText: changedElsewhere });
  await expect(question).toBeVisible();
  await question.getByRole("button", { name: "Keep mine" }).click();
  await expect(editor(page)).toHaveCount(0);
  await expect.poll(async () => (await savedNote(page, "Trip to Rome"))?.detailsText).toBe("Mine");

  // Again, discarding mine this time: the other tab's version stays.
  await expect(noteRow(other, "Trip to Rome")).toBeVisible();
  await noteRow(page, "Trip to Rome").getByRole("button", { name: "Edit note" }).click();
  await editor(page).getByRole("textbox", { name: "Details" }).fill("Mine again");
  await noteRow(other, "Trip to Rome").getByRole("button", { name: "Edit note" }).click();
  await editor(other).getByRole("textbox", { name: "Details" }).fill("Theirs again");
  await editor(other).getByRole("button", { name: "Finish" }).click();
  await expect.poll(async () => (await savedNote(page, "Trip to Rome"))?.detailsText).toBe("Theirs again");
  await editor(page).getByRole("button", { name: "Finish" }).click();
  await question.getByRole("button", { name: "Discard mine" }).click();
  await expect(editor(page)).toHaveCount(0);
  expect((await savedNote(page, "Trip to Rome"))?.detailsText).toBe("Theirs again");
});
