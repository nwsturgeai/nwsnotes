import { createHmac } from "node:crypto";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, noteRow, noteTitles, openNotes, selectTab, test } from "./fixtures";

// The test server's fake Twilio (server/src/config.ts): its auth token and number, and the address it signs.
const AUTH_TOKEN = "test-twilio-auth-token";
const SMS_NUMBER = "+447700900000";
const WEBHOOK = "/api/sms/incoming";
const MY_PHONE = "+447700900123";

let sidCount = 0;

/** Twilio's signature: HMAC-SHA1 of the full address and the sorted form fields, keyed with the auth token. */
function sign(url: string, fields: Record<string, string>): string {
  const data = Object.keys(fields)
    .sort()
    .reduce((text, key) => text + key + fields[key], url);
  return createHmac("sha1", AUTH_TOKEN).update(data).digest("base64");
}

/** A text arriving at the nwsnotes number, as Twilio posts it. Returns the TwiML answer. */
async function text(
  request: APIRequestContext,
  body: string,
  options: { from?: string; sid?: string; signature?: string; host?: string } = {},
) {
  const fields = {
    MessageSid: options.sid ?? `SM${Date.now()}${sidCount++}`,
    AccountSid: "ACtest",
    From: options.from ?? MY_PHONE,
    To: SMS_NUMBER,
    Body: body,
    NumMedia: "0",
  };
  // Signed for the address Twilio posts to: the test server's own, or another name (`host`) it's reached by.
  const url = options.host ? `http://${options.host}${WEBHOOK}` : `${test.info().project.use.baseURL}${WEBHOOK}`;
  const response = await request.post(WEBHOOK, {
    form: fields,
    headers: { "X-Twilio-Signature": options.signature ?? sign(url, fields), ...(options.host && { Host: options.host }) },
  });
  return { status: response.status(), body: await response.text() };
}

