import { addArea, chooseTag, expect, filterRow, fingerHoldWithoutClick, noteRow, noteTitles, openNotes, pills, selectTab, test, tickTag } from "./fixtures";

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
  // The new order is saved straight after the note.
  const orderSaved = page.waitForResponse((response) => /\/api\/notes\/order$/.test(response.url()) && response.ok());
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
  const orderSaved = page.waitForResponse((response) => /\/api\/notes\/order$/.test(response.url()) && response.ok());

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
  // It acted on letting go; the click that followed was ignored, so it's only added once.
  await page.waitForTimeout(500);
  await expect(noteRow(page, "Held down")).toHaveCount(1);
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

test("a finger held on Add adds the note at the top even with no click after it, as on an Android phone", async ({ page }) => {
  await selectTab(page, "Work");
  const box = page.getByRole("textbox", { name: "New note" });
  await box.fill("From the phone");
  await fingerHoldWithoutClick(page, addArea(page).getByRole("button", { name: "Add" }));

  await expect.poll(async () => (await noteTitles(page))[0]).toBe("From the phone");
  await expect(noteRow(page, "From the phone")).toHaveCount(1);
  // The title box is ready for the next note, so the keyboard comes back.
  await expect(box).toHaveValue("");
  await expect(box).toBeFocused();

  // The next tap is a normal add, not swallowed as part of the long press.
  await box.fill("Tapped next");
  await addArea(page).getByRole("button", { name: "Add" }).click();
  await expect.poll(async () => (await noteTitles(page)).at(-1)).toBe("Tapped next");
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
  // While one note is being edited, the others' buttons can still be used (they save it first); its own Edit button can't.
  const otherButtons = noteRow(page, "Buy milk").locator(".note-actions").getByRole("button");
  await expect(otherButtons).toHaveCount(3);
  for (const button of await otherButtons.all()) await expect(button).toBeEnabled();
  await expect(row.getByRole("button", { name: "Editing this note" })).toBeDisabled();

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

test("during an edit, another tab, another note's Edit button or the filter row saves the note first, then does what it does", async ({ page }) => {
  const title = page.getByRole("textbox", { name: "Note title" });

  // Another tab: saved, then that tab is shown.
  await noteRow(page, "Plan the team meeting").getByRole("button", { name: "Edit note" }).click();
  await expect(page.getByRole("textbox", { name: "Note title" })).toBeFocused();
  await title.fill("Plan the away day");
  await page.getByRole("tab", { name: "Work" }).click();
  await expect(page.getByRole("tab", { name: "Work" })).toHaveAttribute("aria-selected", "true");
  await expect(noteRow(page, "Plan the away day")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "New note" })).toHaveValue("");

  // Another note's Edit button: saved, then that note is being edited.
  await noteRow(page, "Plan the away day").getByRole("button", { name: "Edit note" }).click();
  await expect(page.getByRole("textbox", { name: "Note title" })).toBeFocused();
  await title.fill("Plan the away day in May");
  await noteRow(page, "Old invoice").getByRole("button", { name: "Edit note" }).click();
  await expect(title).toHaveValue("Old invoice");
  await expect(noteRow(page, "Plan the away day in May")).toBeVisible();

  // Another note's Archive button: saved, then that note is archived.
  await expect(title).toBeFocused();
  await title.fill("Old invoice, paid");
  await noteRow(page, "Read the quarterly report").getByRole("button", { name: "Archive" }).click();
  await expect(noteRow(page, "Old invoice, paid")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "New note" })).toBeVisible();
  await expect(noteRow(page, "Read the quarterly report").getByRole("button", { name: "Reinstate" })).toBeVisible();

  // A filter dropdown: saved, then it opens.
  await noteRow(page, "Old invoice, paid").getByRole("button", { name: "Edit note" }).click();
  await expect(page.getByRole("textbox", { name: "Note title" })).toBeFocused();
  await title.fill("Old invoice, filed");
  await filterRow(page).getByRole("button", { name: /^Topic: / }).click();
  await expect(page.getByRole("group", { name: "Topic", exact: true })).toBeVisible();
  await expect(noteRow(page, "Old invoice, filed")).toBeVisible();
  await page.keyboard.press("Escape");

  // Edit order: saved, then edit-order mode.
  await noteRow(page, "Old invoice, filed").getByRole("button", { name: "Edit note" }).click();
  await expect(page.getByRole("textbox", { name: "Note title" })).toBeFocused();
  await title.fill("Old invoice, shredded");
  await filterRow(page).getByRole("button", { name: "Edit order" }).click();
  await expect(filterRow(page).getByRole("button", { name: "Finish ordering" })).toBeVisible();
  await page.reload();
  await expect(noteRow(page, "Old invoice, shredded")).toBeVisible();
});

test("during an edit, the Settings cog saves the note first, then opens Settings", async ({ page }) => {
  await noteRow(page, "Garden ideas").getByRole("button", { name: "Edit note" }).click();
  await expect(page.getByRole("textbox", { name: "Note title" })).toBeFocused();
  await page.getByRole("textbox", { name: "Note title" }).fill("Garden ideas for spring");
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "← Notes" }).click();
  await expect(noteRow(page, "Garden ideas for spring")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "New note" })).toHaveValue("");
});

test("during an edit with no title, or one that can't be saved, the other controls stay put", async ({ page }) => {
  const title = page.getByRole("textbox", { name: "Note title" });
  const work = page.getByRole("tab", { name: "Work" });
  await noteRow(page, "Buy milk").getByRole("button", { name: "Edit note" }).click();
  await expect(title).toBeFocused();

  // No title: blocked, as before, until there's one again.
  await title.fill("   ");
  await expect(work).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-disabled", "true");
  await expect(noteRow(page, "Garden ideas").getByRole("button", { name: "Finish or cancel the current edit first" }).first()).toBeDisabled();
  await expect(filterRow(page).getByRole("button", { name: "Search" })).toHaveCount(0);
  await work.dispatchEvent("click");
  await expect(page.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
  await title.fill("Buy milk");
  await expect(work).not.toHaveAttribute("aria-disabled", "true");

  // A title that can't be saved (too long): the error shows, the edit stays open, and the tab isn't changed.
  await title.fill("x".repeat(501));
  await work.click();
  await expect(page.locator(".save-error")).toContainText("500");
  await expect(title).toHaveValue("x".repeat(501));
  await expect(page.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
  await addArea(page).getByRole("button", { name: "Cancel" }).click();
  await expect(noteRow(page, "Buy milk")).toBeVisible();
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
