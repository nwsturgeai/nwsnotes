import type { APIRequestContext, Browser, BrowserContext, Page } from "@playwright/test";
import { ADMIN, expect, logIn, test } from "./fixtures";

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

/** Fills in the sign-up page and sends it. */
async function signUp(page: Page, email: string, name: string, password: string, again = password) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Password again").fill(again);
  await page.getByRole("button", { name: "Ask for an account" }).click();
}

/** Asks for an account through the API, as the sign-up page does. */
async function requestAccount(request: APIRequestContext, loginName: string, displayName: string, password = "a long password") {
  return request.post("/api/account-requests", { data: { loginName, displayName, password } });
}

const waitingIcon = (page: Page) => page.getByRole("link", { name: /waiting to be confirmed/ });
const requestList = (page: Page) => page.getByRole("list", { name: "Waiting to be confirmed" });

test("asking for an account on the public sign-up page, which can't log in until it's confirmed", async ({ browser }) => {
  const device = await (await newDevice(browser)).newPage();
  await device.goto("/");
  await device.getByRole("link", { name: "No account yet? Ask for one" }).click();
  await expect(device).toHaveURL(/\/signup$/);
  await expect(device.getByRole("heading", { name: "Ask for an account" })).toBeVisible();

  // Checked in the page.
  await signUp(device, "robin", "Robin", "a long password");
  await expect(device.getByRole("alert")).toHaveText("Please enter your email address, e.g. pat@example.com.");
  await signUp(device, "robin@example.com", "Robin", "too short");
  await expect(device.getByRole("alert")).toHaveText("The password must be at least 10 characters.");
  await signUp(device, "robin@example.com", "Robin", "a long password", "a different password");
  await expect(device.getByRole("alert")).toHaveText("The passwords don't match.");
  // Checked by the server: an email that already has an account.
  await signUp(device, ADMIN, "Robin", "a long password");
  await expect(device.getByRole("alert")).toHaveText("There's already an account, or a request for one, with that email. Try logging in instead.");

  await signUp(device, "robin@example.com", "Robin", "a long password");
  await expect(device.getByRole("status")).toContainText("Thanks, Robin. Your request has been sent.");

  // Asking again with the same email (in any case) is refused.
  expect((await requestAccount(device.request, "ROBIN@example.com", "Robin")).status()).toBe(400);

  // Not until it's confirmed: with the right password it says so; with a wrong one, as usual.
  await device.getByRole("link", { name: "Go to the login page" }).click();
  await logIn(device, "robin@example.com", "a long password");
  await expect(device.getByRole("alert")).toHaveText("Your account is waiting to be confirmed. You can log in once it has been.");
  await logIn(device, "robin@example.com", "not the password");
  await expect(device.getByRole("alert")).toHaveText("Incorrect email or password.");
  await device.context().close();
});

