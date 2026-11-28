import type { Locator, Page } from "@playwright/test";
import { addArea, expect, noteRow, openNotes, test } from "./fixtures";

/** Turns stylus mode on in Settings (it's remembered on this device) and goes back to the notes. */
async function turnOnStylusMode(page: Page) {
  await page.getByRole("link", { name: "Settings" }).click();
  // The switch's check box is hidden behind its drawn track, so its label is tapped.
  await page.locator("label.switch").filter({ hasText: "Stylus mode" }).click();
  await expect(page.getByRole("switch", { name: "Stylus mode" })).toBeChecked();
  await page.getByRole("link", { name: "← Notes" }).click();
  await expect(page.getByRole("img", { name: "Stylus mode is on" })).toBeVisible();
}

/** Draws a line across part of a canvas with the mouse (a stylus or mouse draws; fingers don't). */
async function draw(page: Page, canvas: Locator, from = 0.2, to = 0.6) {
  const box = (await canvas.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * from, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to, y, { steps: 12 });
  await page.mouse.up();
}

/** How many of the canvas's pixels have ink on them. */
function inkPixels(canvas: Locator): Promise<number> {
  return canvas.evaluate((element: HTMLCanvasElement) => {
    const data = element.getContext("2d")!.getImageData(0, 0, element.width, element.height).data;
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) count++;
    return count;
  });
}

const handwritten = (page: Page) => page.locator(".note-list").getByRole("img", { name: "Handwritten note" });

test.beforeEach(async ({ page }) => {
  await openNotes(page);
});

test("in stylus mode, a handwritten note is drawn and added", async ({ page, isMobile }) => {
  await turnOnStylusMode(page);
  const pad = addArea(page).getByRole("img", { name: "Writing area for a new note" });
  await expect(pad).toBeVisible();
  await expect(page.getByRole("textbox", { name: "New note" })).toHaveCount(0);

  // On the tablet, a finger tap (a palm resting) leaves no ink.
  if (isMobile) {
    const box = (await pad.boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    expect(await inkPixels(pad)).toBe(0);
  }

  await draw(page, pad);
  expect(await inkPixels(pad)).toBeGreaterThan(0);
  // Clear wipes it.
  await addArea(page).getByRole("button", { name: "Clear" }).click();
  expect(await inkPixels(pad)).toBe(0);

  await expect(handwritten(page)).toHaveCount(1);
  await draw(page, pad);
  await addArea(page).getByRole("button", { name: "Add" }).click();
  await expect(handwritten(page)).toHaveCount(2);
  await expect.poll(() => inkPixels(pad)).toBe(0);
  await page.reload();
  await expect(handwritten(page)).toHaveCount(2);
});

test("in stylus mode, a button a finger tap is ignored on flashes red for half a second", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Finger taps need the touchscreen");
  await turnOnStylusMode(page);
  const pad = addArea(page).getByRole("img", { name: "Writing area for a new note" });
  await draw(page, pad);
  const notes = await handwritten(page).count();

  // A finger tap on Add does nothing but flash it red.
  const add = addArea(page).getByRole("button", { name: "Add" });
  await add.tap();
  await expect(add).toHaveClass(/ignored-tap/);
  await expect(add).toHaveCSS("background-color", "rgb(217, 48, 37)");
  await expect(add).not.toHaveClass(/ignored-tap/, { timeout: 2000 });
  await expect(add).not.toHaveCSS("background-color", "rgb(217, 48, 37)");
  await expect(handwritten(page)).toHaveCount(notes);
  expect(await inkPixels(pad)).toBeGreaterThan(0);

  // In the long-form editor too.
  await page.getByRole("button", { name: "Show all tags" }).click();
  await addArea(page).getByRole("button", { name: "Create long-form note" }).click();
  const editor = page.getByRole("dialog", { name: "Long-form note" });
  await editor.getByRole("textbox", { name: "Long-form note title" }).fill("Sketch");
  await editor.getByRole("button", { name: "Accept title" }).click();
  const eraser = editor.getByRole("button", { name: "Eraser" });
  await eraser.tap();
  await expect(eraser).toHaveClass(/ignored-tap/);
  await expect(eraser).toHaveAttribute("aria-pressed", "false");
  await expect(eraser).not.toHaveClass(/ignored-tap/, { timeout: 2000 });
});

