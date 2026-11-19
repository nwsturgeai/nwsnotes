import type { Locator, Page } from "@playwright/test";
import { addArea, expect, openNotes, test } from "./fixtures";

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

test("the long-form editor has pen-thickness buttons beside the eraser, sharing the setting", async ({ page }) => {
  await turnOnStylusMode(page);
  await page.getByRole("button", { name: "Show all tags" }).click();
  await addArea(page).getByRole("button", { name: "Create long-form note" }).click();
  const editor = page.getByRole("dialog", { name: "Long-form note" });
  await editor.getByRole("textbox", { name: "Long-form note title" }).fill("Thick and thin");
  await editor.getByRole("button", { name: "Accept title" }).click();

  const pens = editor.getByRole("radiogroup", { name: "Pen thickness" }).getByRole("radio");
  await expect(pens).toHaveCount(3);
  await expect(editor.getByRole("radio", { name: "Pen thickness 2.5px" })).toHaveAttribute("aria-checked", "true");

  // Right of the eraser with a wider gap, and Cancel then Finish at the far right of the row.
  const eraser = editor.getByRole("button", { name: "Eraser" });
  const eraserBox = (await eraser.boundingBox())!;
  const firstPen = (await pens.first().boundingBox())!;
  const secondPen = (await pens.nth(1).boundingBox())!;
  expect(Math.round(firstPen.x - (eraserBox.x + eraserBox.width))).toBe(16);
  expect(Math.round(secondPen.x - (firstPen.x + firstPen.width))).toBe(4);
  const cancel = (await editor.getByRole("button", { name: "Cancel" }).boundingBox())!;
  const finish = (await editor.getByRole("button", { name: "Finish" }).boundingBox())!;
  const row = (await page.locator(".lf-finish").boundingBox())!;
  expect(Math.round(row.x + row.width - (finish.x + finish.width))).toBe(0);
  expect(cancel.x).toBeLessThan(finish.x);
  expect(finish.width).toBe(40);

  // Choosing a thickness turns the eraser off, and draws at it.
  await eraser.click();
  await expect(eraser).toHaveAttribute("aria-pressed", "true");
  await editor.getByRole("radio", { name: "Pen thickness 4.5px" }).click();
  await expect(eraser).toHaveAttribute("aria-pressed", "false");
  await expect(editor.getByRole("radio", { name: "Pen thickness 4.5px" })).toHaveAttribute("aria-checked", "true");
  const details = editor.getByRole("img", { name: "Details of the long-form note" });
  await draw(page, details, 0.2, 0.4);
  const thick = await inkPixels(details);
  await editor.getByRole("radio", { name: "Pen thickness 1.5px" }).click();
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

