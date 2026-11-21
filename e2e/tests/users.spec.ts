import type { APIRequestContext, Browser, BrowserContext, Page } from "@playwright/test";
import { ADMIN, PASSWORD, expect, logIn, noteRow, openNotes, test } from "./fixtures";

/** Generated passwords: four groups of four, from lowercase letters and digits without 0, o, 1, l and i. */
const GENERATED_PASSWORD = /^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/;

/** Another device: a new browser context, with this project's screen and settings, logged out. */
async function newDevice(browser: Browser): Promise<BrowserContext> {
  const use = test.info().project.use;
  return browser.newContext({
    baseURL: use.baseURL,
    viewport: use.viewport,
    hasTouch: use.hasTouch,
    isMobile: use.isMobile,
    userAgent: use.userAgent,
    timezoneId: use.timezoneId,
    locale: use.locale,
    serviceWorkers: "block",
    // Not the saved admin session the tests otherwise start with.
    storageState: { cookies: [], origins: [] },
  });
}

/** The admin adds a user through the API, returning their generated password. */
async function addUser(request: APIRequestContext, displayName: string, loginName: string): Promise<{ id: number; password: string }> {
  const response = await request.post("/api/users", { data: { displayName, loginName } });
  expect(response.status()).toBe(201);
  const { user, password } = (await response.json()) as { user: { id: number }; password: string };
  return { id: user.id, password };
}

/** A page on a new device, logged in as this user and showing their notes page. */
async function loggedIn(browser: Browser, loginName: string, password: string): Promise<Page> {
  const page = await (await newDevice(browser)).newPage();
  await page.goto("/");
  await logIn(page, loginName, password);
  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  return page;
}

/** Waits for a page to be sent back to the login page. */
async function expectLoggedOut(page: Page) {
  await expect(page.getByLabel("Name")).toBeVisible({ timeout: 15_000 });
}

async function addNote(page: Page, title: string) {
  const box = page.getByRole("textbox", { name: "New note" });
  await box.fill(title);
  await box.press("Enter");
  await expect(noteRow(page, title)).toBeVisible();
}

const tabStrip = (page: Page) => page.getByRole("tablist", { name: "Tabs", exact: true });

/** A user's row on the users page. */
const userRow = (page: Page, loginName: string) =>
  page.getByRole("list", { name: "Users" }).getByRole("listitem").filter({ hasText: loginName });

async function openUsersPage(page: Page) {
  await page.goto("/settings");
  await page.getByRole("link", { name: "Manage users" }).click();
  await expect(page.getByRole("heading", { name: "Users", level: 1 })).toBeVisible();
}

test("the admin adds a user, whose password is shown once, and who starts with an empty notebook", async ({ page, browser }) => {
  await openUsersPage(page);
  await expect(userRow(page, ADMIN)).toContainText("Admin");
  await expect(userRow(page, ADMIN)).toContainText("9 of 1000 notes");

  await page.getByLabel("Display name").fill("Sam Smith");
  await page.getByLabel("Login name").fill("sam");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Send this password to Sam Smith. It won't be shown again.");
  const password = (await dialog.getByTestId("new-password").textContent())!.trim();
  expect(password).toMatch(GENERATED_PASSWORD);
  await expect(dialog.getByRole("button", { name: "Copy" })).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Shown once only: it's nowhere on the page now, or after a reload.
  await expect(page.getByText(password)).toHaveCount(0);
  await expect(userRow(page, "sam")).toContainText("Sam Smith");
  await expect(userRow(page, "sam")).toContainText("Last logged in Never");
  await expect(userRow(page, "sam")).toContainText("0 of 1000 notes");
  await page.reload();
  await expect(page.getByText(password)).toHaveCount(0);

  const sam = await loggedIn(browser, "sam", password);
  // Only the built-in "All" tab, no categories, and no notes.
  await expect(tabStrip(sam).getByRole("tab")).toHaveText(["All"]);
  await expect(sam.locator(".note-list li[data-note-id]")).toHaveCount(0);
  const data = (await (await sam.request.get("/api/notes")).json()) as { notes: unknown[]; categories: { system?: boolean }[]; tabs: unknown[] };
  expect(data.notes).toEqual([]);
  expect(data.tabs).toEqual([]);
  expect(data.categories.filter((category) => !category.system)).toEqual([]);
  // The history is empty too.
  expect(((await (await sam.request.get("/api/history")).json()) as { changes: unknown[] }).changes).toEqual([]);

  await sam.goto("/settings");
  await expect(sam.getByText("Logged in as Sam Smith (sam)")).toBeVisible();

  await page.reload();
  await expect(userRow(page, "sam")).not.toContainText("Last logged in Never");
  await sam.context().close();
});

