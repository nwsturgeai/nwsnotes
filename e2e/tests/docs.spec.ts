import { expect, openNotes, test } from "./fixtures";

test.describe("without logging in", () => {
  // The help pages are public, so these start logged out.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the introduction opens without a login and links to the contents, which lists every page", async ({ page }) => {
    await page.goto("/docs/");
    await expect(page.getByRole("heading", { level: 1, name: "Welcome to nwsnotes" })).toBeVisible();
    await expect(page.getByRole("link", { name: "← Back to the app" })).toHaveAttribute("href", "/");
    await page.locator(".docs-page").getByRole("link", { name: "All help pages" }).click();
    await expect(page).toHaveURL(/\/docs\/contents\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "Help contents" })).toBeVisible();

    // Every page in the contents opens, with a title, the shared header and "Previous"/"Next".
    const pages = await page.locator(".docs-page li a").evaluateAll((links) =>
      links.map((link) => ({ href: link.getAttribute("href")! })),
    );
    expect(pages.length).toBeGreaterThan(2);
    for (const [index, { href }] of pages.entries()) {
      const response = await page.goto(href);
      expect(response?.status(), href).toBe(200);
      // Its own title (the contents may word it more briefly), also in the window's title.
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(/\S/);
      await expect(page).toHaveTitle(/ – nwsnotes help$/);
      await expect(page.getByRole("link", { name: "Contents" })).toBeVisible();
      if (index > 0) await expect(page.locator(".docs-previous")).toHaveAttribute("href", pages[index - 1]!.href);
      if (index < pages.length - 1) await expect(page.locator(".docs-next")).toHaveAttribute("href", pages[index + 1]!.href);
    }
  });

  test("a help page that doesn't exist gives a 404 with a link to the contents", async ({ page }) => {
    const response = await page.goto("/docs/nothing/");
    expect(response?.status()).toBe(404);
    await expect(page.getByText("This help page doesn't exist.")).toBeVisible();
    await page.getByRole("link", { name: "See all the help pages" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Help contents" })).toBeVisible();
  });

  test("the login page links to the introduction", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "New here? Read the introduction" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Welcome to nwsnotes" })).toBeVisible();
  });
});

test("Settings has a link to the help pages, and they link back to the app", async ({ page }) => {
  await openNotes(page);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: "Help pages" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Welcome to nwsnotes" })).toBeVisible();
  await page.getByRole("link", { name: "← Back to the app" }).click();
  await expect(page.locator(".note-list li[data-note-id]").first()).toBeVisible();
});
