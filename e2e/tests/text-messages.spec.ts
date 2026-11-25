import { createHmac } from "node:crypto";
import type { APIRequestContext, Page } from "@playwright/test";
import { formatSpokenDue, readSpokenDue } from "../../shared/src/spokenDue";
import { expect, noteRow, noteTitles, openNotes, selectTab, shareTag, test } from "./fixtures";

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

  expect(reply((await text(page.request, "Add Work, ring the bank about the loan")).body)).toBeUndefined();
  await expect(noteRow(page, "Ring the bank about the loan")).toBeVisible();
  // Work's one tag (Area: Work, id 1), and New.
  expect((await lastNote(page.request)).tagIds.sort()).toEqual([-1, 1]);
  expect(await notifications(page.request)).toEqual([
    expect.objectContaining({ title: "Saved to Work", body: "Ring the bank about the loan" }),
  ]);

  // Slips and odd punctuation still find the tab.
  await text(page.request, "Add homes: fix the gate");
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

  await text(page.request, "Add House, descale the kettle");
  expect(await lastNote(page.request)).toMatchObject({ titleText: "Descale the kettle", tagIds: [2, -1] });

  // Spoken names can't clash with another tab's name.
  await page.getByRole("link", { name: /^Work/ }).click();
  await page.getByLabel("Spoken name (optional)").fill("home");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toContainText("Another tab already uses that name");
});

test("a text with no command word is a note in All with no tags, and the notification says so", async ({ page }) => {
  await linkPhone(page.request);
  await addDevice(page.request);
  await text(page.request, "call the garage about the tyres");
  expect(await lastNote(page.request)).toMatchObject({ titleText: "Call the garage about the tyres", tagIds: [-1] });
  expect((await notifications(page.request)).at(-1)).toEqual({
    title: "Saved to All",
    body: "Call the garage about the tyres\nIt didn't start with a command, so it has no tags.",
    tag: expect.stringMatching(/^sms-note-/),
    devices: 1,
  });
  await openNotes(page);
  expect(await noteTitles(page)).toContain("Call the garage about the tyres");

  // A tab's name without "Add" is just the start of the note; so are the old "App" commands.
  await text(page.request, "Work, ring the bank");
  expect(await lastNote(page.request)).toMatchObject({ titleText: "Work, ring the bank", tagIds: [-1] });
  expect(reply((await text(page.request, "App due tomorrow 3pm")).body)).toBeUndefined();
  expect(await lastNote(page.request)).toMatchObject({ titleText: "App due tomorrow 3pm", tagIds: [-1] });
  expect(reply((await text(page.request, "App email tab Work")).body)).toBeUndefined();
  expect(await lastNote(page.request)).toMatchObject({ titleText: "App email tab Work", tagIds: [-1] });
});

test('"New <title>" adds a note with no tags', async ({ page }) => {
  await linkPhone(page.request);
  await addDevice(page.request);
  // Even when the title starts with a tab's name.
  expect(reply((await text(page.request, "New: work out the budget")).body)).toBeUndefined();
  expect(await lastNote(page.request)).toMatchObject({ titleText: "Work out the budget", tagIds: [-1] });
  expect((await notifications(page.request)).at(-1)).toMatchObject({ title: "Saved to All", body: "Work out the budget" });
  const before = (await notes(page.request)).length;
  expect(reply((await text(page.request, "New.")).body)).toBe("Nothing to save after New.");
  expect(await notes(page.request)).toHaveLength(before);
});

test('"Reset New" makes every New note Active, as the Settings button does', async ({ page }) => {
  await linkPhone(page.request);
  await addDevice(page.request);
  // The seed's New note, and two texted in (texted notes are New).
  await text(page.request, "Add Work, the budget");
  await text(page.request, "Call the garage");
  const isNew = (note: { tagIds: number[] }) => note.tagIds.includes(-1);
  const newCount = (await notes(page.request)).filter(isNew).length;
  expect(newCount).toBe(3);

  expect(reply((await text(page.request, "reset new.")).body)).toBeUndefined();
  expect((await notes(page.request)).filter(isNew)).toHaveLength(0);
  expect((await notifications(page.request)).at(-1)).toMatchObject({ title: "Reset New", body: "3 notes made Active." });
  // It's in the History, as the button's is.
  await page.goto("/history");
  await expect(page.locator(".history-summary").first()).toHaveText("Reset New (3 notes made Active)");

  // Again, with none left.
  await text(page.request, "Reset New");
  expect((await notifications(page.request)).at(-1)).toMatchObject({ title: "Reset New", body: "There were no New notes." });

  // Only "Reset New" on its own: anything more is a note.
  await text(page.request, "Reset new the boiler timer");
  expect(await lastNote(page.request)).toMatchObject({ titleText: "Reset new the boiler timer", tagIds: [-1] });
});

