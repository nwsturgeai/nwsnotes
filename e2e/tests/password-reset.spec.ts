import { randomUUID } from "node:crypto";
import type { APIRequestContext, Browser, BrowserContext, Page } from "@playwright/test";
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

/** The admin adds a user through the API, returning their id and generated password. */
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

interface SentEmail {
  subject: string;
  text: string;
  html: string;
}

/** The emails the test server would have sent to this address, oldest first. */
async function emailsTo(request: APIRequestContext, to: string): Promise<SentEmail[]> {
  return (await (await request.get(`/api/test/emails?to=${encodeURIComponent(to)}`)).json()) as SentEmail[];
}

/** Asks for a link through the API, as the forgotten-password page does. */
function askForLink(request: APIRequestContext, loginName: string, headers?: Record<string, string>) {
  return request.post("/api/password-reset", { data: { loginName }, headers });
}

/** The link in the one reset email sent to this address (waiting for it, as it's sent after the answer). */
async function emailedLink(request: APIRequestContext, to: string): Promise<string> {
  await expect.poll(async () => (await emailsTo(request, to)).filter((email) => email.subject === "Choose a new nwsnotes password").length).toBe(1);
  const email = (await emailsTo(request, to)).find((sent) => sent.subject === "Choose a new nwsnotes password")!;
  const link = /Choose a new password: (\S+)/.exec(email.text)?.[1];
  expect(link, "the link in the email").toBeDefined();
  return link!;
}

/** A link's token, made by the test server with any expiry. */
async function tokenFor(request: APIRequestContext, loginName: string, expires?: number): Promise<string> {
  const response = await request.post("/api/test/password-reset-token", { data: { loginName, expires } });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { token: string }).token;
}

const checkLink = (request: APIRequestContext, token: string) => request.post("/api/password-reset/check", { data: { token } });

const LINK_NOT_WORKING = "This link has expired or has already been used.";

/** Waits for a page to be sent back to the login page. */
async function expectLoggedOut(page: Page) {
  await expect(page.getByLabel("Email")).toBeVisible({ timeout: 15_000 });
}

