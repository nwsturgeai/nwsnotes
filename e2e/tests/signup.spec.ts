import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, logIn, test } from "./fixtures";

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
    storageState: { cookies: [], origins: [] },
  });
}

const CHOSEN = "my own password";

/** Fills in and sends the sign-up page. */
async function signUp(page: Page, email: string, password: string, again = password) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Password again").fill(again);
  await page.getByRole("button", { name: "Ask for an account" }).click();
}

/** A user's row on the users page. */
const userRow = (page: Page, loginName: string) =>
  page.getByRole("list", { name: "Users" }).getByRole("listitem").filter({ hasText: loginName });

const waitingIcon = (page: Page) => page.getByRole("link", { name: /waiting to be confirmed/ });

test("someone asks for an account with their own password, and can log in once the admin confirms it", async ({ page, browser }) => {
  // The admin's page is open, with nothing waiting.
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(waitingIcon(page)).toHaveCount(0);

  // The login page links to the sign-up page.
  const pat = await (await newDevice(browser)).newPage();
  await pat.goto("/");
  await pat.getByRole("link", { name: "No account? Ask for one" }).click();
  await expect(pat).toHaveURL(/\/signup$/);

  // The page checks the boxes before sending.
  await signUp(pat, "not an email", CHOSEN);
  await expect(pat.getByRole("alert")).toHaveText("Please type your email address, e.g. pat@example.com.");
  await signUp(pat, "pat@example.com", "short", "short");
  await expect(pat.getByRole("alert")).toHaveText("The password must be at least 10 characters.");
  await signUp(pat, "pat@example.com", CHOSEN, "something else");
  await expect(pat.getByRole("alert")).toHaveText("The passwords don't match.");

  await signUp(pat, "pat@example.com", CHOSEN);
  await expect(pat.getByRole("status")).toContainText("Your account is waiting to be confirmed.");

  // Not yet confirmed: they can't log in.
  await pat.getByRole("link", { name: "Go to the login page" }).click();
  await logIn(pat, "pat@example.com", CHOSEN);
  await expect(pat.getByRole("alert")).toHaveText("This account is waiting to be confirmed. You can log in once it has been.");

  // The admin's open page shows the warning icon (by a live update), which goes to the users page.
  await expect(waitingIcon(page)).toHaveAccessibleName("1 account is waiting to be confirmed");
  await waitingIcon(page).click();
  await expect(page.getByRole("heading", { name: "Users", level: 1 })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "waiting to be confirmed" })).toContainText("1 account is waiting to be confirmed.");
  const row = userRow(page, "pat@example.com");
  await expect(row).toContainText("Waiting to be confirmed");
  await row.getByRole("button", { name: "Confirm" }).click();
  await expect(row).not.toContainText("Waiting to be confirmed");
  await expect(row.getByRole("button", { name: "Confirm" })).toHaveCount(0);
  await expect(waitingIcon(page)).toHaveCount(0);

  // Now they can log in, with the password they chose.
  await pat.getByRole("button", { name: "Log in" }).click();
  await expect(pat.getByRole("link", { name: "Settings" })).toBeVisible();
  await pat.close();
});

test("the admin can decline an account, which is removed", async ({ page, browser }) => {
  const response = await page.request.post("/api/signup", { data: { loginName: "stranger@example.com", password: CHOSEN } });
  expect(response.status()).toBe(201);

  await page.goto("/");
  await expect(waitingIcon(page)).toBeVisible();
  await page.goto("/settings/users");
  const row = userRow(page, "stranger@example.com");
  await row.getByRole("button", { name: "Decline" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Decline stranger@example.com's account?");
  await dialog.getByRole("button", { name: "Decline" }).click();
  await expect(row).toHaveCount(0);
  await expect(waitingIcon(page)).toHaveCount(0);

  const other = await (await newDevice(browser)).newPage();
  await other.goto("/");
  await logIn(other, "stranger@example.com", CHOSEN);
  await expect(other.getByRole("alert")).toHaveText("Incorrect email or password.");
  await other.close();
});

test("the sign-up API checks what it's sent, and only the admin can confirm or decline", async ({ page, browser }) => {
  const signUpApi = (data: object) => page.request.post("/api/signup", { data });
  const errorOf = async (response: Awaited<ReturnType<typeof signUpApi>>) => ((await response.json()) as { error: string }).error;

  const bad = await signUpApi({ loginName: "nope", password: CHOSEN });
  expect(bad.status()).toBe(400);
  const short = await signUpApi({ loginName: "lee@example.com", password: "short" });
  expect(await errorOf(short)).toBe("The password must be at least 10 characters.");
  expect((await signUpApi({ loginName: "lee@example.com", password: CHOSEN })).status()).toBe(201);
  // The same email again (ignoring case), or the admin's, is refused.
  for (const loginName of ["LEE@example.com", "admin@example.com"]) {
    const again = await signUpApi({ loginName, password: CHOSEN });
    expect(again.status()).toBe(400);
    expect(await errorOf(again)).toBe("There's already an account for this email (or one waiting to be confirmed).");
  }

  const me = (await (await page.request.get("/api/me")).json()) as { waitingUserCount: number };
  expect(me.waitingUserCount).toBe(1);
  const users = (await (await page.request.get("/api/users")).json()) as { id: number; loginName: string; displayName: string; waitingForConfirmation: boolean }[];
  const lee = users.find((user) => user.loginName === "lee@example.com")!;
  expect(lee).toMatchObject({ displayName: "lee", waitingForConfirmation: true });

  // Someone who isn't the admin can't confirm it.
  const created = await page.request.post("/api/users", { data: { displayName: "Sam", loginName: "sam@example.com" } });
  const { user: samUser, password } = (await created.json()) as { user: { id: number }; password: string };
  const sam = await (await newDevice(browser)).newPage();
  expect((await sam.request.post("/api/login", { data: { loginName: "sam@example.com", password } })).ok()).toBe(true);
  expect((await sam.request.post(`/api/users/${lee.id}/confirm`)).status()).toBe(403);
  expect((await sam.request.delete(`/api/users/${lee.id}`)).status()).toBe(403);
  expect(((await (await sam.request.get("/api/me")).json()) as object)).not.toHaveProperty("waitingUserCount");
  await sam.close();

  // Accounts that aren't waiting can't be declined (removed).
  expect((await page.request.delete(`/api/users/${samUser.id}`)).status()).toBe(400);
});
