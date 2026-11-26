import type { APIRequestContext, Browser, Page } from "@playwright/test";
import { addArea, expect, logIn, noteRow, openNotes, pills, shareTag, sharingRequestLink, test } from "./fixtures";

/*
 * Sharing tags, in the app: the owner's share dialog, and what a recipient sees and can do. The seed is
 * the admin's: "Buy milk" has Home and Shopping (Topic category, orange); "Garden ideas" has Home and Ideas.
 */

const SHOPPING = 4;

/** The admin adds a user, who logs in on a new device: their notes page. */
async function newUserPage(admin: APIRequestContext, browser: Browser, displayName: string, loginName: string): Promise<Page> {
  const made = await admin.post("/api/users", { data: { displayName, loginName } });
  expect(made.status()).toBe(201);
  const { password } = (await made.json()) as { password: string };
  const use = test.info().project.use;
  const context = await browser.newContext({
    baseURL: use.baseURL,
    viewport: use.viewport,
    hasTouch: use.hasTouch,
    isMobile: use.isMobile,
    userAgent: use.userAgent,
    timezoneId: use.timezoneId,
    locale: use.locale,
    serviceWorkers: "block",
    storageState: { cookies: [], origins: [] },
  });
  await context.addInitScript(() => localStorage.setItem("nwsnotes.fullTagList", "off"));
  const page = await context.newPage();
  await page.goto("/");
  await logIn(page, loginName, password);
  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  return page;
}

/** Shares a tag with one person (accepting for them if they're asked first). */
async function shareThroughApi(owner: APIRequestContext, tagId: number, loginName: string, permission: string) {
  await shareTag(owner, tagId, [{ loginName, permission }]);
}