test("in stylus mode, the expanded add area's five buttons are in one column", async ({ page }) => {
  await turnOnStylusMode(page);
  await page.getByRole("button", { name: "Show all tags" }).click();
  const buttons = addArea(page).locator(".new-note-buttons > button");
  await expect(buttons).toHaveCount(5);
  const boxes = await buttons.evaluateAll((all) => all.map((button) => button.getBoundingClientRect().left));
  expect(new Set(boxes).size).toBe(1);
});

test("the eraser removes ink from handwritten long-form details", async ({ page }) => {
  await turnOnStylusMode(page);
  await page.getByRole("button", { name: "Show all tags" }).click();
  await addArea(page).getByRole("button", { name: "Create long-form note" }).click();
  const editor = page.getByRole("dialog", { name: "Long-form note" });
  await editor.getByRole("textbox", { name: "Long-form note title" }).fill("Sketch");
  await editor.getByRole("button", { name: "Accept title" }).click();

  const details = editor.getByRole("img", { name: "Details of the long-form note" });
  await expect(editor.getByRole("button", { name: "Eraser" })).toBeEnabled();
  await draw(page, details, 0.2, 0.8);
  const before = await inkPixels(details);
  expect(before).toBeGreaterThan(0);

  const eraser = editor.getByRole("button", { name: "Eraser" });
  await eraser.click();
  await expect(eraser).toHaveAttribute("aria-pressed", "true");
  await draw(page, details, 0.2, 0.5);
  const after = await inkPixels(details);
  expect(after).toBeGreaterThan(0);
  expect(after).toBeLessThan(before);
  await eraser.click();
  await expect(eraser).toHaveAttribute("aria-pressed", "false");
});

test("the long-form editor has a pen-thickness menu beside the eraser, sharing the setting", async ({ page }) => {
  await turnOnStylusMode(page);
  await page.getByRole("button", { name: "Show all tags" }).click();
  await addArea(page).getByRole("button", { name: "Create long-form note" }).click();
  const editor = page.getByRole("dialog", { name: "Long-form note" });
  await editor.getByRole("textbox", { name: "Long-form note title" }).fill("Thick and thin");
  await editor.getByRole("button", { name: "Accept title" }).click();

  // One button, which opens a menu of the three thicknesses (above it), with the current one ticked.
  const penButton = editor.getByRole("button", { name: "Pen thickness" });
  await expect(penButton).toHaveAttribute("aria-haspopup", "menu");
  await expect(page.getByRole("menu", { name: "Pen thickness" })).toHaveCount(0);
  await penButton.click();
  const penMenu = page.getByRole("menu", { name: "Pen thickness" });
  const pens = penMenu.getByRole("menuitemradio");
  await expect(pens).toHaveCount(3);
  await expect(penMenu.getByRole("menuitemradio", { name: "Pen thickness 2.5px" })).toHaveAttribute("aria-checked", "true");
  await expect(penMenu.getByRole("menuitemradio", { name: "Pen thickness 1.5px" })).toHaveAttribute("aria-checked", "false");
  const penButtonBox = (await penButton.boundingBox())!;
  expect((await penMenu.boundingBox())!.y + (await penMenu.boundingBox())!.height).toBeLessThanOrEqual(penButtonBox.y);
  // Escape closes it.
  await page.keyboard.press("Escape");
  await expect(penMenu).toHaveCount(0);

  // Right of the eraser with a wider gap, and Cancel then Finish at the far right of the row.
  const eraser = editor.getByRole("button", { name: "Eraser" });
  const eraserBox = (await eraser.boundingBox())!;
  expect(Math.round(penButtonBox.x - (eraserBox.x + eraserBox.width))).toBe(16);
  const cancel = (await editor.getByRole("button", { name: "Cancel" }).boundingBox())!;
  const finish = (await editor.getByRole("button", { name: "Finish" }).boundingBox())!;
  const row = (await page.locator(".lf-finish").boundingBox())!;
  expect(Math.round(row.x + row.width - (finish.x + finish.width))).toBe(0);
  expect(cancel.x).toBeLessThan(finish.x);
  expect(finish.width).toBe(40);
  // The pages come after the pen button, with the same wider gap: "1/1", Previous, Next and the page menu.
  const pages = editor.getByRole("group", { name: "Pages" });
  const pagesBox = (await pages.boundingBox())!;
  expect(Math.round(pagesBox.x - (penButtonBox.x + penButtonBox.width))).toBe(16);
  await expect(pages).toHaveText("1/1");
  const previousBox = (await pages.getByRole("button", { name: "Previous page" }).boundingBox())!;
  const nextBox = (await pages.getByRole("button", { name: "Next page" }).boundingBox())!;
  const menuBox = (await pages.getByRole("button", { name: "Page options" }).boundingBox())!;
  expect(previousBox.x).toBeLessThan(nextBox.x);
  expect(nextBox.x).toBeLessThan(menuBox.x);
  // Export is over at the right too, a little way before Cancel.
  const exportBox = (await editor.getByRole("button", { name: "Export as image" }).boundingBox())!;
  expect(Math.round(cancel.x - (exportBox.x + exportBox.width))).toBe(24);

  // Choosing a thickness closes the menu, turns the eraser off, and draws at it.
  await eraser.click();
  await expect(eraser).toHaveAttribute("aria-pressed", "true");
  await penButton.click();
  await penMenu.getByRole("menuitemradio", { name: "Pen thickness 4.5px" }).click();
  await expect(penMenu).toHaveCount(0);
  await expect(eraser).toHaveAttribute("aria-pressed", "false");
  await penButton.click();
  await expect(penMenu.getByRole("menuitemradio", { name: "Pen thickness 4.5px" })).toHaveAttribute("aria-checked", "true");
  // Clicking elsewhere closes it, choosing nothing.
  await editor.click({ position: { x: 5, y: 5 } });
  await expect(penMenu).toHaveCount(0);
  const details = editor.getByRole("img", { name: "Details of the long-form note" });
  await draw(page, details, 0.2, 0.4);
  const thick = await inkPixels(details);
  await penButton.click();
  await penMenu.getByRole("menuitemradio", { name: "Pen thickness 1.5px" }).click();
  await draw(page, details, 0.5, 0.7);
  expect((await inkPixels(details)) - thick).toBeLessThan(thick / 2);

  // It's the same setting as in Settings.
  await editor.getByRole("button", { name: "Finish" }).click();
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("radio", { name: "Pen thickness 1.5px" })).toHaveAttribute("aria-checked", "true");
});

