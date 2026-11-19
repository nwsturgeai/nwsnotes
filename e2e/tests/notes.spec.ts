import { addArea, chooseTag, expect, noteRow, noteTitles, openNotes, pills, selectTab, test, tickTag } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await openNotes(page);
});

test("Enter adds a typed note with its tags at the bottom of the list", async ({ page }) => {
  await chooseTag(page, "Area", "Work");
  await tickTag(page, "Topic", "Reading");
  const title = page.getByRole("textbox", { name: "New note" });
  await title.fill("Call the bank");
  await title.press("Enter");

  await expect(noteRow(page, "Call the bank")).toBeVisible();
  await expect.poll(async () => (await noteTitles(page)).at(-1)).toBe("Call the bank");
  await expect(pills(noteRow(page, "Call the bank"))).toHaveText(["Work", "Reading", "New"]);
  // The box is cleared and keeps the focus, ready for the next note, which gets the same tags.
  await expect(title).toHaveValue("");
  await expect(title).toBeFocused();
  await title.fill("Pay the bill");
  await title.press("Enter");
  await expect(pills(noteRow(page, "Pay the bill"))).toHaveText(["Work", "Reading", "New"]);

  // It was saved on the server.
  await page.reload();
  await expect(noteRow(page, "Call the bank")).toBeVisible();
  await expect(noteRow(page, "Pay the bill")).toBeVisible();
});

test("an empty title adds nothing", async ({ page }) => {
  const before = await noteTitles(page);
  await page.getByRole("textbox", { name: "New note" }).fill("   ");
  await page.getByRole("textbox", { name: "New note" }).press("Enter");
  await expect(page.getByRole("button", { name: "Add" })).toBeEnabled();
  expect(await noteTitles(page)).toEqual(before);
});

test("on a tab, Ctrl+Enter adds the note at the top and Enter at the bottom", async ({ page }) => {
  await selectTab(page, "Work");
  const title = page.getByRole("textbox", { name: "New note" });
  await title.fill("At the bottom");
  await title.press("Enter");
  await expect(noteRow(page, "At the bottom")).toBeVisible();
  await title.fill("At the top");
  // The tab's new order is saved straight after the note.
  const orderSaved = page.waitForResponse((response) => /\/api\/tabs\/1\/order$/.test(response.url()) && response.ok());
  await title.press("Control+Enter");
  await expect(noteRow(page, "At the top")).toBeVisible();
  await orderSaved;

  await expect.poll(async () => (await noteTitles(page))[0]).toBe("At the top");
  await expect.poll(async () => (await noteTitles(page)).at(-1)).toBe("At the bottom");
  // The tab's order is saved, and new notes on a tab get its tag. (A reload opens the All tab.)
  await page.reload();
  await selectTab(page, "Work");
  await expect.poll(async () => (await noteTitles(page))[0]).toBe("At the top");
  await expect(pills(noteRow(page, "At the top")).filter({ hasText: /^New$/ })).toHaveCount(1);
  await selectTab(page, "All");
  await expect(pills(noteRow(page, "At the top")).filter({ hasText: /^Work$/ })).toHaveCount(1);
});

test("holding Add for a second adds the note at the top, and shows it's been held", async ({ page }) => {
  await selectTab(page, "Work");
  const add = addArea(page).getByRole("button", { name: "Add" });
  await page.getByRole("textbox", { name: "New note" }).fill("Held down");
  const orderSaved = page.waitForResponse((response) => /\/api\/tabs\/1\/order$/.test(response.url()) && response.ok());

  // Records the buzz at 1 second.
  await page.evaluate(() => {
    const recorded = window as unknown as { buzzes: VibratePattern[] };
    recorded.buzzes = [];
    navigator.vibrate = ((pattern: VibratePattern) => {
      recorded.buzzes.push(pattern);
      return true;
    }) as Navigator["vibrate"];
  });

  await add.hover();
  await page.mouse.down();
  // While holding, a ring fills round the button.
  await expect(page.locator(".hold-ring .hold-progress")).toBeVisible();
  await page.waitForTimeout(500);
  await expect(add).not.toHaveClass(/\bheld\b/);
  await expect(add).toHaveClass(/\bheld\b/, { timeout: 2_000 });
  // Then rings burst out beyond the button, with a buzz.
  await expect(page.locator(".hold-ring .hold-burst").first()).toBeVisible();
  await expect(page.locator(".hold-progress")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { buzzes: VibratePattern[] }).buzzes)).toEqual([40]);
  await page.mouse.up();
  await expect(page.locator(".hold-ring")).toHaveCount(0);

  await expect(noteRow(page, "Held down")).toBeVisible();
  await expect.poll(async () => (await noteTitles(page))[0]).toBe("Held down");
  await expect(add).not.toHaveClass(/\bheld\b/);
  await orderSaved;
  await page.reload();
  await selectTab(page, "Work");
  await expect.poll(async () => (await noteTitles(page))[0]).toBe("Held down");

  // A short click adds at the bottom, and leaves no rings.
  await page.getByRole("textbox", { name: "New note" }).fill("Clicked");
  await add.click();
  await expect(page.locator(".hold-ring")).toHaveCount(0);
  await expect(noteRow(page, "Clicked")).toBeVisible();
  await expect.poll(async () => (await noteTitles(page)).at(-1)).toBe("Clicked");
});

