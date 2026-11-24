import { request as apiRequest, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { expect, logIn, test } from "./fixtures";

/** Another device, logged out, with this project's screen and settings. */
async function newDevice(browser: Browser): Promise<BrowserContext> {
  const use = test.info().project.use;
  return browser.newContext({
    baseURL: use.baseURL,
    viewport: use.viewport,
    hasTouch: use.hasTouch,
    isMobile: use.isMobile,
    userAgent: use.userAgent,
    serviceWorkers: "block",
    storageState: { cookies: [], origins: [] },
  });
}

/** The admin adds a user through the API, returning their generated password. */
async function addUser(request: APIRequestContext, displayName: string, loginName: string): Promise<string> {
  const response = await request.post("/api/users", { data: { displayName, loginName } });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { password: string }).password;
}

/** A page on a new device, logged in as this user and showing their notes page. */
async function loggedIn(browser: Browser, loginName: string, password: string): Promise<Page> {
  const page = await (await newDevice(browser)).newPage();
  await page.goto("/");
  await logIn(page, loginName, password);
  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  return page;
}

interface SentEmail {
  subject: string;
  text: string;
}

async function emailsTo(request: APIRequestContext, to: string): Promise<SentEmail[]> {
  return (await (await request.get(`/api/test/emails?to=${encodeURIComponent(to)}`)).json()) as SentEmail[];
}

const LINK_SUBJECT = "Confirm your new nwsnotes email";
const CHANGED_SUBJECT = "Your nwsnotes email was changed";
const LINK_NOT_WORKING = "This link has expired or has already been used. Ask for a new one in Settings.";

/** The link in the latest email-change email sent to this address. */
async function emailedLink(request: APIRequestContext, to: string): Promise<string> {
  const emails = (await emailsTo(request, to)).filter((email) => email.subject === LINK_SUBJECT);
  expect(emails.length, "email-change emails").toBeGreaterThan(0);
  const link = /Confirm the new email: (\S+)/.exec(emails.at(-1)!.text)?.[1];
  expect(link, "the link in the email").toBeDefined();
  return link!;
}

/** Asks to change the email from this page's Settings. */
async function askToChangeEmail(page: Page, newEmail: string, password: string) {
  await page.goto("/settings/email");
  await page.getByLabel("New email").fill(newEmail);
  await page.getByLabel("Current password").fill(password);
  await page.getByRole("button", { name: "Send the link" }).click();
}

/** Tries logging in from a separate, logged-out client (so the test's own login isn't replaced), returning the status. */
async function loginStatus(_request: APIRequestContext, loginName: string, password: string): Promise<number> {
  const client = await apiRequest.newContext({ baseURL: test.info().project.use.baseURL, storageState: { cookies: [], origins: [] } });
  try {
    return (await client.post("/api/login", { data: { loginName, password } })).status();
  } finally {
    await client.dispose();
  }
}

test("changing your own name in Settings, which the people you share with see", async ({ page, browser }) => {
  const password = await addUser(page.request, "Pat", "pat@example.com");
  const pat = await loggedIn(browser, "pat@example.com", password);
  await pat.goto("/settings");
  await pat.getByRole("button", { name: "Change name" }).click();
  await expect(pat).toHaveURL(/\/settings\/name$/);
  const name = pat.getByLabel("Your name");
  await expect(name).toHaveValue("Pat");

  await name.fill("   ");
  await pat.getByRole("button", { name: "Save name" }).click();
  await expect(pat.getByRole("alert")).toHaveText("Please enter your name.");

  await name.fill("Pat Smith");
  await pat.getByRole("button", { name: "Save name" }).click();
  await expect(pat).toHaveURL(/\/settings$/);
  await expect(pat.getByText("Name changed.")).toBeVisible();
  await expect(pat.getByText("Logged in as Pat Smith (pat@example.com)")).toBeVisible();
  expect(((await (await pat.request.get("/api/me")).json()) as { displayName: string }).displayName).toBe("Pat Smith");

  // The server's checks.
  expect((await pat.request.put("/api/me/name", { data: { displayName: "" } })).status()).toBe(400);
  expect((await pat.request.put("/api/me/name", { data: { displayName: "x".repeat(61) } })).status()).toBe(400);
  await pat.context().close();
});