test('"Add" with no tab matching: everything after "Add" is the title, with no tags', async ({ page }) => {
  await linkPhone(page.request);
  await addDevice(page.request);
  await text(page.request, "Add holidays, book the ferry");
  expect(await lastNote(page.request)).toMatchObject({ titleText: "Holidays, book the ferry", tagIds: [-1] });
  expect((await notifications(page.request)).at(-1)).toMatchObject({
    title: "Saved to All",
    body: "Holidays, book the ferry\nNo tab matched, so it has no tags.",
  });
  const before = (await notes(page.request)).length;
  expect(reply((await text(page.request, "Add")).body)).toBe("Nothing to save after Add.");
  expect(await notes(page.request)).toHaveLength(before);
});

test("a tab that hides New notes still gets the note, and the notification says so", async ({ page }) => {
  await linkPhone(page.request);
  await addDevice(page.request);
  await text(page.request, "Add On hold, the loft conversion");
  expect(await lastNote(page.request)).toMatchObject({ titleText: "The loft conversion", tagIds: [-1] });
  expect((await notifications(page.request)).at(-1)).toMatchObject({
    title: "Saved to On hold",
    body: "The loft conversion\nThis tab doesn't show New notes.",
  });
});

test("a tab whose filter has several tags in a category gives the note the first of them", async ({ page }) => {
  // Topic: Ideas (3), Shopping (4), Reading (5), in that order.
  const response = await page.request.post("/api/tabs", {
    data: { name: "Errands", categories: [{ categoryId: 2, tagIds: [5, 4] }] },
  });
  expect(response.status()).toBe(201);
  await linkPhone(page.request);
  await text(page.request, "Add Errands post the parcel");
  expect(await lastNote(page.request)).toMatchObject({ titleText: "Post the parcel", tagIds: [4, -1] });
});