test("two users' notebooks are separate, and each one's ids start at 1", async ({ page, browser }) => {
  const { password } = await addUser(page.request, "Robin", "robin");
  const robin = await loggedIn(browser, "robin", password);

  await addNote(robin, "Robin's own note");
  const category = await robin.request.post("/api/categories", { data: { name: "Hobbies", multiSelect: false, tags: [{ name: "Chess" }] } });
  expect(category.ok()).toBe(true);
  const tab = await robin.request.post("/api/tabs", { data: { name: "Fun", categories: [{ categoryId: 1, tagIds: [1] }] } });
  expect(tab.ok(), await tab.text()).toBe(true);

  const robinData = (await (await robin.request.get("/api/notes")).json()) as {
    notes: { id: number; titleText?: string }[];
    categories: { id: number; name: string; system?: boolean; tags: { id: number }[] }[];
    tabs: { id: number; name: string }[];
  };
  expect(robinData.notes.map((note) => [note.id, note.titleText])).toEqual([[1, "Robin's own note"]]);
  const hobbies = robinData.categories.find((c) => !c.system)!;
  expect([hobbies.id, hobbies.name, hobbies.tags[0]!.id]).toEqual([1, "Hobbies", 1]);
  expect(robinData.tabs.map((t) => [t.id, t.name])).toEqual([[1, "Fun"]]);

  // The admin's notebook is unchanged, and Robin's things aren't in it.
  const adminData = (await (await page.request.get("/api/notes")).json()) as typeof robinData;
  expect(adminData.notes).toHaveLength(9);
  expect(adminData.notes.some((note) => note.titleText === "Robin's own note")).toBe(false);
  expect(adminData.categories.some((c) => c.name === "Hobbies")).toBe(false);
  expect(adminData.tabs.map((t) => t.name)).not.toContain("Fun");

  // The same through the pages.
  await openNotes(page);
  await expect(noteRow(page, "Plan the team meeting")).toBeVisible();
  await expect(noteRow(page, "Robin's own note")).toHaveCount(0);
  await expect(tabStrip(page).getByRole("tab", { name: "Fun" })).toHaveCount(0);
  await robin.reload();
  await expect(noteRow(robin, "Robin's own note")).toBeVisible();
  await expect(noteRow(robin, "Plan the team meeting")).toHaveCount(0);
  await expect(tabStrip(robin).getByRole("tab")).toHaveText(["All", "Fun"]);

  // Robin can't reach the admin's notes by their ids either.
  expect((await robin.request.put("/api/notes/2/lifetime", { data: { lifetime: "Archived" } })).status()).toBe(404);
  const robinHistory = (await (await robin.request.get("/api/history")).json()) as { changes: { id: number; summary: string }[] };
  const adminHistory = (await (await page.request.get("/api/history")).json()) as { changes: { id: number; summary: string }[] };
  expect(robinHistory.changes.map((c) => c.summary)).not.toContain("Imported the test data");
  expect(adminHistory.changes.map((c) => c.summary)).toEqual(["Imported the test data"]);
  // Going back to one of the admin's changes isn't possible from Robin's notebook.
  expect((await robin.request.post("/api/history/revert", { data: { toChangeId: adminHistory.changes[0]!.id } })).status()).toBe(404);
  await robin.context().close();
});