test("with a handwritten long-form note open, the add area is collapsed and can't be expanded", async ({ page }) => {
  await turnOnStylusMode(page);
  await page.getByRole("button", { name: "Show all tags" }).click();
  await addArea(page).getByRole("button", { name: "Create long-form note" }).click();
  const editor = page.getByRole("dialog", { name: "Long-form note" });
  await expect(addArea(page)).not.toHaveClass(/\bfull\b/);
  await expect(page.getByRole("button", { name: "Show all tags" })).toBeDisabled();
  // The editor reaches down to the collapsed area, giving the canvas more room.
  const editorBox = (await editor.boundingBox())!;
  const areaBox = (await addArea(page).boundingBox())!;
  expect(Math.abs(editorBox.y + editorBox.height - areaBox.y)).toBeLessThan(2);
  expect(areaBox.height).toBe(150);

  // Closing it brings back the expanded area, as it was.
  await editor.getByRole("button", { name: "Cancel" }).click();
  await expect(editor).toHaveCount(0);
  await expect(addArea(page)).toHaveClass(/\bfull\b/);
});

test("the pen thickness setting draws thicker or thinner lines", async ({ page }) => {
  await turnOnStylusMode(page);
  const pad = addArea(page).getByRole("img", { name: "Writing area for a new note" });

  /** The ink of one line drawn at this thickness. */
  async function lineAt(width: string): Promise<number> {
    await page.getByRole("link", { name: "Settings" }).click();
    await page.getByRole("radio", { name: `Pen thickness ${width}` }).click();
    await expect(page.getByRole("radio", { name: `Pen thickness ${width}` })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("link", { name: "← Notes" }).click();
    await draw(page, pad);
    const ink = await inkPixels(pad);
    await addArea(page).getByRole("button", { name: "Clear" }).click();
    return ink;
  }

  const thin = await lineAt("1.5px");
  const thick = await lineAt("4.5px");
  expect(thick).toBeGreaterThan(thin * 2);
});

test("handwritten long-form details can be exported as an image, shared or downloaded", async ({ page }) => {
  await turnOnStylusMode(page);
  await page.getByRole("button", { name: "Show all tags" }).click();
  await addArea(page).getByRole("button", { name: "Create long-form note" }).click();
  const editor = page.getByRole("dialog", { name: "Long-form note" });
  await editor.getByRole("textbox", { name: "Long-form note title" }).fill("Garden: plan?");
  await editor.getByRole("button", { name: "Accept title" }).click();
  const exportButton = editor.getByRole("button", { name: "Export as image" });
  // Nothing written yet.
  await expect(exportButton).toBeDisabled();
  await draw(page, editor.getByRole("img", { name: "Details of the long-form note" }), 0.2, 0.6);
  await expect(exportButton).toBeEnabled();

  const today = await page.evaluate(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });

  // Where files can be shared (Android), the share sheet gets the image.
  await page.evaluate(() => {
    const shared = window as unknown as { shared?: { name: string; type: string; corner: number[]; inked: boolean } };
    navigator.canShare = () => true;
    navigator.share = async (data?: ShareData) => {
      const file = data!.files![0]!;
      const image = await createImageBitmap(file);
      const canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, image.width, image.height).data;
      let inked = false;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i]! < 100 && pixels[i + 3] === 255) inked = true;
      shared.shared = { name: file.name, type: file.type, corner: Array.from(pixels.slice(0, 4)), inked };
    };
  });
  await exportButton.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { shared?: unknown }).shared)).toEqual({
    name: `Garden plan ${today}.png`,
    type: "image/png",
    // Black ink on white, not on a transparent background.
    corner: [255, 255, 255, 255],
    inked: true,
  });

  // Elsewhere, it's downloaded.
  await page.evaluate(() => {
    (navigator as { canShare?: unknown }).canShare = undefined;
  });
  const download = page.waitForEvent("download");
  await exportButton.click();
  expect((await download).suggestedFilename()).toBe(`Garden plan ${today}.png`);
});


