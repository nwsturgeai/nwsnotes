import { mkdirSync } from "node:fs";
import path from "node:path";
import { test as setup, expect } from "@playwright/test";
import { SESSION_FILE } from "../playwright.config";
import { ADMIN, PASSWORD, logIn } from "./fixtures";

// Logs in once as the admin, with the dev password; every test apart from the login tests reuses the session.
setup("log in", async ({ page }) => {
  await page.goto("/");
  await logIn(page, ADMIN, PASSWORD);
  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  await page.context().storageState({ path: SESSION_FILE });
});