test("live updates reach only the same user's other windows", async ({ page, context, browser }) => {
  const { password } = await addUser(page.request, "Kim", "kim");
  const kim = await (await newDevice(browser)).newPage();
  let kimMessages = 0;
  kim.on("websocket", (ws) =>
    ws.on("framereceived", (frame) => {
      if (String(frame.payload).includes("data-changed")) kimMessages++;
    }),
  );
  await kim.goto("/");
  await logIn(kim, "kim", password);
  await expect(kim.getByRole("link", { name: "Settings" })).toBeVisible();

  await openNotes(page);
  const other = await context.newPage();
  let otherMessages = 0;
  other.on("websocket", (ws) =>
    ws.on("framereceived", (frame) => {
      if (String(frame.payload).includes("data-changed")) otherMessages++;
    }),
  );
  await openNotes(other);

  await addNote(page, "For the admin's eyes");
  await expect(noteRow(other, "For the admin's eyes")).toBeVisible({ timeout: 10_000 });
  expect(otherMessages).toBeGreaterThan(0);

  // Kim adds a note: the admin's windows aren't told.
  const before = otherMessages;
  await addNote(kim, "Kim's note");
  await page.waitForTimeout(1500);
  expect(otherMessages).toBe(before);
  expect(kimMessages).toBe(0);
  await expect(noteRow(other, "Kim's note")).toHaveCount(0);
  await expect(noteRow(kim, "For the admin's eyes")).toHaveCount(0);
  await kim.context().close();
});

test("changing your own password: the old one stops working, this window stays logged in, other devices are logged out", async ({
  page,
  browser,
}) => {
  const { password } = await addUser(page.request, "Alex", "alex");
  const alex = await loggedIn(browser, "alex", password);
  const alexElsewhere = await loggedIn(browser, "alex", password);

  await alex.getByRole("link", { name: "Settings" }).click();
  await alex.getByRole("button", { name: "Change password" }).click();
  await expect(alex).toHaveURL(/\/settings\/password$/);

  const current = alex.getByLabel("Current password");
  const newPassword = alex.getByLabel("New password", { exact: true });
  const again = alex.getByLabel("New password again");
  const change = alex.getByRole("button", { name: "Change password" });

  // Checked in the page.
  await current.fill(password);
  await newPassword.fill("too short");
  await again.fill("too short");
  await change.click();
  await expect(alex.getByRole("alert")).toHaveText("The new password must be at least 10 characters.");
  await newPassword.fill("a long new password");
  await again.fill("a different password");
  await change.click();
  await expect(alex.getByRole("alert")).toHaveText("The new passwords don't match.");
  // Checked by the server.
  await current.fill("not my password");
  await again.fill("a long new password");
  await change.click();
  await expect(alex.getByRole("alert")).toHaveText("The current password isn't right.");

  await current.fill(password);
  await change.click();
  await expect(alex).toHaveURL(/\/settings$/);
  await expect(alex.getByRole("status").filter({ hasText: "Password changed." })).toHaveText(
    "Password changed. Your other devices have been logged out.",
  );

  // The other device is logged out; this one stays logged in, even after a reload.
  await expectLoggedOut(alexElsewhere);
  await alex.reload();
  await expect(alex.getByText("Logged in as Alex (alex)")).toBeVisible();
  await alex.goto("/");
  await addNote(alex, "Still logged in");

  // The old password no longer works; the new one does.
  await alexElsewhere.reload();
  await logIn(alexElsewhere, "alex", password);
  await expect(alexElsewhere.getByRole("alert")).toHaveText("Incorrect name or password.");
  await logIn(alexElsewhere, "alex", "a long new password");
  await expect(noteRow(alexElsewhere, "Still logged in")).toBeVisible();
  await alex.context().close();
  await alexElsewhere.context().close();
});