test("the owner shares a tag from its category page", async ({ page, browser }) => {
  const sam = await newUserPage(page.request, browser, "Sam Smith", "sam@example.com");
  await page.goto("/settings/categories/2");
  // A tag that isn't saved yet can't be shared.
  await page.getByRole("button", { name: "Add tag" }).click();
  await expect(page.getByRole("button", { name: "Share tag 4" })).toBeDisabled();

  await page.getByRole("button", { name: "Share Shopping" }).click();
  const dialog = page.getByRole("dialog", { name: "Share Shopping" });
  await expect(dialog.getByText("It isn't shared with anyone.")).toBeVisible();
  // Nobody is linked yet, so the email address is typed.
  await dialog.getByLabel("Their email address").fill("nobody@example.com");
  await dialog.getByRole("button", { name: "Add" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("The sharing wasn't saved: There's no nwsnotes account for nobody@example.com.");
  await dialog.getByRole("button", { name: "Stop sharing with nobody@example.com" }).click();
  await dialog.getByLabel("Their email address").fill("sam@example.com");
  await dialog.getByRole("button", { name: "Add" }).click();
  await dialog.getByLabel("What sam@example.com may do").selectOption("edit");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  // Sam has never been linked with the admin, so is emailed to ask first, and the admin is told so.
  const told = page.getByRole("dialog");
  await expect(told).toHaveText(
    "Sam Smith will get an email that you want to share Shopping tagged notes with them. They will see the notes after they click the 'accept' link in the email.OK",
  );
  await expect(told.getByRole("button")).toHaveText(["OK"]);
  await told.getByRole("button", { name: "OK" }).click();
  await expect(told).toHaveCount(0);

  // Opened again, it lists Sam by name, waiting: Sam had never been linked with the admin, so is asked first.
  await page.getByRole("button", { name: "Share Shopping" }).click();
  await expect(dialog.getByLabel("What Sam Smith may do")).toHaveValue("edit");
  await expect(dialog.getByText("Waiting for them to accept")).toBeVisible();
  // Saving again doesn't ask again (Sam was already emailed), so there's nothing to tell.
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // The tag shows an hourglass in place of the sharing icon, here and in Settings; its pills show nothing yet.
  const shoppingRow = page.locator(".tag-row", { has: page.getByRole("button", { name: "Share Shopping" }) });
  const waiting = { name: "Shared by you; waiting for someone to accept" };
  await expect(shoppingRow.getByRole("img", waiting)).toBeVisible();
  await page.getByRole("link", { name: "← Settings" }).click();
  await expect(page.locator(".category-tags > span", { hasText: "Shopping" }).getByRole("img", waiting)).toBeVisible();
  await openNotes(page);
  await expect(pills(noteRow(page, "Buy milk")).filter({ hasText: "Shopping" }).locator(".sharing-icons")).toHaveCount(0);

  // Sam sees nothing until accepting, on the page the emailed link opens.
  await sam.goto("/");
  await expect(sam.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(noteRow(sam, "Buy milk")).toHaveCount(0);
  await sam.goto(await sharingRequestLink(page.request, "sam@example.com"));
  await expect(sam.getByText('Admin (admin@example.com) would like to share their notes tagged “Shopping” with you.')).toBeVisible();
  await sam.getByRole("button", { name: "Yes, accept" }).click();
  await expect(sam.getByRole("status")).toHaveText('You can now see the notes Admin has shared with you, in "Shared with me".');

  // Sam's notes show it, with only the shared tag; the admin's hourglass becomes the sharing icon (a live update).
  await openNotes(sam);
  await expect(noteRow(sam, "Buy milk")).toBeVisible();
  await expect(pills(noteRow(sam, "Buy milk"))).toHaveText(["Shopping (Admin)", "New"]);
  await expect(noteRow(sam, "Garden ideas")).toHaveCount(0);
  await expect(pills(noteRow(page, "Buy milk")).filter({ hasText: "Shopping" }).getByRole("img", { name: "Shared by you; someone can edit" })).toBeVisible();
  await page.goto("/settings");
  await expect(page.locator(".category-tags > span", { hasText: "Shopping" }).getByRole("img", { name: "Shared by you; someone can edit" })).toBeVisible();
  await expect(page.getByRole("img", waiting)).toHaveCount(0);
  await sam.context().close();
});

test("someone asked to accept a share can turn it down, and the owner is told", async ({ page, browser }) => {
  const sam = await newUserPage(page.request, browser, "Sam", "sam@example.com");
  const response = await page.request.put(`/api/tags/${SHOPPING}/shares`, { data: { shares: [{ loginName: "sam@example.com", permission: "read" }] } });
  expect(response.ok()).toBe(true);
  const link = await sharingRequestLink(page.request, "sam@example.com");

  await sam.goto(link);
  await sam.getByRole("button", { name: "No, turn it down" }).click();
  await expect(sam.getByRole("status")).toHaveText("You won't see Admin's notes. We've let them know.");
  // The share is gone, and the admin gets an email saying so.
  expect(await (await page.request.get(`/api/tags/${SHOPPING}/shares`)).json()).toEqual([]);
  const emails = (await (await page.request.get("/api/test/emails")).json()) as { subject: string; text: string }[];
  expect(emails.map((email) => email.subject)).toEqual(["Sam didn't accept your sharing on nwsnotes"]);
  expect(emails[0]!.text).toContain('Sam (sam@example.com) chose not to accept your request to share "Shopping" with them on nwsnotes.');
  // The link doesn't work again (opened afresh: going to it from its own page would only change the #).
  await sam.goto("about:blank");
  await sam.goto(link);
  await expect(sam.getByRole("alert")).toHaveText("This sharing request has already been answered, or is no longer waiting.");
  await sam.goto("/");
  await expect(sam.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(noteRow(sam, "Buy milk")).toHaveCount(0);
  await sam.context().close();
});

test('a recipient stops viewing a shared tag from "Shared with me", after confirming, and the owner is told', async ({ page, browser }) => {
  const HOME = 2;
  const sam = await newUserPage(page.request, browser, "Sam", "sam@example.com");
  await shareThroughApi(page.request, SHOPPING, "sam@example.com", "read");
  await shareThroughApi(page.request, HOME, "sam@example.com", "read");
  await sam.goto(`/settings/categories/-2`);
  const leave = sam.getByRole("button", { name: "Stop viewing Shopping (Admin)" });

  // Cancelling leaves it as it was.
  await leave.click();
  const confirm = sam.getByRole("dialog");
  await expect(confirm).toContainText("Stop viewing “Shopping (Admin)”?");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(leave).toBeVisible();

  await leave.click();
  await confirm.getByRole("button", { name: "Stop viewing" }).click();
  await expect(leave).toHaveCount(0);
  await expect(sam.getByRole("button", { name: "Stop viewing Home (Admin)" })).toBeVisible();
  // The admin is emailed, and their Shopping is no longer shared.
  const emails = (await (await page.request.get("/api/test/emails")).json()) as { subject: string; text: string }[];
  expect(emails.map((email) => email.subject)).toEqual(['Sam stopped viewing "Shopping" on nwsnotes']);
  expect(emails[0]!.text).toContain('Sam (sam@example.com) has stopped viewing your shared tag "Shopping" on nwsnotes.');
  expect(await (await page.request.get(`/api/tags/${SHOPPING}/shares`)).json()).toEqual([]);

  // Saving keeps the rest; Sam sees Home's notes but not Buy milk's Shopping.
  await sam.getByRole("button", { name: "Save" }).click();
  await expect(sam).toHaveURL(/\/settings$/);
  await openNotes(sam);
  await expect(pills(noteRow(sam, "Buy milk"))).toHaveText(["Home (Admin)", "New"]);

  // Leaving the last one takes the category away, and goes back to Settings.
  await sam.goto(`/settings/categories/-2`);
  await sam.getByRole("button", { name: "Stop viewing Home (Admin)" }).click();
  await sam.getByRole("dialog").getByRole("button", { name: "Stop viewing" }).click();
  await expect(sam).toHaveURL(/\/settings$/);
  await expect(sam.locator(".category-list", { hasText: "Shared with me" })).toHaveCount(0);
  await sam.context().close();
});

test("a recipient's buttons follow their permission, and they can't change tags or due dates", async ({ page, browser }) => {
  const sam = await newUserPage(page.request, browser, "Sam", "sam@example.com");
  await shareThroughApi(page.request, SHOPPING, "sam@example.com", "read");
  await openNotes(sam);
  const milk = noteRow(sam, "Buy milk");
  // Read-only: no buttons, just the eye.
  await expect(milk.getByRole("button")).toHaveCount(0);
  await expect(milk.locator(".read-only-mark")).toHaveAttribute("title", "Shared by Admin, to read only");

  // Edit: edit, Waiting and Archive, but no Move to bin once archived.
  await shareThroughApi(page.request, SHOPPING, "sam@example.com", "edit");
  await expect(milk.getByRole("button", { name: "Edit note" })).toBeVisible();
  await milk.getByRole("button", { name: "Archive" }).click();
  await expect(milk.getByRole("button", { name: "Reinstate" })).toBeVisible();
  await expect(milk.getByRole("button", { name: "Move to bin" })).toHaveCount(0);
  await milk.getByRole("button", { name: "Reinstate" }).click();

  // Editing: the title can change; the tags can't, and there's no due date button.
  await milk.getByRole("button", { name: "Edit note" }).click();
  await sam.getByRole("button", { name: "Show all tags" }).click();
  await expect(addArea(sam).getByRole("button", { name: "Shopping (Admin)" })).toBeDisabled();
  await expect(sam.getByRole("button", { name: "Set due date" })).toHaveCount(0);
  const box = sam.getByRole("textbox", { name: "Note title" });
  await box.fill("Buy oat milk");
  await box.press("Enter");
  await expect(noteRow(sam, "Buy oat milk")).toBeVisible();
  await openNotes(page);
  await expect(pills(noteRow(page, "Buy oat milk"))).toHaveText(["Home", "Shopping"]);

  // Edit and delete: Move to bin too.
  await shareThroughApi(page.request, SHOPPING, "sam@example.com", "delete");
  await noteRow(sam, "Buy oat milk").getByRole("button", { name: "Archive" }).click();
  await expect(noteRow(sam, "Buy oat milk").getByRole("button", { name: "Move to bin" })).toBeVisible();
  await sam.context().close();
});

test("a recipient adds notes to a shared tag, and sets its colour and order for themselves", async ({ page, browser }) => {
  const sam = await newUserPage(page.request, browser, "Sam", "sam@example.com");
  await shareThroughApi(page.request, SHOPPING, "sam@example.com", "edit");
  // Sam's tab on the shared tag.
  const tab = await sam.request.post("/api/tabs", { data: { name: "Shop", categories: [{ categoryId: -2, tagIds: [SHOPPING] }] } });
  expect(tab.ok()).toBe(true);
  await openNotes(sam, "/");
  await sam.getByRole("tab", { name: "Shop" }).click();
  const box = sam.getByRole("textbox", { name: "New note" });
  await box.fill("Eggs");
  await box.press("Enter");
  await expect(noteRow(sam, "Eggs")).toBeVisible();
  // It's the admin's note, and shows on the admin's open page.
  await openNotes(page);
  await expect(pills(noteRow(page, "Eggs"))).toHaveText(["Shopping", "New"]);

  // Sam's own colour for Shopping, on the "Shared with me" page; the admin's orange is untouched.
  await sam.goto("/settings");
  await expect(sam.locator(".category-list").first()).toContainText("Shopping (Admin)");
  await sam.getByRole("link", { name: /^Shared with me/ }).click();
  await expect(sam.getByRole("heading", { name: "Shared with me" })).toBeVisible();
  await expect(sam.getByRole("textbox")).toHaveCount(0);
  await expect(sam.getByRole("button", { name: /^Delete tag/ })).toHaveCount(0);
  await sam.getByRole("button", { name: /^Colour of Shopping/ }).click();
  await sam.getByRole("button", { name: "Hue 200°" }).click();
  await sam.getByRole("button", { name: "Set colour" }).click();
  await sam.getByRole("button", { name: "Save" }).click();
  await expect(sam.getByRole("heading", { name: "Settings" })).toBeVisible();
  const samTags = (await (await sam.request.get("/api/notes")).json()) as { categories: { id: number; tags: { id: number; hue?: number }[] }[] };
  expect(samTags.categories.find((c) => c.id === -2)!.tags[0]!.hue).toBe(200);
  const adminTags = (await (await page.request.get("/api/notes")).json()) as typeof samTags;
  expect(adminTags.categories.flatMap((c) => c.tags).find((t) => t.id === SHOPPING)!.hue).toBe(30);
  await sam.context().close();
});

test("a shared tag's pills always show its owner's name", async ({ page, browser }) => {
  const robin = await newUserPage(page.request, browser, "Christopher Robin", "robin@example.com");
  const sam = await newUserPage(page.request, browser, "Sam", "sam@example.com");
  const category = await robin.request.post("/api/categories", { data: { name: "Lists", multiSelect: false, tags: [{ name: "Shopping" }] } });
  const robinShopping = ((await category.json()) as { tags: { id: number }[] }).tags[0]!.id;
  expect((await robin.request.post("/api/notes", { data: { titleText: "Bread", tagIds: [robinShopping] } })).ok()).toBe(true);
  await shareThroughApi(robin.request, robinShopping, "sam@example.com", "read");
  await shareThroughApi(page.request, SHOPPING, "sam@example.com", "read");

  await openNotes(sam);
  // Each pill says whose it is; a long name is cut to 10 letters. Hovering shows the category, as for your own tags.
  await expect(pills(noteRow(sam, "Bread"))).toHaveText(["Shopping (Christophe…)", "New"]);
  await expect(pills(noteRow(sam, "Buy milk"))).toHaveText(["Shopping (Admin)", "New"]);
  await expect(pills(noteRow(sam, "Buy milk")).first()).toHaveAttribute("title", "Shared with me");
  await robin.context().close();
  await sam.context().close();
});

test("the owner's shared tags show people with what they may do, on their notes' pills, on tabs that filter on them and in Settings", async ({ page, browser }) => {
  const HOME = 2;
  const sam = await newUserPage(page.request, browser, "Sam", "sam@example.com");
  await newUserPage(page.request, browser, "Pat", "pat@example.com").then((pat) => pat.context().close());
  await openNotes(page);
  const shoppingPill = pills(noteRow(page, "Buy milk")).filter({ hasText: "Shopping" });
  const homeTab = page.getByRole("tab", { name: /^Home/ });
  // Not shared yet: no icons.
  await expect(page.locator(".sharing-icons")).toHaveCount(0);

  // Read only: just people. The pill's and the tab's text stay the same.
  await shareThroughApi(page.request, SHOPPING, "sam@example.com", "read");
  await shareThroughApi(page.request, HOME, "sam@example.com", "read");
  const readOnly = shoppingPill.getByRole("img", { name: "Shared by you, to read only" });
  await expect(readOnly).toBeVisible();
  await expect(readOnly.locator("svg")).toHaveCount(1);
  await expect(readOnly.locator("svg[data-permission=read]")).toHaveCount(1);
  await expect(shoppingPill).toHaveText("Shopping");
  await expect(homeTab.getByRole("img", { name: "Shared by you, to read only" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /^Work/ }).locator(".sharing-icons")).toHaveCount(0);

  // The most generous share decides: edit adds a pencil, edit and delete a trash can.
  const both = (sam: string, pat: string) => [{ loginName: "sam@example.com", permission: sam }, { loginName: "pat@example.com", permission: pat }];
  await shareTag(page.request, SHOPPING, both("read", "edit"));
  await expect(shoppingPill.getByRole("img", { name: "Shared by you; someone can edit" })).toBeVisible();
  await expect(shoppingPill.locator(".sharing-icons svg[data-permission=edit]")).toHaveCount(1);
  await shareTag(page.request, HOME, both("delete", "read"));
  await expect(homeTab.getByRole("img", { name: "Shared by you; someone can edit and delete" })).toBeVisible();
  await expect(homeTab.locator(".sharing-icons svg[data-permission=delete]")).toHaveCount(1);

  // They stay after the categories are reordered, and go when the sharing stops.
  await page.goto("/settings");
  await page.getByRole("button", { name: "Move down Area" }).click();
  // The categories' summary in Settings, and the tag's category page, show them too.
  const canEdit = { name: "Shared by you; someone can edit" };
  await expect(page.locator(".category-tags > span", { hasText: "Shopping" }).getByRole("img", canEdit)).toBeVisible();
  await expect(page.locator(".category-tags > span", { hasText: "Work" }).locator(".sharing-icons")).toHaveCount(0);
  await page.locator(".category-list a", { hasText: "Shopping" }).first().click();
  await expect(page.locator(".tag-row", { has: page.getByRole("button", { name: "Share Shopping" }) }).getByRole("img", canEdit)).toBeVisible();
  await expect(page.locator(".tag-row", { has: page.getByRole("button", { name: "Share Reading" }) }).locator(".sharing-icons")).toHaveCount(0);
  await page.getByRole("link", { name: "← Settings" }).click();
  await page.getByRole("link", { name: "← Notes" }).click();
  await expect(shoppingPill.locator(".sharing-icons")).toHaveCount(1);
  expect((await page.request.put(`/api/tags/${SHOPPING}/shares`, { data: { shares: [] } })).ok()).toBe(true);
  await expect(shoppingPill.locator(".sharing-icons")).toHaveCount(0);

  // The recipient sees no icons.
  await openNotes(sam);
  await expect(sam.locator(".sharing-icons")).toHaveCount(0);
  await sam.context().close();
});

test("the owner's shared tags show the icon in the tag pickers", async ({ page, browser }) => {
  await newUserPage(page.request, browser, "Sam", "sam@example.com").then((sam) => sam.context().close());
  await shareThroughApi(page.request, SHOPPING, "sam@example.com", "edit");
  await openNotes(page);
  const canEdit = { name: "Shared by you; someone can edit" };
  const icon = (scope: ReturnType<Page["locator"]>, name: string) =>
    scope.locator("label, button", { hasText: name }).locator(".sharing-icons");

  // The filter row's dropdown list. The icon doesn't change the tag's checkbox name.
  await page.getByRole("button", { name: /^Topic:/ }).first().click();
  const filterList = page.locator(".tag-dropdown-list");
  await expect(icon(filterList, "Shopping")).toHaveAttribute("title", canEdit.name);
  await expect(icon(filterList, "Reading")).toHaveCount(0);
  await expect(filterList.getByRole("checkbox", { name: "Shopping (1)" })).toBeVisible();
  await page.keyboard.press("Escape");

  // The add area's dropdowns (a category collapsed from pills).
  await addArea(page).getByRole("button", { name: "Show Topic as a dropdown" }).click();
  await addArea(page).getByRole("button", { name: /^Topic:/ }).click();
  await expect(icon(page.locator(".tag-dropdown-list"), "Shopping")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await addArea(page).getByRole("button", { name: "Show Topic as pills" }).click();

  // Its pills ("Show all tags") do, and so do multi-select's.
  await page.getByRole("button", { name: "Show all tags" }).click();
  await expect(icon(addArea(page), "Shopping")).toHaveCount(1);
  await expect(addArea(page).getByRole("button", { name: "Shopping", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Select notes to change their tags" }).click();
  await expect(icon(addArea(page), "Shopping")).toHaveCount(1);
  await page.getByRole("button", { name: "Stop selecting notes" }).click();

  // The tabs' list in Settings, and a tab's dropdowns.
  await page.goto("/settings");
  await page.getByRole("link", { name: "Add tab" }).click();
  await page.getByRole("button", { name: /^Topic:/ }).click();
  await expect(icon(page.locator(".tag-dropdown-list"), "Shopping")).toHaveCount(1);
  await page.getByRole("checkbox", { name: "Shopping" }).check();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Errands");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".category-list a", { hasText: "Errands" }).getByRole("img", canEdit)).toBeVisible();
});