test("a forgotten password: the login page's link emails one to choose a new password, which logs out the other devices", async ({
  page,
  browser,
}) => {
  const { password } = await addUser(page.request, "Kim", "kim@example.com");
  const kimElsewhere = await loggedIn(browser, "kim@example.com", password);

  // The login page's link carries the typed email over.
  const device = await (await newDevice(browser)).newPage();
  await device.goto("/");
  await device.getByLabel("Email").fill("kim@example.com");
  await device.getByRole("link", { name: "Forgot your password?" }).click();
  await expect(device).toHaveURL(/\/forgot-password#email=kim%40example\.com$/);
  await expect(device.getByRole("heading", { name: "Forgot your password?" })).toBeVisible();
  await expect(device.getByLabel("Email")).toHaveValue("kim@example.com");

  // Checked in the page.
  await device.getByLabel("Email").fill("kim");
  await device.getByRole("button", { name: "Send the link" }).click();
  await expect(device.getByRole("alert")).toHaveText("Please enter your email address, e.g. pat@example.com.");

  await device.getByLabel("Email").fill("Kim@Example.com");
  await device.getByRole("button", { name: "Send the link" }).click();
  await expect(device.getByRole("status")).toContainText(
    "If Kim@Example.com has an account, we've sent it a link to choose a new password. The link works for an hour.",
  );
  await expect(device.getByRole("status")).toContainText("check your junk folder, or ask the admin to reset your password.");

  // The email, with the link on the test server's own address.
  const link = await emailedLink(page.request, "kim@example.com");
  const [email] = await emailsTo(page.request, "kim@example.com");
  expect(email!.text).toContain("Hello Kim,");
  expect(email!.text).toContain("Someone (hopefully you) asked to reset the password for your nwsnotes account, kim@example.com.");
  expect(email!.text).toContain("The link works once, for an hour. If you didn't ask for it, ignore this email: your password hasn't changed.");
  expect(email!.html).toContain(`<a href="${link}">Choose a new password</a>`);
  expect(link).toMatch(/^http:\/\/localhost:\d+\/reset-password#\d+\.\d+\.[\w-]+$/);

  // Following it: the token is taken out of the address bar straight away.
  await device.goto(link);
  await expect(device.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  await expect(device.getByText("For kim@example.com.")).toBeVisible();
  await expect(device).toHaveURL(/\/reset-password$/);

  const newPassword = device.getByLabel("New password", { exact: true });
  const again = device.getByLabel("New password again");
  const change = device.getByRole("button", { name: "Change password" });
  await newPassword.fill("too short");
  await again.fill("too short");
  await change.click();
  await expect(device.getByRole("alert")).toHaveText("The new password must be at least 10 characters.");
  await newPassword.fill("my new long password");
  await again.fill("a different password");
  await change.click();
  await expect(device.getByRole("alert")).toHaveText("The new passwords don't match.");
  await again.fill("my new long password");
  await change.click();

  // The login page, with the email filled in.
  await expect(device.getByRole("status")).toHaveText("Password changed. Log in with your new password.");
  await expect(device.getByLabel("Email")).toHaveValue("kim@example.com");

  // The other device is logged out.
  await expectLoggedOut(kimElsewhere);

  // The old password no longer works; the new one does.
  await device.getByLabel("Password").fill(password);
  await device.getByRole("button", { name: "Log in" }).click();
  await expect(device.getByRole("alert")).toHaveText("Incorrect email or password.");
  await logIn(device, "kim@example.com", "my new long password");
  await expect(device.getByRole("link", { name: "Settings" })).toBeVisible();

  // They're emailed to say it was changed.
  await expect.poll(async () => (await emailsTo(page.request, "kim@example.com")).map((sent) => sent.subject)).toEqual([
    "Choose a new nwsnotes password",
    "Your nwsnotes password was changed",
  ]);
  const changed = (await emailsTo(page.request, "kim@example.com"))[1]!;
  expect(changed.text).toContain("The password for your nwsnotes account, kim@example.com, has just been changed, using a link emailed to you.");
  expect(changed.text).toMatch(/choose a new password straight away at http:\/\/localhost:\d+\/forgot-password, and tell the admin\./);

  // The link works only once.
  await device.goto(link);
  await expect(device.getByRole("alert")).toHaveText(LINK_NOT_WORKING);
  await device.getByRole("link", { name: "Ask for a new link" }).click();
  await expect(device).toHaveURL(/\/forgot-password$/);

  await device.context().close();
  await kimElsewhere.context().close();
});

test("a link stops working once the password changes, when it expires, when it's changed, and when the account is turned off", async ({
  page,
  browser,
}) => {
  const { id, password } = await addUser(page.request, "Sam", "sam@example.com");

  // Two links: once one is used, the other stops working too.
  const first = await tokenFor(page.request, "sam@example.com");
  const second = await tokenFor(page.request, "sam@example.com", Date.now() + 30 * 60 * 1000);
  expect((await (await checkLink(page.request, first)).json()) as unknown).toEqual({ loginName: "sam@example.com" });
  const confirm = (token: string, newPassword = "another long password") =>
    page.request.post("/api/password-reset/confirm", { data: { token, newPassword } });
  // The server checks the new password too, and a refused one leaves the link working.
  const tooShort = await confirm(second, "short");
  expect(tooShort.status()).toBe(400);
  expect(((await tooShort.json()) as { error: string }).error).toBe("The new password must be at least 10 characters.");
  expect((await confirm(second)).status()).toBe(204);
  for (const token of [first, second]) {
    const response = await confirm(token);
    expect(response.status()).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe(LINK_NOT_WORKING);
  }

  // Changing the password in Settings stops an older link working.
  const sam = await loggedIn(browser, "sam@example.com", "another long password");
  const beforeSettings = await tokenFor(page.request, "sam@example.com");
  expect((await checkLink(page.request, beforeSettings)).status()).toBe(200);
  const changed = await sam.request.put("/api/me/password", { data: { currentPassword: "another long password", newPassword: "a third long password" } });
  expect(changed.ok()).toBe(true);
  expect((await checkLink(page.request, beforeSettings)).status()).toBe(400);

  // An expired link, and one cut short, show the page's message.
  const device = await (await newDevice(browser)).newPage();
  for (const token of [await tokenFor(page.request, "sam@example.com", Date.now() - 1000), (await tokenFor(page.request, "sam@example.com")).slice(0, -3)]) {
    await device.goto(`/reset-password#${token}`);
    await expect(device.getByRole("alert")).toHaveText(LINK_NOT_WORKING);
    await expect(device.getByRole("link", { name: "Ask for a new link" })).toBeVisible();
    await expect(device.getByLabel("New password", { exact: true })).toHaveCount(0);
  }
  // No token at all.
  await device.goto("/reset-password");
  await expect(device.getByRole("alert")).toHaveText(LINK_NOT_WORKING);

  // A session cookie's value never passes as a link's token.
  const cookie = (await sam.context().cookies()).find((each) => each.name === "nwsnotes_session")!;
  expect((await checkLink(page.request, decodeURIComponent(cookie.value))).status()).toBe(400);

  // Turning the account off stops a link working.
  const beforeTurnedOff = await tokenFor(page.request, "sam@example.com");
  expect((await page.request.put(`/api/users/${id}`, { data: { disabled: true } })).ok()).toBe(true);
  expect((await checkLink(page.request, beforeTurnedOff)).status()).toBe(400);

  await device.context().close();
  await sam.context().close();
});

test("nobody is emailed for an unknown email, a turned-off account or a waiting request, and the answer is the same", async ({ page, browser }) => {
  const { id } = await addUser(page.request, "Off", "off@example.com");
  expect((await page.request.put(`/api/users/${id}`, { data: { disabled: true } })).ok()).toBe(true);
  const visitor = await newDevice(browser);
  expect((await visitor.request.post("/api/account-requests", { data: { loginName: "waiting@example.com", displayName: "Wait", password: "a long password" } })).status()).toBe(201);

  for (const email of ["nobody@example.com", "off@example.com", "waiting@example.com"]) {
    expect((await askForLink(visitor.request, email)).status()).toBe(204);
  }
  // The page says the same as for an account.
  const device = await visitor.newPage();
  await device.goto("/forgot-password");
  await device.getByLabel("Email").fill("nobody@example.com");
  await device.getByRole("button", { name: "Send the link" }).click();
  await expect(device.getByRole("status")).toContainText("If nobody@example.com has an account, we've sent it a link");

  // A real account's email, asked for afterwards, arrives; the others never do.
  await addUser(page.request, "Real", "real@example.com");
  expect((await askForLink(visitor.request, "real@example.com")).status()).toBe(204);
  await emailedLink(page.request, "real@example.com");
  for (const email of ["nobody@example.com", "off@example.com", "waiting@example.com"]) {
    expect(await emailsTo(page.request, email)).toEqual([]);
  }
  await visitor.close();
});

test("at most one link is emailed to an account every 5 minutes, and an address can ask 5 times an hour", async ({ page }) => {
  await addUser(page.request, "Pat", "pat@example.com");
  expect((await askForLink(page.request, "pat@example.com")).status()).toBe(204);
  await emailedLink(page.request, "pat@example.com");
  expect((await askForLink(page.request, "pat@example.com")).status()).toBe(204);
  // Still only the one email, a moment later.
  await page.waitForTimeout(500);
  expect((await emailsTo(page.request, "pat@example.com")).length).toBe(1);

  // Counted by this test's own client id, as the tests all come from one address.
  const client = { "x-test-client": randomUUID() };
  for (let ask = 1; ask <= 5; ask++) expect((await askForLink(page.request, `someone${ask}@example.com`, client)).status()).toBe(204);
  const refused = await askForLink(page.request, "someone6@example.com", client);
  expect(refused.status()).toBe(429);
  expect(((await refused.json()) as { error: string }).error).toBe("Too many requests from here. Please wait an hour and try again.");
});