test("resetting a password and turning an account off log that user out; turned off, they can't log in until it's on again", async ({
  page,
  browser,
}) => {
  const { password } = await addUser(page.request, "Jo Bloggs", "jody");
  const jo = await loggedIn(browser, "jody", password);
  await openUsersPage(page);
  const row = userRow(page, "jody");

  // The admin's own row has only Edit.
  await expect(userRow(page, ADMIN).getByRole("button")).toHaveText(["Edit"]);

  // Reset password.
  await row.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByRole("dialog")).toHaveText(/Reset Jo Bloggs's password\? They'll be logged out everywhere\./);
  await page.getByRole("dialog").getByRole("button", { name: "Reset password" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Send this password to Jo Bloggs. It won't be shown again.");
  const newPassword = (await dialog.getByTestId("new-password").textContent())!.trim();
  expect(newPassword).toMatch(GENERATED_PASSWORD);
  expect(newPassword).not.toBe(password);
  await dialog.getByRole("button", { name: "Done" }).click();

  await expectLoggedOut(jo);
  await logIn(jo, "jody", password);
  await expect(jo.getByRole("alert")).toHaveText("Incorrect name or password.");
  await logIn(jo, "jody", newPassword);
  await expect(jo.getByRole("link", { name: "Settings" })).toBeVisible();

  // Turn off.
  await row.getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByRole("dialog")).toHaveText(
    /Turn off Jo Bloggs's account\? They'll be logged out everywhere and can't log in until it's turned on again\./,
  );
  await page.getByRole("dialog").getByRole("button", { name: "Turn off" }).click();
  await expect(row).toContainText("Turned off");
  await expectLoggedOut(jo);
  await logIn(jo, "jody", newPassword);
  await expect(jo.getByRole("alert")).toHaveText("This account is turned off.");
  // A wrong password doesn't say whether the account exists or is off.
  await logIn(jo, "jody", "not the password");
  await expect(jo.getByRole("alert")).toHaveText("Incorrect name or password.");

  // Turn on again.
  await row.getByRole("button", { name: "Turn on" }).click();
  await expect(row).not.toContainText("Turned off");
  await logIn(jo, "jody", newPassword);
  await expect(jo.getByRole("link", { name: "Settings" })).toBeVisible();

  // Edit: the names change, the notebook doesn't depend on them.
  await addNote(jo, "Jo's note");
  await row.getByRole("button", { name: "Edit" }).click();
  // While editing, the row is a form (its names are in the boxes, not its text).
  const editForm = page.getByRole("list", { name: "Users" }).locator("form");
  await editForm.getByLabel("Display name").fill("Joanna Bloggs");
  await editForm.getByLabel("Login name").fill("joanna");
  await editForm.getByRole("button", { name: "Save" }).click();
  await expect(userRow(page, "joanna")).toContainText("Joanna Bloggs");
  await expect(userRow(page, "joanna")).toContainText("1 of 1000 notes");
  // The session still works (it belongs to the user id), and the new login name logs in.
  await jo.reload();
  await expect(noteRow(jo, "Jo's note")).toBeVisible();
  const joAgain = await loggedIn(browser, "joanna", newPassword);
  await expect(noteRow(joAgain, "Jo's note")).toBeVisible();

  // The admin can't turn off or reset their own account through the API either.
  expect((await page.request.put("/api/users/1", { data: { disabled: true } })).status()).toBe(400);
  expect((await page.request.post("/api/users/1/reset-password")).status()).toBe(400);
  await jo.context().close();
  await joAgain.context().close();
});

test("a user who isn't the admin sees no Users section, and the users API refuses them", async ({ page, browser }) => {
  const { id, password } = await addUser(page.request, "Pat", "pat");
  const pat = await loggedIn(browser, "pat", password);
  await pat.getByRole("link", { name: "Settings" }).click();
  await expect(pat.getByRole("heading", { name: "Account" })).toBeVisible();
  await expect(pat.getByRole("heading", { name: "Users" })).toHaveCount(0);
  await expect(pat.getByRole("link", { name: "Manage users" })).toHaveCount(0);

  expect((await pat.request.get("/api/users")).status()).toBe(403);
  expect((await pat.request.post("/api/users", { data: { displayName: "Sneaky", loginName: "sneaky" } })).status()).toBe(403);
  expect((await pat.request.put(`/api/users/${id}`, { data: { displayName: "Boss" } })).status()).toBe(403);
  expect((await pat.request.put("/api/users/1", { data: { disabled: true } })).status()).toBe(403);
  expect((await pat.request.post("/api/users/1/reset-password")).status()).toBe(403);
  // Who they are.
  expect(await (await pat.request.get("/api/me")).json()).toEqual({ id, loginName: "pat", displayName: "Pat", admin: false });
  expect(await (await page.request.get("/api/me")).json()).toEqual({ id: 1, loginName: ADMIN, displayName: "Admin", admin: true });
  await pat.context().close();
});