test("a note that the tab doesn't show is still added, with a notice", async ({ page }) => {
  await selectTab(page, "On hold");
  const title = page.getByRole("textbox", { name: "New note" });
  await title.fill("Not shown here");
  await title.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Note added, but this tab doesn't show New notes.");
  await expect(noteRow(page, "Not shown here")).toHaveCount(0);
  await selectTab(page, "All");
  await expect(noteRow(page, "Not shown here")).toBeVisible();
});

test("editing a note changes its title and tags", async ({ page }) => {
  const row = noteRow(page, "Plan the team meeting");
  await row.getByRole("button", { name: "Edit note" }).click();
  const title = page.getByRole("textbox", { name: "Note title" });
  await expect(title).toHaveValue("Plan the team meeting");
  await expect(title).toBeFocused();
  // While one note is being edited, the others can't be.
  const otherButtons = noteRow(page, "Buy milk").locator(".note-actions").getByRole("button");
  await expect(otherButtons).toHaveCount(3);
  for (const button of await otherButtons.all()) await expect(button).toBeDisabled();

  await title.fill("Plan the away day");
  await chooseTag(page, "Area", "Home");
  await addArea(page).getByRole("button", { name: "Update" }).click();

  await expect(noteRow(page, "Plan the away day")).toBeVisible();
  await expect(noteRow(page, "Plan the team meeting")).toHaveCount(0);
  await expect(pills(noteRow(page, "Plan the away day"))).toHaveText(["Home"]);
  // Back to adding notes; the note keeps its place in the list.
  await expect(page.getByRole("textbox", { name: "New note" })).toHaveValue("");
  await expect.poll(async () => (await noteTitles(page))[0]).toBe("Plan the away day");
  await page.reload();
  await expect(noteRow(page, "Plan the away day")).toBeVisible();
});

test("cancelling an edit, with the button or Escape, changes nothing", async ({ page }) => {
  const row = noteRow(page, "Garden ideas");
  await row.getByRole("button", { name: "Edit note" }).click();
  await page.getByRole("textbox", { name: "Note title" }).fill("Something else");
  await addArea(page).getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("textbox", { name: "New note" })).toHaveValue("");
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "Edit note" }).click();
  await page.getByRole("textbox", { name: "Note title" }).fill("Something else");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("textbox", { name: "New note" })).toHaveValue("");
  await expect(noteRow(page, "Garden ideas")).toBeVisible();
  await expect(noteRow(page, "Something else")).toHaveCount(0);
});

test("each note shows when it was created", async ({ page }) => {
  // Seed notes were created on 1 November 2026 (the year is shown only for other years).
  await expect(noteRow(page, "Plan the team meeting").locator("time")).toHaveText(/^Cr\. 01\/11(\/26)? 09:00$/);

  const title = page.getByRole("textbox", { name: "New note" });
  await title.fill("Made just now");
  await title.press("Enter");
  // Today's date and time in the tests' time zone, as the app shows it.
  const now = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date());
  await expect(noteRow(page, "Made just now").locator("time")).toHaveText(new RegExp(`^Cr\\. ${now} \\d{2}:\\d{2}$`));
});
