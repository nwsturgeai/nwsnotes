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