test("the login form refuses a wrong name or password", async ({ page, browser }) => {
  const { password } = await addUser(page.request, "Lee", "lee");
  const device = await (await newDevice(browser)).newPage();
  await device.goto("/");
  // Lee's name with the admin's password, and the admin's name with Lee's.
  await logIn(device, "lee", PASSWORD);
  await expect(device.getByRole("alert")).toHaveText("Incorrect name or password.");
  await logIn(device, ADMIN, password);
  await expect(device.getByRole("alert")).toHaveText("Incorrect name or password.");
  await logIn(device, "nobody-here", password);
  await expect(device.getByRole("alert")).toHaveText("Incorrect name or password.");
  await logIn(device, "LEE", password);
  await expect(device.getByRole("link", { name: "Settings" })).toBeVisible();
  await device.context().close();
});

test("logging out clears this user's offline copy from the device", async ({ page }) => {
  await openNotes(page);
  // The copy is saved shortly after the notes load.
  const keys = () =>
    page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const request = indexedDB.open("nwsnotes", 1);
          request.onsuccess = () => {
            const all = request.result.transaction("kv", "readonly").objectStore("kv").getAllKeys();
            all.onsuccess = () => resolve(all.result.map(String));
          };
        }),
    );
  await expect.poll(keys).toContain("data:1");
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Log out" }).click();
  await expectLoggedOut(page);
  await expect.poll(keys).not.toContain("data:1");
});

test.describe("the offline copy from before there were users", () => {
  /** Puts an outbox from before there were users (unkeyed, waiting to add one note) on this device. */
  async function oldOutbox(page: Page, title: string) {
    await page.evaluate(
      (noteTitle) =>
        new Promise<void>((resolve) => {
          const request = indexedDB.open("nwsnotes", 1);
          request.onupgradeneeded = () => request.result.createObjectStore("kv");
          request.onsuccess = () => {
            const now = new Date().toISOString();
            const note = { id: -1001, titleText: noteTitle, tagIds: [], createdDateTime: now, lastModifiedDateTime: now, tagsChangedDateTime: now };
            const pending = {
              outbox: [{ seq: 1, kind: "add", tempId: -1001, body: { titleText: noteTitle, tagIds: [], clientId: crypto.randomUUID(), createdDateTime: now } }],
              latest: { "-1001": note },
              idMap: {},
              nextTempId: -1002,
              nextSeq: 2,
            };
            const transaction = request.result.transaction("kv", "readwrite");
            transaction.objectStore("kv").put(pending, "pending");
            transaction.objectStore("kv").put({ notes: [note], categories: [], tabs: [] }, "data");
            transaction.oncomplete = () => {
              request.result.close();
              resolve();
            };
          };
        }),
      title,
    );
  }

  const storedKeys = (page: Page) =>
    page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const request = indexedDB.open("nwsnotes", 1);
          request.onsuccess = () => {
            const all = request.result.transaction("kv", "readonly").objectStore("kv").getAllKeys();
            all.onsuccess = () => resolve(all.result.map(String));
          };
        }),
    );

  test("is kept, with its waiting changes, if the admin logs in first", async ({ browser }) => {
    const device = await (await newDevice(browser)).newPage();
    await device.goto("/");
    await oldOutbox(device, "Written before the update");
    await logIn(device, ADMIN, PASSWORD);
    // The waiting change is sent once the app is online.
    await expect(noteRow(device, "Written before the update")).toBeVisible();
    await expect(noteRow(device, "Written before the update").locator(".note-pending")).toHaveCount(0, { timeout: 15_000 });
    const notes = (await (await device.request.get("/api/notes")).json()) as { notes: { titleText?: string }[] };
    expect(notes.notes.some((note) => note.titleText === "Written before the update")).toBe(true);
    await expect.poll(() => storedKeys(device)).not.toContain("pending");
    await expect.poll(() => storedKeys(device)).not.toContain("data");
    await device.context().close();
  });

  test("is cleared if someone else logs in first", async ({ page, browser }) => {
    const { password } = await addUser(page.request, "Chris", "chris");
    const device = await (await newDevice(browser)).newPage();
    await device.goto("/");
    await oldOutbox(device, "The admin's old note");
    await logIn(device, "chris", password);
    await expect(device.getByRole("link", { name: "Settings" })).toBeVisible();
    await expect(noteRow(device, "The admin's old note")).toHaveCount(0);
    await expect.poll(() => storedKeys(device)).not.toContain("pending");
    expect(await storedKeys(device)).not.toContain("data");
    // Nothing reached either notebook.
    for (const request of [device.request, page.request]) {
      const data = (await (await request.get("/api/notes")).json()) as { notes: { titleText?: string }[] };
      expect(data.notes.some((note) => note.titleText === "The admin's old note")).toBe(false);
    }
    await device.context().close();
  });
});