/** The long-form editor's page counter, e.g. "2/5". */
const pageCount = (page: Page) => page.getByRole("dialog", { name: "Long-form note" }).locator(".lf-page-count");

/** Opens the page menu and chooses one of its options. */
async function pageMenu(page: Page, option: string) {
  const editor = page.getByRole("dialog", { name: "Long-form note" });
  await editor.getByRole("button", { name: "Page options" }).click();
  await page.getByRole("menu", { name: "Page options" }).getByRole("menuitem", { name: option }).click();
}

/** Starts a new handwritten long-form note with this title, ready to write on. */
async function newHandwrittenLongForm(page: Page, title: string) {
  await turnOnStylusMode(page);
  await page.getByRole("button", { name: "Show all tags" }).click();
  await addArea(page).getByRole("button", { name: "Create long-form note" }).click();
  const editor = page.getByRole("dialog", { name: "Long-form note" });
  await editor.getByRole("textbox", { name: "Long-form note title" }).fill(title);
  await editor.getByRole("button", { name: "Accept title" }).click();
  return editor;
}

test("handwritten long-form details can have several pages, added, turned and deleted", async ({ page }) => {
  const editor = await newHandwrittenLongForm(page, "Garden pages");
  const details = editor.getByRole("img", { name: "Details of the long-form note" });
  const previous = editor.getByRole("button", { name: "Previous page" });
  const next = editor.getByRole("button", { name: "Next page" });
  await expect(pageCount(page)).toHaveText("1/1");
  await expect(previous).toBeDisabled();
  await draw(page, details, 0.2, 0.6);
  const firstInk = await inkPixels(details);
  expect(firstInk).toBeGreaterThan(0);

  // Next on the last page asks whether to add one: No stays put.
  await next.click();
  const ask = page.locator("dialog.confirm-dialog").filter({ hasText: "This is the last page. Add a new page?" });
  await ask.getByRole("button", { name: "No" }).click();
  await expect(ask).toBeHidden();
  await expect(pageCount(page)).toHaveText("1/1");

  // Yes adds a blank page and turns to it.
  await next.click();
  await ask.getByRole("button", { name: "Yes" }).click();
  await expect(pageCount(page)).toHaveText("2/2");
  await expect(details).toHaveCount(1);
  expect(await inkPixels(details)).toBe(0);
  await draw(page, details, 0.3, 0.4);
  const secondInk = await inkPixels(details);
  expect(secondInk).toBeGreaterThan(0);
  expect(secondInk).toBeLessThan(firstInk);

  // Turning back shows the first page as it was.
  await previous.click();
  await expect(pageCount(page)).toHaveText("1/2");
  expect(await inkPixels(details)).toBe(firstInk);

  // The menu: Previous is greyed out on the first page; Next and adding a page in the middle.
  await editor.getByRole("button", { name: "Page options" }).click();
  const menu = page.getByRole("menu", { name: "Page options" });
  await expect(menu.getByRole("menuitem", { name: "Previous page" })).toBeDisabled();
  await menu.getByRole("menuitem", { name: "Add page after this one" }).click();
  await expect(menu).toBeHidden();
  await expect(pageCount(page)).toHaveText("2/3");
  expect(await inkPixels(details)).toBe(0);
  await pageMenu(page, "Next page");
  await expect(pageCount(page)).toHaveText("3/3");
  expect(await inkPixels(details)).toBe(secondInk);

  // Every page is saved, blank ones included, and comes back when the note is opened again.
  await editor.getByRole("button", { name: "Finish" }).click();
  await expect(editor).toBeHidden();
  const saved = (await (await page.request.get("/api/notes")).json()) as { notes: { titleText?: string; detailsImage?: string; detailsMorePages?: string[] }[] };
  const note = saved.notes.find((n) => n.titleText === "Garden pages")!;
  expect(note.detailsImage).toMatch(/^data:image\/png;base64,/);
  expect(note.detailsMorePages).toHaveLength(2);
  expect(note.detailsMorePages![0]).toBe("");
  expect(note.detailsMorePages![1]).toMatch(/^data:image\/png;base64,/);

  await noteRow(page, "Garden pages").getByRole("button", { name: "Edit note" }).click();
  await expect(pageCount(page)).toHaveText("1/3");
  await expect.poll(() => inkPixels(details)).toBeGreaterThan(0);

  // Deleting a page asks first, then shows the page before it.
  await next.click();
  await next.click();
  await expect(pageCount(page)).toHaveText("3/3");
  await pageMenu(page, "Delete this page");
  const confirm = page.locator("dialog.confirm-dialog").filter({ hasText: "Delete this page?" });
  await confirm.getByRole("button", { name: "No" }).click();
  await expect(pageCount(page)).toHaveText("3/3");
  await pageMenu(page, "Delete this page");
  await confirm.getByRole("button", { name: "Yes" }).click();
  await expect(pageCount(page)).toHaveText("2/2");
  expect(await inkPixels(details)).toBe(0);

  // Deleting the first page shows the new first page; the last page can't be deleted.
  await previous.click();
  await pageMenu(page, "Delete this page");
  await confirm.getByRole("button", { name: "Yes" }).click();
  await expect(pageCount(page)).toHaveText("1/1");
  expect(await inkPixels(details)).toBe(0);
  await editor.getByRole("button", { name: "Page options" }).click();
  await expect(page.getByRole("menu", { name: "Page options" }).getByRole("menuitem", { name: "Delete this page" })).toBeDisabled();
  await page.keyboard.press("Escape");

  await editor.getByRole("button", { name: "Finish" }).click();
  await expect(editor).toBeHidden();
  const after = (await (await page.request.get("/api/notes")).json()) as { notes: { titleText?: string; detailsImage?: string; detailsMorePages?: string[] }[] };
  const one = after.notes.find((n) => n.titleText === "Garden pages")!;
  expect(one.detailsImage).toBe("");
  expect(one.detailsMorePages).toBeUndefined();
});