/** The text sent back, from a TwiML answer, or undefined when nothing is sent. */
function reply(twiml: string): string | undefined {
  const message = /<Message>([\s\S]*)<\/Message>/.exec(twiml)?.[1];
  return message?.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** Links the phone to the logged-in user, as the Settings page does, by texting the code from it. */
async function linkPhone(request: APIRequestContext, from = MY_PHONE) {
  const code = (await (await request.post("/api/me/sms/link-code")).json()) as { code: string };
  expect(reply((await text(request, code.code, { from })).body)).toBeUndefined();
}

/** A device with reminders on, so notifications have somewhere to go. */
async function addDevice(request: APIRequestContext) {
  const response = await request.post("/api/push/subscribe", {
    data: { endpoint: `https://push.example.com/${Date.now()}`, keys: { p256dh: "test-key", auth: "test-auth" } },
  });
  expect(response.ok()).toBe(true);
}

/** The notifications sent to the logged-in user's devices, oldest first. */
async function notifications(request: APIRequestContext): Promise<{ title: string; body?: string }[]> {
  return (await (await request.get("/api/test/notifications")).json()) as { title: string; body?: string }[];
}

async function notes(request: APIRequestContext): Promise<{ titleText?: string; tagIds: number[] }[]> {
  return ((await (await request.get("/api/notes")).json()) as { notes: { titleText?: string; tagIds: number[] }[] }).notes;
}

const lastNote = async (request: APIRequestContext) => (await notes(request)).at(-1)!;

/** The Text messages section of Settings. */
const section = (page: Page) => page.locator("section.text-messages");

test("linking a phone in Settings with a texted code, then unlinking it", async ({ page }) => {
  await page.goto("/settings");
  await expect(section(page).getByRole("heading", { name: "Text messages" })).toBeVisible();
  await expect(section(page)).toContainText("07700 900000");
  await section(page).getByRole("button", { name: "Link my phone" }).click();
  const code = (await section(page).locator(".sms-code-digits").textContent())!;
  expect(code).toMatch(/^\d{6}$/);
  await expect(section(page).getByRole("link", { name: "07700 900000" })).toHaveAttribute("href", `sms:${SMS_NUMBER}?body=${code}`);

  // Texting it from the phone links it: no text back, and the page changes by itself.
  expect(reply((await text(page.request, code)).body)).toBeUndefined();
  await expect(section(page)).toContainText("Linked to 07700 900123");

  // The code only works once: from another phone it's just a text from an unlinked number.
  expect(reply((await text(page.request, code, { from: "+447700900999" })).body)).toBeUndefined();

  await section(page).getByRole("button", { name: "Unlink" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Unlink" }).click();
  await expect(section(page).getByRole("button", { name: "Link my phone" })).toBeVisible();
  await text(page.request, "Shopping, eggs");
  expect((await lastNote(page.request)).titleText).not.toBe("Eggs");
});

test("linking a phone sends a notification to the user's devices", async ({ page }) => {
  await addDevice(page.request);
  await linkPhone(page.request);
  expect(await notifications(page.request)).toEqual([
    expect.objectContaining({ title: "Phone linked", body: "Notes texted from 07700 900123 will be added here." }),
  ]);
});

test("a wrong or expired code links nothing, and the users page shows who has a phone", async ({ page }) => {
  const before = (await notes(page.request)).length;
  expect(reply((await text(page.request, "123456")).body)).toBeUndefined();
  expect(reply((await text(page.request, "Buy milk")).body)).toBeUndefined();
  expect(await notes(page.request)).toHaveLength(before);
  expect(((await (await page.request.get("/api/me/sms")).json()) as { linked: boolean }).linked).toBe(false);

  await linkPhone(page.request);
  await page.goto("/settings/users");
  await expect(page.getByRole("list", { name: "Users" }).getByRole("listitem").filter({ hasText: "admin" })).toContainText("Phone");
});

test("a texted note goes into the tab it names, with the tab's tag, and appears straight away", async ({ page }) => {
  await linkPhone(page.request);
  await addDevice(page.request);
  await openNotes(page);
  await selectTab(page, "Work");

  expect(reply((await text(page.request, "Work, ring the bank about the loan")).body)).toBeUndefined();
  await expect(noteRow(page, "Ring the bank about the loan")).toBeVisible();
  // Work's one tag (Area: Work, id 1), and New.
  expect((await lastNote(page.request)).tagIds.sort()).toEqual([-1, 1]);
  expect(await notifications(page.request)).toEqual([
    expect.objectContaining({ title: "Saved to Work", body: "Ring the bank about the loan" }),
  ]);

  // Slips and odd punctuation still find the tab.
  await text(page.request, "homes: fix the gate");
  expect(await lastNote(page.request)).toMatchObject({ titleText: "Fix the gate", tagIds: [2, -1] });

  // The History says it was texted in.
  await page.goto("/history");
  await expect(page.getByText('Added "Fix the gate" by text message')).toBeVisible();
});

test("a spoken name, set in the tab editor, puts texted notes in that tab", async ({ page }) => {
  await linkPhone(page.request);
  await page.goto("/settings");
  await page.getByRole("link", { name: /^Home/ }).click();
  await page.getByLabel("Spoken name (optional)").fill("house");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("link", { name: /^Home\s*\(house\)/ })).toBeVisible();

  await text(page.request, "House, descale the kettle");
  expect(await lastNote(page.request)).toMatchObject({ titleText: "Descale the kettle", tagIds: [2, -1] });

  // Spoken names can't clash with another tab's name.
  await page.getByRole("link", { name: /^Work/ }).click();
  await page.getByLabel("Spoken name (optional)").fill("home");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toContainText("Another tab already uses that name");
});

test("with no tab named, the note goes to All with no tags, and the notification says so", async ({ page }) => {
  await linkPhone(page.request);
  await addDevice(page.request);
  await text(page.request, "call the garage about the tyres");
  expect(await lastNote(page.request)).toMatchObject({ titleText: "Call the garage about the tyres", tagIds: [-1] });
  expect((await notifications(page.request)).at(-1)).toEqual({
    title: "Saved to All",
    body: "Call the garage about the tyres\nNo tab matched, so it has no tags.",
    tag: expect.stringMatching(/^sms-note-/),
    devices: 1,
  });
  await openNotes(page);
  expect(await noteTitles(page)).toContain("Call the garage about the tyres");
});

test("a tab that hides New notes still gets the note, and the notification says so", async ({ page }) => {
  await linkPhone(page.request);
  await addDevice(page.request);
  await text(page.request, "On hold, the loft conversion");
  expect(await lastNote(page.request)).toMatchObject({ titleText: "The loft conversion", tagIds: [-1] });
  expect((await notifications(page.request)).at(-1)).toMatchObject({
    title: "Saved to On hold",
    body: "The loft conversion\nThis tab doesn't show New notes.",
  });
});

test('"top" after the tab\'s name adds the note at the top of that tab', async ({ page }) => {
  await linkPhone(page.request);
  await addDevice(page.request);
  await openNotes(page);
  await selectTab(page, "Work");
  const firstBefore = (await noteTitles(page))[0];

  expect(reply((await text(page.request, "Work top, call Dave about the invoice")).body)).toBeUndefined();
  // At the top of Work straight away, above the note that was first.
  await expect.poll(async () => (await noteTitles(page))[0]).toBe("Call Dave about the invoice");
  expect((await noteTitles(page))[1]).toBe(firstBefore);
  expect((await notifications(page.request)).at(-1)).toMatchObject({
    title: "Saved to the top of Work",
    body: "Call Dave about the invoice",
  });

  // Without "top", a note goes to the bottom as usual; "topsoil" isn't "top".
  await text(page.request, "Work topsoil for the planters");
  await expect.poll(async () => (await noteTitles(page)).at(-1)).toBe("Topsoil for the planters");
  expect((await noteTitles(page))[0]).toBe("Call Dave about the invoice");

  // The History has the note added, then the new order.
  await page.goto("/history");
  await expect(page.getByText('Added "Call Dave about the invoice" by text message')).toBeVisible();
  await expect(page.getByText("Changed the order of the notes").first()).toBeVisible();
});

test('only "top" after the tab\'s name saves nothing, and texts back', async ({ page }) => {
  await linkPhone(page.request);
  const before = (await notes(page.request)).length;
  expect(reply((await text(page.request, "Work, top.")).body)).toBe("Nothing to save after the tab name.");
  expect(await notes(page.request)).toHaveLength(before);
});

test("a tab whose filter has several tags in a category gives the note the first of them", async ({ page }) => {
  // Topic: Ideas (3), Shopping (4), Reading (5), in that order.
  const response = await page.request.post("/api/tabs", {
    data: { name: "Errands", categories: [{ categoryId: 2, tagIds: [5, 4] }] },
  });
  expect(response.status()).toBe(201);
  await linkPhone(page.request);
  await text(page.request, "Errands post the parcel");
  expect(await lastNote(page.request)).toMatchObject({ titleText: "Post the parcel", tagIds: [4, -1] });
});

test("failures get a text back, and a notification with the whole note", async ({ page }) => {
  await linkPhone(page.request);
  await addDevice(page.request);

  expect(reply((await text(page.request, "Work.")).body)).toBe("Nothing to save after the tab name.");

  // The note limit (the seed's notes plus one more).
  const count = (await notes(page.request)).length;
  const me = (await (await page.request.get("/api/me")).json()) as { id: number };
  expect((await page.request.put(`/api/users/${me.id}`, { data: { noteLimit: count } })).ok()).toBe(true);
  const answer = reply((await text(page.request, "Shopping, a very long list of things to buy for the weekend away")).body);
  expect(answer).toBe(`Not saved: "Shopping, a very long list of things to buy for the weekend away" - you've reached your limit of ${count} notes.`);
  expect(answer!.length).toBeLessThanOrEqual(160);
  expect(await notes(page.request)).toHaveLength(count);
  expect((await notifications(page.request)).at(-1)).toMatchObject({
    title: "Not saved",
    body: `Shopping, a very long list of things to buy for the weekend away\n\nYou've reached your limit of ${count} notes.`,
  });
});

test("the database being down gets a text back saying to send it again later", async ({ page }) => {
  await linkPhone(page.request);
  await page.request.post("/api/test/database", { data: { reachable: false } });
  try {
    expect(reply((await text(page.request, "Work, the budget")).body)).toBe(
      `Not saved: "Work, the budget" - nwsnotes can't save right now. Please send it again later.`,
    );
  } finally {
    await page.request.post("/api/test/database", { data: { reachable: true } });
  }
});

test("too many texts: the first one past the limit is told, then they're ignored", async ({ page }) => {
  await linkPhone(page.request);
  for (let i = 1; i <= 20; i++) expect(reply((await text(page.request, `Note ${i}`)).body)).toBeUndefined();
  expect(reply((await text(page.request, "Note 21")).body)).toMatch(/^Not saved: "Note 21" - too many texts/);
  expect(reply((await text(page.request, "Note 22")).body)).toBeUndefined();
  expect((await lastNote(page.request)).titleText).toBe("Note 20");
});

test("a text sent twice adds one note; opt-out words and unsigned requests add nothing", async ({ page }) => {
  await linkPhone(page.request);
  const before = (await notes(page.request)).length;
  await text(page.request, "Shopping, eggs", { sid: "SMrepeated" });
  await text(page.request, "Shopping, eggs", { sid: "SMrepeated" });
  expect(await notes(page.request)).toHaveLength(before + 1);

  expect(reply((await text(page.request, "STOP")).body)).toBeUndefined();
  expect(reply((await text(page.request, " help ")).body)).toBeUndefined();
  expect(await notes(page.request)).toHaveLength(before + 1);

  const forged = await text(page.request, "Shopping, forged", { signature: "not-the-signature" });
  expect(forged.status).toBe(403);
  const unsigned = await page.request.post(WEBHOOK, { form: { From: MY_PHONE, Body: "Shopping, unsigned" } });
  expect(unsigned.status()).toBe(403);
  expect(await notes(page.request)).toHaveLength(before + 1);
});

test("a text signed for another name the site is reached by (e.g. the old address) is accepted", async ({ page }) => {
  await linkPhone(page.request);
  // Twilio's webhook still on the old name, with publicUrl already the new one (or the other way round).
  const answer = await text(page.request, "Shopping, eggs", { host: "nwsnotes.duckdns.org" });
  expect(answer.status).toBe(200);
  expect((await lastNote(page.request)).titleText).toBe("Shopping, eggs");

  // But it must be signed for the name it actually came in on.
  const fields = { MessageSid: "SMwrongname", From: MY_PHONE, To: SMS_NUMBER, Body: "Shopping, wrong name" };
  const wrongName = await page.request.post(WEBHOOK, {
    form: fields,
    headers: { Host: "nwsnotes.duckdns.org", "X-Twilio-Signature": sign(`http://elsewhere.example${WEBHOOK}`, fields) },
  });
  expect(wrongName.status()).toBe(403);
});

test("texts go to the linked user's own notebook, and a turned-off account gets a text back", async ({ page, browser }) => {
  // A second user, who links their own phone.
  const added = await page.request.post("/api/users", { data: { displayName: "Sam", loginName: "sam" } });
  const { user, password } = (await added.json()) as { user: { id: number }; password: string };
  const sam = await browser.newContext({ baseURL: test.info().project.use.baseURL, storageState: { cookies: [], origins: [] } });
  try {
    expect((await sam.request.post("/api/login", { data: { loginName: "sam", password } })).ok()).toBe(true);
    await linkPhone(sam.request, "+447700900456");
    await linkPhone(page.request);

    await text(page.request, "For the admin", { from: MY_PHONE });
    await text(page.request, "For Sam", { from: "+447700900456" });
    expect((await notes(sam.request)).map((note) => note.titleText)).toEqual(["For Sam"]);
    expect((await notes(page.request)).map((note) => note.titleText)).not.toContain("For Sam");

    await page.request.put(`/api/users/${user.id}`, { data: { disabled: true } });
    expect(reply((await text(page.request, "Another one", { from: "+447700900456" })).body)).toBe(
      `Not saved: "Another one" - your nwsnotes account is turned off.`,
    );
  } finally {
    await sam.close();
  }
});