/** A size as the app shows it (1024-based, one decimal place). */
function shownSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

test("Settings shows how many notes you have and the space they take; the users page shows each user's and the total", async ({ page, browser }) => {
  type Stats = { noteCount: number; noteBytes: number; historyBytes: number };
  // An edit, so the History holds an earlier copy of a note.
  const notes = (await (await page.request.get("/api/notes")).json()) as { notes: { id: number; titleText?: string; tagIds: number[] }[] };
  const typed = notes.notes.find((note) => note.titleText !== undefined)!;
  const edited = await page.request.put(`/api/notes/${typed.id}`, {
    data: { titleText: `${typed.titleText} (edited)`, tagIds: typed.tagIds.filter((id) => id > 0) },
  });
  expect(edited.ok(), await edited.text()).toBe(true);
  const stats = (await (await page.request.get("/api/me/stats")).json()) as Stats;
  expect(stats.noteCount).toBe(9);
  expect(stats.noteBytes).toBeGreaterThan(0);
  expect(stats.historyBytes).toBeGreaterThan(0);

  await page.goto("/settings");
  await expect(page.locator(".note-stats")).toHaveText(
    `You have 9 notes, taking up ${shownSize(stats.noteBytes)}, plus ${shownSize(stats.historyBytes)} for their History.`,
  );

  // Another user, with one note: their own figures, and both on the users page with the total.
  const { password } = await addUser(page.request, "Sam Smith", "sam");
  const sam = await loggedIn(browser, "sam", password);
  await addNote(sam, "Sam's note");
  await sam.getByRole("link", { name: "Settings" }).click();
  const samStats = (await (await sam.request.get("/api/me/stats")).json()) as Stats;
  expect(samStats.noteCount).toBe(1);
  await expect(sam.locator(".note-stats")).toHaveText(
    `You have 1 note, taking up ${shownSize(samStats.noteBytes)}, plus ${shownSize(samStats.historyBytes)} for their History.`,
  );

  await openUsersPage(page);
  await expect(userRow(page, ADMIN)).toContainText(
    `9 of 1000 notes · 1 of 50 stylus notes · ${shownSize(stats.noteBytes)} · ${shownSize(stats.historyBytes)} History`,
  );
  await expect(userRow(page, "sam")).toContainText(`1 of 1000 notes · 0 of 50 stylus notes · ${shownSize(samStats.noteBytes)} · ${shownSize(samStats.historyBytes)} History`);
  const all = stats.noteBytes + stats.historyBytes + samStats.noteBytes + samStats.historyBytes;
  await expect(page.locator(".note-stats").first()).toHaveText(`All users: 10 notes, ${shownSize(all)} with their History.`);
  // The whole database, from pg_database_size: more than the notes and History alone.
  const database = (await (await page.request.get("/api/users/database-size")).json()) as { bytes: number };
  expect(database.bytes).toBeGreaterThan(all);
  await expect(page.locator(".database-size")).toHaveText(
    /^The whole database takes up \d+(\.\d)? (KB|MB) of its 500 MB, including indexes and its own overhead\.$/,
  );
  // Only the admin can see it.
  expect((await sam.request.get("/api/users/database-size")).status()).toBe(403);
});