test("failures get a text back, and a notification with the whole note", async ({ page }) => {
  await linkPhone(page.request);
  await addDevice(page.request);

  expect(reply((await text(page.request, "Add Work.")).body)).toBe("Nothing to save after the tab name.");

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
    expect(reply((await text(page.request, "Add Work, the budget")).body)).toBe(
      `Not saved: "Add Work, the budget" - nwsnotes can't save right now. Please send it again later.`,
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
  const added = await page.request.post("/api/users", { data: { displayName: "Sam", loginName: "sam@example.com" } });
  const { user, password } = (await added.json()) as { user: { id: number }; password: string };
  const sam = await browser.newContext({ baseURL: test.info().project.use.baseURL, storageState: { cookies: [], origins: [] } });
  try {
    expect((await sam.request.post("/api/login", { data: { loginName: "sam@example.com", password } })).ok()).toBe(true);
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

test("the admin can turn on a text back confirming each text that works, from the users page", async ({ page }) => {
  await linkPhone(page.request);
  expect(reply((await text(page.request, "Add Work, before it's on")).body)).toBeUndefined();

  // Turned on in the admin's own Edit form; the row then says so.
  await page.goto("/settings/users");
  const row = page.getByRole("list", { name: "Users" }).getByRole("listitem").filter({ hasText: "admin@example.com" });
  await expect(row).not.toContainText("Texts back");
  await row.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByLabel("Text back to confirm each text")).not.toBeChecked();
  await page.getByLabel("Text back to confirm each text").check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(row).toContainText("Texts back");

  // Each note saved, tab email, Reset New and phone linked gets a text back.
  expect(reply((await text(page.request, "Add Work, ring the bank")).body)).toBe(`Saved to Work: "Ring the bank"`);
  expect(reply((await text(page.request, "No tab for this one")).body)).toBe(`Saved to All: "No tab for this one"`);
  const long = reply((await text(page.request, `Add Work ${"word ".repeat(120)}`)).body)!;
  expect(long).toMatch(/^Saved to Work, cut short: "Word word .*\.\.\."$/);
  expect(long.length).toBeLessThanOrEqual(160);
  expect(reply((await text(page.request, "Email tab work")).body)).toMatch(/^Emailed Work \(\d+ notes\) to admin@example\.com\.$/);
  expect(reply((await text(page.request, "Reset New")).body)).toMatch(/^Reset New: \d+ notes made Active\.$/);
  expect(reply((await text(page.request, "Reset New")).body)).toBe("Reset New: there were no New notes.");
  const code = (await (await page.request.post("/api/me/sms/link-code")).json()) as { code: string };
  expect(reply((await text(page.request, code.code)).body)).toBe("Phone linked: notes you text from it will be added to nwsnotes.");
  // Failures are as before, and ignored texts still get nothing.
  expect(reply((await text(page.request, "Add Work")).body)).toBe("Nothing to save after the tab name.");
  expect(reply((await text(page.request, "STOP")).body)).toBeUndefined();

  // Turned off again (through the API, as the page does): no more texts back.
  const me = (await (await page.request.get("/api/me")).json()) as { id: number };
  const off = await page.request.put(`/api/users/${me.id}`, { data: { smsConfirmations: false } });
  expect(((await off.json()) as { smsConfirmations: boolean }).smsConfirmations).toBe(false);
  expect(reply((await text(page.request, "Add Work, after it's off")).body)).toBeUndefined();
  expect((await page.request.put(`/api/users/${me.id}`, { data: { smsConfirmations: "yes" } })).status()).toBe(400);
});

test("texts back are set for each user: another user's texts aren't confirmed", async ({ page, browser }) => {
  const added = await page.request.post("/api/users", { data: { displayName: "Sam", loginName: "sam@example.com" } });
  const { user, password } = (await added.json()) as { user: { id: number }; password: string };
  const sam = await browser.newContext({ baseURL: test.info().project.use.baseURL, storageState: { cookies: [], origins: [] } });
  try {
    expect((await sam.request.post("/api/login", { data: { loginName: "sam@example.com", password } })).ok()).toBe(true);
    await linkPhone(sam.request, "+447700900456");
    await linkPhone(page.request);
    await page.request.put(`/api/users/${user.id}`, { data: { smsConfirmations: true } });
    expect(reply((await text(page.request, "For Sam", { from: "+447700900456" })).body)).toBe(`Saved to All: "For Sam"`);
    expect(reply((await text(page.request, "For the admin")).body)).toBeUndefined();
    // Only the admin can set it.
    expect((await sam.request.put(`/api/users/${user.id}`, { data: { smsConfirmations: false } })).status()).toBe(403);
  } finally {
    await sam.close();
  }
});

// ---- Emailing a tab ---------------------------------------------------------------

interface SentEmail {
  to: string;
  toName?: string;
  subject: string;
  text: string;
  html: string;
}

/** The emails sent to the logged-in user's login email, oldest first. */
async function emails(request: APIRequestContext): Promise<SentEmail[]> {
  return (await (await request.get("/api/test/emails")).json()) as SentEmail[];
}

/** The note lines of an email's text. */
const emailedLines = (email: SentEmail) => email.text.split("\n").filter((line) => line.startsWith("- "));

test('"Email tab <name>" emails a summary of the notes that tab shows, with no text back', async ({ page }) => {
  await linkPhone(page.request);
  await addDevice(page.request);

  expect(reply((await text(page.request, "Email tab work")).body)).toBeUndefined();
  const [work] = await emails(page.request);
  expect(work!.to).toBe("admin@example.com");
  expect(work!.toName).toBe("Admin");
  expect(work!.subject).toBe("nwsnotes: Work (3 notes)");
  expect(work!.text).toContain("Your Work tab on ");
  // The notes the tab shows, in the notes page's order, without formatting markers.
  expect(emailedLines(work!)).toEqual(["- Plan the team meeting", "- Read the quarterly report", "- Old invoice"]);
  expect(work!.text).toContain("Open nwsnotes: ");
  expect(work!.html).toContain("<li");
  expect(work!.html).toContain("Plan the team meeting");
  // Nothing was added as a note.
  expect((await notes(page.request)).some((note) => note.titleText?.includes("email"))).toBe(false);
  expect((await notifications(page.request)).at(-1)).toEqual(
    expect.objectContaining({ title: "Emailed Work", body: "3 notes, sent to admin@example.com." }),
  );
});

test("the tab email follows the notes page: its order, Bin hidden, handwritten and long-form notes, due dates, UK time", async ({ page }) => {
  await linkPhone(page.request);
  // Put "Garden ideas" first, and give "Buy milk" a due date.
  const all = ((await (await page.request.get("/api/notes")).json()) as { notes: { id: number }[] }).notes.map((note) => note.id);
  expect((await page.request.put("/api/notes/order", { data: { noteOrder: [9, ...all.filter((id) => id !== 9)] } })).ok()).toBe(true);
  expect((await page.request.put("/api/notes/2", { data: { titleText: "Buy milk", tagIds: [2, 4, -1], dueDateTime: "2030-03-05T14:30:00.000Z" } })).ok()).toBe(true);

  expect(reply((await text(page.request, "E-mail tab Home.")).body)).toBeUndefined();
  const [home] = await emails(page.request);
  expect(home!.subject).toBe("nwsnotes: Home (5 notes)");
  // "Broken lamp" is in the Bin, so the tab doesn't show it.
  expect(emailedLines(home!)).toEqual([
    "- Garden ideas",
    "- Buy milk (due Tue, 5 Mar 2030, 14:30)",
    "- [Handwritten note]",
    "- Holiday plans (long-form note)",
    "- Book flights (in Holiday plans)",
  ]);

  // A tab with a Lifetime filter, and All.
  await text(page.request, "email tab on hold");
  expect(emailedLines((await emails(page.request)).at(-1)!)).toEqual(["- Read the quarterly report"]);
  await text(page.request, "Email tab all");
  const everything = (await emails(page.request)).at(-1)!;
  expect(everything.subject).toBe("nwsnotes: All (8 notes)");
  expect(emailedLines(everything)).not.toContain("- Broken lamp");
});

test("a tab's spoken name works in the email command, and an empty tab says so", async ({ page }) => {
  await linkPhone(page.request);
  const added = await page.request.post("/api/tabs", {
    data: { name: "DIY", spokenName: "do it yourself", categories: [{ categoryId: 2, tagIds: [3] }] },
  });
  expect(added.ok()).toBe(true);
  const empty = await page.request.post("/api/tabs", { data: { name: "Reading", categories: [{ categoryId: 2, tagIds: [5] }, { categoryId: 1, tagIds: [2] }] } });
  expect(empty.ok()).toBe(true);

  await text(page.request, "Email tab do it yourself");
  const diy = (await emails(page.request)).at(-1)!;
  expect(diy.subject).toBe("nwsnotes: DIY (1 note)");
  expect(emailedLines(diy)).toEqual(["- Garden ideas"]);

  await text(page.request, "Email tab reading");
  const reading = (await emails(page.request)).at(-1)!;
  expect(reading.subject).toBe("nwsnotes: Reading (0 notes)");
  expect(reading.text).toContain("This tab shows no notes.");
});

test("an email command naming no tab gets a text back, and sends nothing", async ({ page }) => {
  await linkPhone(page.request);
  await addDevice(page.request);
  expect(reply((await text(page.request, "Email tab holidays")).body)).toBe('Not emailed: no tab called "holidays".');
  expect(reply((await text(page.request, "Email tab")).body)).toBe('Not emailed: say which tab, e.g. "Email tab Shopping".');
  expect(reply((await text(page.request, "Email tab work and home")).body)).toBe('Not emailed: no tab called "work and home".');
  const long = `Email tab ${"very ".repeat(40)}long name`;
  const longReply = reply((await text(page.request, long)).body)!;
  expect(longReply).toMatch(/^Not emailed: no tab called "very very .*\.\.\."\.$/);
  expect(longReply.length).toBeLessThanOrEqual(160);
  expect(await emails(page.request)).toEqual([]);
  expect((await notifications(page.request)).at(-1)).toEqual(expect.objectContaining({ title: "Not emailed" }));
  // And nothing was saved as a note.
  expect((await notes(page.request)).some((note) => note.titleText?.toLowerCase().includes("email"))).toBe(false);
});

test("tab emails go only to the texting user's own email, with their own tabs", async ({ page, browser }) => {
  const added = await page.request.post("/api/users", { data: { displayName: "Kit", loginName: "kit@example.com" } });
  const { password } = (await added.json()) as { password: string };
  const kit = await (await browser.newContext({ storageState: { cookies: [], origins: [] } })).newPage();
  expect((await kit.request.post("/api/login", { data: { loginName: "kit@example.com", password } })).ok()).toBe(true);
  await linkPhone(kit.request, "+447700900456");

  // Kit has no tabs, so "Work" is none of theirs.
  expect(reply((await text(kit.request, "Email tab work", { from: "+447700900456" })).body)).toBe('Not emailed: no tab called "work".');
  await text(kit.request, "Email tab all", { from: "+447700900456" });
  const [kitsEmail] = await emails(kit.request);
  expect(kitsEmail!.to).toBe("kit@example.com");
  expect(kitsEmail!.subject).toBe("nwsnotes: All (0 notes)");
  expect(await emails(page.request)).toEqual([]);
  await kit.context().close();
});

test("at most 10 tab emails a day for each user", async ({ page }) => {
  await linkPhone(page.request);
  await addDevice(page.request);
  for (let i = 0; i < 10; i++) expect(reply((await text(page.request, "Email tab work")).body)).toBeUndefined();
  expect(await emails(page.request)).toHaveLength(10);
  expect(reply((await text(page.request, "Email tab work")).body)).toBe(
    "Not emailed: you've had 10 tab emails in the last day. Try again later.",
  );
  expect(await emails(page.request)).toHaveLength(10);
  // Notes can still be texted in.
  expect(reply((await text(page.request, "Add Work, still saved")).body)).toBeUndefined();
  expect((await lastNote(page.request)).titleText).toBe("Still saved");
});

// ---- "Due": setting the due date of the note just added ------------------------------

interface DueNote {
  id: number;
  titleText?: string;
  dueDateTime?: string;
  createdByUserId?: number;
  shared?: { ownerName: string };
}
const noteById = async (request: APIRequestContext, id: number) =>
  ((await (await request.get("/api/notes")).json()) as { notes: DueNote[] }).notes.find((note) => note.id === id)!;

/** Where a dictated date and time should land, and how replies show it. */
function expectedDue(when: string) {
  const read = readSpokenDue(when);
  if (!read.ok) throw new Error(`"${when}" should be a date and time in the future.`);
  return { dueDateTime: read.dueDateTime, shown: formatSpokenDue(read.dueDateTime) };
}

test('"Due" sets the due date of the note just texted in, or just added in the app', async ({ page }) => {
  await linkPhone(page.request);
  await addDevice(page.request);
  const me = (await (await page.request.get("/api/me")).json()) as { id: number };

  await text(page.request, "Add Work, ring the bank");
  const texted = await lastNote(page.request);
  const tomorrow = expectedDue("tomorrow 3pm");
  expect(reply((await text(page.request, "Due tomorrow at 3 p.m.")).body)).toBeUndefined();
  const withDue = await noteById(page.request, (texted as unknown as DueNote).id);
  expect(withDue).toMatchObject({ titleText: "Ring the bank", dueDateTime: tomorrow.dueDateTime, createdByUserId: me.id });
  expect((await notifications(page.request)).at(-1)).toEqual(expect.objectContaining({ title: `Due ${tomorrow.shown}`, body: "Ring the bank" }));

  // A note added in the app counts too, and a second "Due" replaces the date.
  const added = (await (await page.request.post("/api/notes", { data: { titleText: "Book the car in", tagIds: [] } })).json()) as DueNote;
  expect(added.createdByUserId).toBe(me.id);
  await text(page.request, "Due Friday");
  expect((await noteById(page.request, added.id)).dueDateTime).toBe(expectedDue("Friday").dueDateTime);
  await text(page.request, "Due date: the 25th of December at nine");
  expect((await noteById(page.request, added.id)).dueDateTime).toBe(expectedDue("25 December 9am").dueDateTime);
  // The earlier note keeps its own.
  expect((await noteById(page.request, withDue.id)).dueDateTime).toBe(tomorrow.dueDateTime);

  // It's in the History, and shows on the notes page.
  const history = (await (await page.request.get("/api/history")).json()) as { changes: { summary: string }[] };
  expect(history.changes[0]!.summary).toBe('Set the due date of "Book the car in" by text message');
  await openNotes(page);
  await expect(noteRow(page, "Book the car in")).toContainText("Due 25/12 09:00");

  // With confirmations on, it's confirmed by text.
  await page.request.put(`/api/users/${me.id}`, { data: { smsConfirmations: true } });
  const at = expectedDue("tomorrow 18:00");
  expect(reply((await text(page.request, "Due tomorrow 18:00")).body)).toBe(`Due ${at.shown}: "Book the car in"`);
});

test('"Due" gets a text back when it can\'t be set, and sets nothing', async ({ page }) => {
  await linkPhone(page.request);
  await addDevice(page.request);
  const note = (await (await page.request.post("/api/notes", { data: { titleText: "Pay the gas bill", tagIds: [] } })).json()) as DueNote;

  expect(reply((await text(page.request, "Due")).body)).toBe('Not set: say when it\'s due, e.g. "Due tomorrow 3pm".');
  expect(reply((await text(page.request, "Due whenever")).body)).toBe(`Not set: couldn't understand "whenever" as a date and time.`);
  expect(reply((await text(page.request, "Due 1/1/2026 9am")).body)).toBe(`Not set: ${formatSpokenDue("2026-01-01T09:00:00.000Z")} has already passed.`);
  expect(reply((await text(page.request, "Due yesterday")).body)).toMatch(/^Not set: couldn't understand/);
  expect((await noteById(page.request, note.id)).dueDateTime).toBeUndefined();
  expect((await notifications(page.request)).at(-1)).toEqual(
    expect.objectContaining({ title: "Due date not set", body: "Couldn't understand \"yesterday\" as a date and time." }),
  );

  // A long-form note can't have one.
  await page.request.post("/api/notes", { data: { titleText: "Trip plans", tagIds: [], detailsText: "" } });
  expect(reply((await text(page.request, "Due tomorrow")).body)).toBe("Not set: your last note is a long-form note, which can't have a due date.");
});

test('"Due" only counts the user\'s own note from the last 5 minutes, not one others added to their notebook', async ({ page, browser }) => {
  await linkPhone(page.request);
  // Added offline 6 minutes ago, so it was created then.
  const old = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  const oldNote = (await (await page.request.post("/api/notes", { data: { titleText: "Old one", tagIds: [], createdDateTime: old } })).json()) as DueNote;
  expect(reply((await text(page.request, "Due tomorrow")).body)).toBe("Not set: you haven't added a note in the last 5 minutes.");
  expect((await noteById(page.request, oldNote.id)).dueDateTime).toBeUndefined();

  // Sam, who the admin shares Shopping with, adds a note in the admin's notebook: it isn't the admin's to date.
  const added = await page.request.post("/api/users", { data: { displayName: "Sam", loginName: "sam@example.com" } });
  const { user, password } = (await added.json()) as { user: { id: number }; password: string };
  await shareTag(page.request, 4, [{ loginName: "sam@example.com", permission: "edit" }]);
  const sam = await browser.newContext({ baseURL: test.info().project.use.baseURL, storageState: { cookies: [], origins: [] } });
  try {
    expect((await sam.request.post("/api/login", { data: { loginName: "sam@example.com", password } })).ok()).toBe(true);
    const samsNote = (await (await sam.request.post("/api/notes", { data: { titleText: "Sam's eggs", tagIds: [4] } })).json()) as DueNote;
    expect(samsNote.shared?.ownerName).toBe("Admin");
    const inAdmins = await noteById(page.request, samsNote.id);
    expect(inAdmins.createdByUserId).toBe(user.id);
    expect(reply((await text(page.request, "Due tomorrow")).body)).toBe("Not set: you haven't added a note in the last 5 minutes.");
    expect((await noteById(page.request, samsNote.id)).dueDateTime).toBeUndefined();

    // Sam's own "Due" finds it, but only the admin sets due dates on the admin's notes.
    await linkPhone(sam.request, "+447700900456");
    expect(reply((await text(sam.request, "Due tomorrow", { from: "+447700900456" })).body)).toBe(
      "Not set: your last note is in Admin's notebook, so only they can set its due date.",
    );
  } finally {
    await sam.close();
  }
});