test("the admin sees a warning icon while accounts are waiting, and confirms them on the users page", async ({ page, browser }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(waitingIcon(page)).toHaveCount(0);

  // The icon comes without reloading, through the live updates.
  const device = await (await newDevice(browser)).newPage();
  await device.goto("/signup");
  await signUp(device, "kim@example.com", "Kim", "kim's long password");
  await expect(device.getByRole("status")).toBeVisible();
  await expect(waitingIcon(page)).toHaveAttribute("title", "1 account is waiting to be confirmed");
  expect(((await (await page.request.get("/api/me")).json()) as { accountsWaiting: number }).accountsWaiting).toBe(1);
  expect((await requestAccount(page.request, "lee@example.com", "Lee")).status()).toBe(201);
  await expect(waitingIcon(page)).toHaveAttribute("title", "2 accounts are waiting to be confirmed");
  // It's shown on Settings too.
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(waitingIcon(page)).toBeVisible();

  await waitingIcon(page).click();
  await expect(page).toHaveURL(/\/settings\/users$/);
  await expect(requestList(page).getByRole("listitem")).toHaveCount(2);
  const kim = requestList(page).getByRole("listitem").filter({ hasText: "kim@example.com" });
  await expect(kim).toContainText("Kim");
  await kim.getByRole("button", { name: "Confirm" }).click();
  await expect(requestList(page).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("status")).toHaveText(
    "Kim's account is confirmed. They've been emailed at kim@example.com with the link to log in.",
  );
  await expect(page.getByRole("list", { name: "Users" }).getByRole("listitem").filter({ hasText: "kim@example.com" })).toContainText(
    "Last logged in Never",
  );
  await expect(waitingIcon(page)).toHaveAttribute("title", "1 account is waiting to be confirmed");

  // Kim logs in with the password they chose, to an empty notebook.
  await device.goto("/");
  await logIn(device, "kim@example.com", "kim's long password");
  await expect(device.getByRole("link", { name: "Settings" })).toBeVisible();
  expect(((await (await device.request.get("/api/notes")).json()) as { notes: unknown[] }).notes).toEqual([]);
  // The email they were sent on being confirmed, with the link to log in.
  const [confirmedEmail] = (await (await device.request.get("/api/test/emails")).json()) as { subject: string; text: string; html: string; toName: string }[];
  expect(confirmedEmail!.subject).toBe("Your nwsnotes account is ready");
  expect(confirmedEmail!.toName).toBe("Kim");
  expect(confirmedEmail!.text).toContain("Your nwsnotes account has been confirmed.");
  expect(confirmedEmail!.text).toContain(`Log in at ${test.info().project.use.baseURL}/ with this email address (kim@example.com)`);
  expect(confirmedEmail!.html).toContain(`href="${test.info().project.use.baseURL}/"`);
  // Who isn't an admin sees no icon, isn't told the count, and can't see the requests.
  await expect(waitingIcon(device)).toHaveCount(0);
  expect(await (await device.request.get("/api/me")).json()).not.toHaveProperty("accountsWaiting");
  expect((await device.request.get("/api/users/requests")).status()).toBe(403);
  expect((await device.request.post("/api/users/requests/1/confirm")).status()).toBe(403);

  // Declining removes the request, after asking; the icon goes.
  const lee = requestList(page).getByRole("listitem").filter({ hasText: "lee@example.com" });
  await lee.getByRole("button", { name: "Decline" }).click();
  await expect(page.getByRole("dialog")).toContainText("Decline Lee's request? It will be removed, and they won't be told.");
  await page.getByRole("dialog").getByRole("button", { name: "Decline" }).click();
  await expect(requestList(page)).toHaveCount(0);
  await expect(waitingIcon(page)).toHaveCount(0);
  // Lee can't log in, and can ask again.
  expect((await device.request.post("/api/login", { data: { loginName: "lee@example.com", password: "a long password" } })).status()).toBe(401);
  expect((await requestAccount(device.request, "lee@example.com", "Lee")).status()).toBe(201);
  await device.context().close();
});

test("a waiting email can't be added or given by hand, and at most 20 requests wait at once", async ({ page }) => {
  expect((await requestAccount(page.request, "sam@example.com", "Sam")).status()).toBe(201);
  const added = await page.request.post("/api/users", { data: { displayName: "Sam", loginName: "sam@example.com" } });
  expect(added.status()).toBe(400);
  expect(((await added.json()) as { error: string }).error).toContain("waiting to be confirmed");

  // The server checks what the page checks.
  expect((await requestAccount(page.request, "not an email", "X")).status()).toBe(400);
  expect((await requestAccount(page.request, "x@example.com", "", "a long password")).status()).toBe(400);
  expect((await requestAccount(page.request, "x@example.com", "X", "short")).status()).toBe(400);

  for (let i = 2; i <= 20; i++) expect((await requestAccount(page.request, `person${i}@example.com`, `Person ${i}`)).status()).toBe(201);
  const full = await requestAccount(page.request, "one-too-many@example.com", "One too many");
  expect(full.status()).toBe(503);
  expect(((await full.json()) as { error: string }).error).toBe(
    "Too many accounts are waiting to be confirmed just now. Please try again in a few days.",
  );
  expect(((await (await page.request.get("/api/users/requests")).json()) as unknown[]).length).toBe(20);
});

test("a request can only be confirmed once, and becomes an ordinary user", async ({ page }) => {
  expect((await requestAccount(page.request, "jo@example.com", "Jo", "jo's long password")).status()).toBe(201);
  const waiting = (await (await page.request.get("/api/users/requests")).json()) as { id: number; loginName: string }[];
  expect(waiting.map((request) => request.loginName)).toEqual(["jo@example.com"]);
  const confirmed = await page.request.post(`/api/users/requests/${waiting[0]!.id}/confirm`);
  expect(confirmed.status()).toBe(201);
  const { user, emailed } = (await confirmed.json()) as { user: { loginName: string; admin: boolean }; emailed: boolean };
  expect(user).toEqual(expect.objectContaining({ loginName: "jo@example.com", admin: false }));
  expect(emailed).toBe(true);
  expect((await page.request.post(`/api/users/requests/${waiting[0]!.id}/confirm`)).status()).toBe(404);
});

test("the Getting started help page links to the sign-up page", async ({ browser }) => {
  const device = await (await newDevice(browser)).newPage();
  await device.goto("/docs/getting-started/");
  await device.locator(".docs-page").getByRole("link", { name: "sign-up page" }).click();
  await expect(device).toHaveURL(/\/signup$/);
  await expect(device.getByRole("heading", { name: "Ask for an account" })).toBeVisible();
  await device.context().close();
});