test("each user has a note limit, set by the admin, shown to them only when they're near it", async ({ page, browser }) => {
  const { id, password } = await addUser(page.request, "Sam Smith", "sam");

  // The admin sets Sam's limit to 2 on the users page.
  await openUsersPage(page);
  await userRow(page, "sam").getByRole("button", { name: "Edit" }).click();
  await expect(page.getByLabel("Note limit")).toHaveValue("1000");
  await page.getByLabel("Note limit").fill("2");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(userRow(page, "sam")).toContainText("0 of 2 notes");
  // Out of range is refused.
  expect((await page.request.put(`/api/users/${id}`, { data: { noteLimit: 0 } })).status()).toBe(400);

  const sam = await loggedIn(browser, "sam", password);
  await addNote(sam, "First");
  // 1 of 2 isn't within 20% of the limit, so it isn't mentioned.
  await sam.getByRole("link", { name: "Settings" }).click();
  await expect(sam.locator(".note-stats")).toHaveText(/^You have 1 note, taking up /);
  await sam.getByRole("link", { name: "← Notes" }).click();
  await addNote(sam, "Second");
  await sam.getByRole("link", { name: "Settings" }).click();
  await expect(sam.locator(".note-stats")).toHaveText(/^You have 2 of your 2 notes, taking up /);
  await sam.getByRole("link", { name: "← Notes" }).click();

  // At the limit, adding is refused and the title is kept.
  const box = sam.getByRole("textbox", { name: "New note" });
  await box.fill("Third");
  await box.press("Enter");
  await expect(sam.getByRole("alert")).toContainText("You've reached your limit of 2 notes. Empty the Bin to make room, or ask the admin for a higher limit.");
  await expect(box).toHaveValue("Third");
  await expect(noteRow(sam, "Third")).toHaveCount(0);
});

/** A tiny handwritten image (a 1×1 PNG). */
const INK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

test("stylus notes are limited to 5% of the note limit", async ({ page, browser }) => {
  const { password } = await addUser(page.request, "Sam Smith", "sam");
  await openUsersPage(page);
  await userRow(page, "sam").getByRole("button", { name: "Edit" }).click();
  await expect(page.getByText("5% of them can be stylus notes: 50 stylus notes.")).toBeVisible();
  // 5% of 40 is 2.
  await page.getByLabel("Note limit").fill("40");
  await expect(page.getByText("5% of them can be stylus notes: 2 stylus notes.")).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(userRow(page, "sam")).toContainText("0 of 40 notes · 0 of 2 stylus notes");

  const sam = await loggedIn(browser, "sam", password);
  const add = (data: object) => sam.request.post("/api/notes", { data: { tagIds: [], ...data } });
  // A handwritten note, and a long-form note with handwritten details (still empty): the 2 allowed.
  expect((await add({ titleImage: INK })).status()).toBe(201);
  const longForm = await add({ titleText: "Long", detailsImage: "" });
  expect(longForm.status()).toBe(201);
  // A third is refused, either kind, but typed notes can still be added.
  const third = await add({ titleImage: INK });
  expect(third.status()).toBe(409);
  expect(((await third.json()) as { error: string }).error).toBe(
    "You've reached your limit of 2 stylus notes. Empty the Bin to make room, or ask the admin for a higher limit.",
  );
  expect((await add({ titleText: "Long 2", detailsImage: "" })).status()).toBe(409);
  const typed = await add({ titleText: "Typed" });
  expect(typed.status()).toBe(201);
  expect((await add({ titleText: "Typed long-form", detailsText: "" })).status()).toBe(201);
  // Converting a typed note to handwritten long-form is refused too; to typed long-form it isn't.
  const typedId = ((await typed.json()) as { id: number }).id;
  expect((await sam.request.put(`/api/notes/${typedId}`, { data: { titleText: "Typed", tagIds: [], detailsImage: "" } })).status()).toBe(409);
  expect((await sam.request.put(`/api/notes/${typedId}`, { data: { titleText: "Typed", tagIds: [], detailsText: "" } })).status()).toBe(200);
  // Stylus notes already there can still be edited.
  const longFormId = ((await longForm.json()) as { id: number }).id;
  expect((await sam.request.put(`/api/notes/${longFormId}`, { data: { titleText: "Long", tagIds: [], detailsImage: INK } })).status()).toBe(200);

  // Sam is at the stylus limit, so Settings mentions it (but not the note limit: 4 of 40).
  await sam.goto("/settings");
  await expect(sam.locator(".note-stats")).toHaveText(/^You have 4 notes, taking up .+\. You have 2 of your 2 stylus notes\.$/);
  await openUsersPage(page);
  await expect(userRow(page, "sam")).toContainText("4 of 40 notes · 2 of 2 stylus notes");
});
