import { PASSWORD, expect, test } from "./fixtures";

// These start logged out, rather than with the setup step's saved session.
test.use({ storageState: { cookies: [], origins: [] } });

test("a wrong password is refused", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Password").fill("not the password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert")).toHaveText("Incorrect password.");
  await expect(page.getByLabel("Password")).toBeVisible();
});

test("the Log in button needs a password", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Log in" })).toBeDisabled();
});

test("logging out works even when the service worker isn't running", async ({ page }) => {
  // Service workers are blocked here, so turning off reminders can't finish: logging out mustn't wait for it.
  await page.goto("/");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByLabel("Password")).toBeVisible({ timeout: 6_000 });
  await page.reload();
  await expect(page.getByLabel("Password")).toBeVisible();
});

test.describe(() => {
  // Logging out first turns off this device's reminders, which waits for the service worker, as on the tablet.
  test.use({ serviceWorkers: "allow" });

  test("logging in shows the notes, and logging out goes back to the login page", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.locator(".note-list").getByText("Plan the team meeting")).toBeVisible();

    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page.getByLabel("Password")).toBeVisible();

    // The session has gone: reloading doesn't log back in.
    await page.reload();
    await expect(page.getByLabel("Password")).toBeVisible();
  });
});