test("handwritten long-form details have at most 10 pages", async ({ page }) => {
  const editor = await newHandwrittenLongForm(page, "Ten pages");
  for (let i = 2; i <= 10; i++) {
    await pageMenu(page, "Add page after this one");
    await expect(pageCount(page)).toHaveText(`${i}/${i}`);
  }
  const next = editor.getByRole("button", { name: "Next page" });
  await expect(next).toBeDisabled();
  await expect(next).toHaveAttribute("title", "10 pages is the most a note can have");
  await editor.getByRole("button", { name: "Page options" }).click();
  const menu = page.getByRole("menu", { name: "Page options" });
  await expect(menu.getByRole("menuitem", { name: "Add page after this one" })).toBeDisabled();
  await expect(menu.getByRole("menuitem", { name: "Next page" })).toBeDisabled();
  await page.keyboard.press("Escape");
  // In the middle, Next turns the page, but there's still no adding one.
  await editor.getByRole("button", { name: "Previous page" }).click();
  await expect(pageCount(page)).toHaveText("9/10");
  await expect(next).toBeEnabled();
  await editor.getByRole("button", { name: "Page options" }).click();
  await expect(menu.getByRole("menuitem", { name: "Add page after this one" })).toBeDisabled();
  await page.keyboard.press("Escape");

  // The server refuses an 11th page too.
  const notes = (await (await page.request.get("/api/notes")).json()) as { notes: { id: number; titleText?: string; tagIds: number[] }[] };
  const note = notes.notes.find((n) => n.titleText === "Ten pages")!;
  const response = await page.request.put(`/api/notes/${note.id}`, {
    data: { titleText: "Ten pages", tagIds: [], detailsImage: "", detailsMorePages: Array(10).fill("") },
  });
  expect(response.status()).toBe(400);
  expect((await response.json()).error).toBe("The handwritten details have 11 pages; the most is 10.");
});