test("changing your own email: a link to the new one makes the change, and the old one is told", async ({ page, browser }) => {
  const password = await addUser(page.request, "Pat", "pat@example.com");
  await addUser(page.request, "Sam", "sam@example.com");
  const pat = await loggedIn(browser, "pat@example.com", password);
  await pat.goto("/settings");
  await pat.getByRole("button", { name: "Change email" }).click();
  await expect(pat).toHaveURL(/\/settings\/email$/);
  await expect(pat.getByText("You log in with pat@example.com.")).toBeVisible();

  // The page's and the server's checks.
  await askToChangeEmail(pat, "not an email", password);
  await expect(pat.getByRole("alert")).toHaveText("Please enter your new email address, e.g. pat@example.com.");
  await askToChangeEmail(pat, "pat.new@example.com", "wrong password");
  await expect(pat.getByRole("alert")).toHaveText("The current password isn't right.");
  await askToChangeEmail(pat, "pat@example.com", password);
  await expect(pat.getByRole("alert")).toHaveText("That's already your email.");
  await askToChangeEmail(pat, "SAM@example.com", password);
  await expect(pat.getByRole("alert")).toHaveText("There's already an account, or a request for one, with that email.");
  expect(await emailsTo(page.request, "pat.new@example.com")).toEqual([]);

  await askToChangeEmail(pat, "pat.new@example.com", password);
  await expect(pat).toHaveURL(/\/settings$/);
  await expect(pat.getByText("We've sent a link to pat.new@example.com.", { exact: false })).toBeVisible();
  // Nothing changes until the link is opened.
  await expect(pat.getByText("Logged in as Pat (pat@example.com)")).toBeVisible();
  expect(await loginStatus(page.request, "pat@example.com", password)).toBe(200);

  const link = await emailedLink(page.request, "pat.new@example.com");
  expect(link.startsWith(`${new URL(test.info().project.use.baseURL!).origin}/confirm-email#`)).toBe(true);
  const email = (await emailsTo(page.request, "pat.new@example.com"))[0]!;
  expect(email.text).toContain("from pat@example.com to this address, pat.new@example.com");

  // Opened on another device, logged out: it asks first, then changes it.
  const other = await (await newDevice(browser)).newPage();
  await other.goto(link);
  await expect(other.getByText("Change the email you log in with from pat@example.com to pat.new@example.com?")).toBeVisible();
  expect(new URL(other.url()).hash).toBe("");
  await other.getByRole("button", { name: "Confirm" }).click();
  await expect(other.getByRole("status")).toHaveText("You now log in with pat.new@example.com. You're still logged in on your devices.");

  // Pat's open page shows it without a reload, and stays logged in.
  await expect(pat.getByText("Logged in as Pat (pat.new@example.com)")).toBeVisible();
  expect(await loginStatus(page.request, "pat.new@example.com", password)).toBe(200);
  expect(await loginStatus(page.request, "pat@example.com", password)).toBe(401);

  // The old address is told.
  await expect.poll(async () => (await emailsTo(page.request, "pat@example.com")).filter((sent) => sent.subject === CHANGED_SUBJECT).length).toBe(1);
  const notice = (await emailsTo(page.request, "pat@example.com")).find((sent) => sent.subject === CHANGED_SUBJECT)!;
  expect(notice.text).toContain("from this address, pat@example.com, to pat.new@example.com");

  // The link works only once. (From a blank page, as going to the same address but its # wouldn't load it again.)
  await other.goto("about:blank");
  await other.goto(link);
  await expect(other.getByRole("alert")).toHaveText(LINK_NOT_WORKING);
  const token = new URL(link).hash.slice(1);
  expect((await page.request.post("/api/email-change/confirm", { data: { token } })).status()).toBe(400);
  await other.context().close();
  await pat.context().close();
});

test("an email-change link stops working when the password changes, and changing the email stops older reset links", async ({ page, browser }) => {
  const password = await addUser(page.request, "Pat", "pat@example.com");
  const pat = await loggedIn(browser, "pat@example.com", password);
  await askToChangeEmail(pat, "pat.new@example.com", password);
  await expect(pat).toHaveURL(/\/settings$/);
  const staleLink = await emailedLink(page.request, "pat.new@example.com");

  const newPassword = "a much longer password";
  const changed = await pat.request.put("/api/me/password", { data: { currentPassword: password, newPassword } });
  expect(changed.ok()).toBe(true);
  const stale = await page.request.post("/api/email-change/check", { data: { token: new URL(staleLink).hash.slice(1) } });
  expect(stale.status()).toBe(400);
  expect(((await stale.json()) as { error: string }).error).toBe(LINK_NOT_WORKING);

  // A forgotten-password link sent to the old address before the email changes can't be used afterwards.
  const resetToken = ((await (await page.request.post("/api/test/password-reset-token", { data: { loginName: "pat@example.com" } })).json()) as { token: string }).token;
  expect((await page.request.post("/api/password-reset/check", { data: { token: resetToken } })).ok()).toBe(true);
  await askToChangeEmail(pat, "pat.new@example.com", newPassword);
  await expect(pat).toHaveURL(/\/settings$/);
  const link = await emailedLink(page.request, "pat.new@example.com");
  expect((await page.request.post("/api/email-change/confirm", { data: { token: new URL(link).hash.slice(1) } })).ok()).toBe(true);
  expect((await page.request.post("/api/password-reset/check", { data: { token: resetToken } })).status()).toBe(400);

  // A link cut short doesn't work either.
  const short = await (await newDevice(browser)).newPage();
  await short.goto(link.slice(0, -5));
  await expect(short.getByRole("alert")).toHaveText(LINK_NOT_WORKING);
  await short.context().close();
  await pat.context().close();
});