test("on a narrow screen, the Previous and Next page buttons are hidden, then the pen thickness button", async ({ page }) => {
  const editor = await newHandwrittenLongForm(page, "Narrow");
  await expect(editor.getByRole("button", { name: "Next page" })).toBeVisible();
  const pens = editor.getByRole("button", { name: "Pen thickness" });
  // A little narrower: Previous and Next go, and the pens stay.
  await page.setViewportSize({ width: 520, height: 800 });
  await expect(editor.getByRole("button", { name: "Next page" })).toBeHidden();
  await expect(editor.getByRole("button", { name: "Previous page" })).toBeHidden();
  await expect(editor.getByRole("button", { name: "Page options" })).toBeVisible();
  await expect(pens).toBeVisible();
  const finishWide = (await editor.getByRole("button", { name: "Finish" }).boundingBox())!;
  expect(finishWide.x + finishWide.width).toBeLessThanOrEqual(520);
  // Narrower still (a phone): the pens go too.
  await page.setViewportSize({ width: 420, height: 800 });
  await expect(pens).toBeHidden();
  await expect(editor.getByRole("button", { name: "Eraser" })).toBeVisible();
  await expect(editor.getByRole("button", { name: "Page options" })).toBeVisible();
  await expect(pageCount(page)).toHaveText("1/1");
  // Everything still fits: Finish is on the screen.
  const finish = (await editor.getByRole("button", { name: "Finish" }).boundingBox())!;
  expect(finish.x + finish.width).toBeLessThanOrEqual(420);
});

test("exporting several pages gives one long image, with blank pages left out", async ({ page }) => {
  const editor = await newHandwrittenLongForm(page, "Long export");
  const details = editor.getByRole("img", { name: "Details of the long-form note" });
  await page.evaluate(() => {
    const win = window as unknown as { heights: number[] };
    win.heights = [];
    navigator.canShare = () => true;
    navigator.share = async (data?: ShareData) => {
      const image = await createImageBitmap(data!.files![0]!);
      win.heights.push(image.height);
    };
  });
  const heights = () => page.evaluate(() => (window as unknown as { heights: number[] }).heights);
  await draw(page, details, 0.2, 0.6);
  await editor.getByRole("button", { name: "Export as image" }).click();
  await expect.poll(heights).toHaveLength(1);
  const [one] = await heights();

  // A blank page adds nothing; a second written page goes underneath the first.
  await pageMenu(page, "Add page after this one");
  await editor.getByRole("button", { name: "Export as image" }).click();
  await expect.poll(heights).toHaveLength(2);
  expect((await heights())[1]).toBe(one);
  await pageMenu(page, "Add page after this one");
  await draw(page, details, 0.2, 0.6);
  await editor.getByRole("button", { name: "Export as image" }).click();
  await expect.poll(heights).toHaveLength(3);
  expect((await heights())[2]).toBe(one! * 2 + 32);
});
