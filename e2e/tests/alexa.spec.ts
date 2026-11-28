import { sign } from "node:crypto";
import type { APIRequestContext, Page } from "@playwright/test";
import { alexaCertUrlIsAmazons, alexaCommandText, spokenDueForSpeech } from "../../shared/src/alexa";
import { readSpokenDue } from "../../shared/src/spokenDue";
import { ALEXA_TEST_KEY, OTHER_TEST_KEY } from "./alexaKeys";
import { expect, noteRow, openNotes, selectTab, test } from "./fixtures";

// The test server's fake Alexa (server/src/config.ts and fakeAlexa.ts): its skill ID, and its test certificates.
const SKILL_ID = "amzn1.ask.skill.00000000-0000-0000-0000-000000000000";
const WEBHOOK = "/api/alexa";
const MY_ALEXA = "amzn1.ask.account.TESTACCOUNT0001";

/** The test server's address for one of its test certificates. */
const certUrl = (name = "echo-api.pem") => `${test.info().project.use.baseURL}/api/test/alexa-certs/${name}`;

interface SayOptions {
  /** What Alexa heard after the command word (the `words` slot). */
  words?: string;
  /** The spoken code (the `code` slot of LinkIntent). */
  code?: string;
  /** False for a command in a session opened with "Alexa, open Nick Notes". */
  newSession?: boolean;
  alexaUserId?: string;
  type?: "IntentRequest" | "LaunchRequest" | "SessionEndedRequest";
  skillId?: string;
  timestamp?: string;
  certUrl?: string;
  key?: string;
  /** Sign something other than the body, as a forger would. */
  signed?: string;
  headers?: boolean;
}

interface Heard {
  status: number;
  speech?: string;
  reprompt?: string;
  endSession?: boolean;
}

/** A request from Alexa for an intent (or a launch), signed as Alexa signs it. Returns what Alexa would say. */
async function say(request: APIRequestContext, intent: string, options: SayOptions = {}): Promise<Heard> {
  const alexaUserId = options.alexaUserId ?? MY_ALEXA;
  const skillId = options.skillId ?? SKILL_ID;
  const type = options.type ?? "IntentRequest";
  const slots = {
    ...(options.words !== undefined && { words: { name: "words", value: options.words } }),
    ...(options.code !== undefined && { code: { name: "code", value: options.code } }),
  };
  const body = JSON.stringify({
    version: "1.0",
    session: { new: options.newSession ?? true, sessionId: "amzn1.echo-api.session.test", application: { applicationId: skillId }, user: { userId: alexaUserId } },
    context: { System: { application: { applicationId: skillId }, user: { userId: alexaUserId }, device: { deviceId: "test-device" } } },
    request: {
      type,
      requestId: `amzn1.echo-api.request.${Date.now()}`,
      timestamp: options.timestamp ?? new Date().toISOString(),
      locale: "en-GB",
      ...(type === "IntentRequest" && { intent: { name: intent, confirmationStatus: "NONE", slots } }),
    },
  });
  const signature = sign("sha256", Buffer.from(options.signed ?? body), options.key ?? ALEXA_TEST_KEY).toString("base64");
  const response = await request.post(WEBHOOK, {
    data: Buffer.from(body),
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(options.headers !== false && { SignatureCertChainUrl: options.certUrl ?? certUrl(), "Signature-256": signature }),
    },
  });
  if (!response.ok()) return { status: response.status() };
  const json = (await response.json()) as {
    response: { outputSpeech?: { text: string }; reprompt?: { outputSpeech: { text: string } }; shouldEndSession: boolean };
  };
  return {
    status: response.status(),
    speech: json.response.outputSpeech?.text,
    reprompt: json.response.reprompt?.outputSpeech.text,
    endSession: json.response.shouldEndSession,
  };
}

/** Links this Alexa account to the logged-in user, as Settings does: a code, said to Alexa. */
async function linkAlexa(request: APIRequestContext, alexaUserId = MY_ALEXA) {
  const { code } = (await (await request.post("/api/me/alexa/link-code")).json()) as { code: string };
  expect((await say(request, "LinkIntent", { code, alexaUserId })).speech).toBe("Linked. You can now add notes to nwsnotes.");
}

/** A device with reminders on, so notifications have somewhere to go. */
async function addDevice(request: APIRequestContext) {
  const response = await request.post("/api/push/subscribe", {
    data: { endpoint: `https://push.example.com/${Date.now()}`, keys: { p256dh: "test-key", auth: "test-auth" } },
  });
  expect(response.ok()).toBe(true);
}

async function notifications(request: APIRequestContext): Promise<{ title: string; body?: string }[]> {
  return (await (await request.get("/api/test/notifications")).json()) as { title: string; body?: string }[];
}

interface ApiNote {
  id: number;
  titleText?: string;
  tagIds: number[];
  dueDateTime?: string;
}

async function notes(request: APIRequestContext): Promise<ApiNote[]> {
  return ((await (await request.get("/api/notes")).json()) as { notes: ApiNote[] }).notes;
}

const lastNote = async (request: APIRequestContext) => (await notes(request)).at(-1)!;

async function emails(request: APIRequestContext): Promise<{ subject: string }[]> {
  return (await (await request.get("/api/test/emails")).json()) as { subject: string }[];
}

/** The Alexa section of Settings. */
const section = (page: Page) => page.locator("section.alexa");

test("linking Alexa in Settings with a spoken code, then unlinking it", async ({ page }) => {
  await page.goto("/settings");
  await expect(section(page).getByRole("heading", { name: "Alexa" })).toBeVisible();
  await expect(section(page)).toContainText('"Alexa, ask Nick Notes to add Work oat milk"');
  await section(page).getByRole("button", { name: "Link Alexa" }).click();
  const code = (await section(page).locator(".alexa-code-digits").textContent())!;
  expect(code).toMatch(/^\d{6}$/);
  await expect(section(page)).toContainText(`Say "Alexa, ask Nick Notes to link ${code}". The code works for 15 minutes.`);

  // Saying it links it, and the page changes by itself.
  expect((await say(page.request, "LinkIntent", { code })).speech).toBe("Linked. You can now add notes to nwsnotes.");
  await expect(section(page)).toContainText("Linked to Alexa");

  // The code only works once.
  expect((await say(page.request, "LinkIntent", { code, alexaUserId: "amzn1.ask.account.SOMEONEELSE" })).speech).toBe(
    "That code isn't right, or it's more than 15 minutes old. Make a new one in Settings and try again.",
  );

  // The users page shows who has Alexa linked.
  await page.goto("/settings/users");
  await expect(page.getByRole("list", { name: "Users" }).getByRole("listitem").filter({ hasText: "admin" })).toContainText("Alexa");

  await page.goto("/settings");
  await section(page).getByRole("button", { name: "Unlink" }).click();
  await expect(page.getByRole("dialog")).toContainText("Unlink Alexa? It will no longer add notes.");
  await page.getByRole("dialog").getByRole("button", { name: "Unlink" }).click();
  await expect(section(page).getByRole("button", { name: "Link Alexa" })).toBeVisible();
  await expect(section(page)).not.toContainText("Linked to Alexa");
  expect((await say(page.request, "AddIntent", { words: "work ring the bank" })).speech).toContain("isn't linked");
});

test("an Alexa that isn't linked adds nothing, and wrong codes are limited", async ({ page }) => {
  const before = (await notes(page.request)).length;
  const heard = await say(page.request, "AddIntent", { words: "work ring the bank" });
  expect(heard.speech).toBe("This Alexa isn't linked to nwsnotes yet. In nwsnotes, go to Settings, Alexa, and press Link Alexa.");
  expect(heard.endSession).toBe(true);
  expect((await say(page.request, "LaunchRequest", { type: "LaunchRequest" })).speech).toContain("isn't linked");
  expect(await notes(page.request)).toHaveLength(before);

  // A code that wasn't heard, then wrong ones: after 5, no more are checked, even the right one.
  expect((await say(page.request, "LinkIntent", {})).speech).toBe("Sorry, I didn't catch the code. Say link, then the 6 digits Settings shows.");
  for (let i = 0; i < 4; i++) {
    expect((await say(page.request, "LinkIntent", { code: "999999" })).speech).toContain("That code isn't right");
  }
  const { code } = (await (await page.request.post("/api/me/alexa/link-code")).json()) as { code: string };
  expect((await say(page.request, "LinkIntent", { code })).speech).toBe("Too many wrong codes. Wait a few minutes and make a new one in Settings.");
  expect(((await (await page.request.get("/api/me/alexa")).json()) as { linked: boolean }).linked).toBe(false);
  // Another Alexa account isn't held up by those.
  await linkAlexa(page.request, "amzn1.ask.account.ANOTHER");
});

test("a note said to Alexa goes into the tab it names, with the tab's tag, and is read back", async ({ page }) => {
  await linkAlexa(page.request);
  await addDevice(page.request);
  await openNotes(page);
  await selectTab(page, "Work");

  const heard = await say(page.request, "AddIntent", { words: "work ring the bank about the loan" });
  expect(heard.speech).toBe("Saved to Work: Ring the bank about the loan.");
  expect(heard.endSession).toBe(true);
  await expect(noteRow(page, "Ring the bank about the loan")).toBeVisible();
  expect((await lastNote(page.request)).tagIds.sort()).toEqual([-1, 1]);
  // Alexa has said so, so there's no notification.
  expect(await notifications(page.request)).toEqual([]);

  // Slips still find the tab; no tab matched goes to All; "new" and "note" have no tags.
  expect((await say(page.request, "AddIntent", { words: "homes fix the gate" })).speech).toBe("Saved to Home: Fix the gate.");
  expect(await lastNote(page.request)).toMatchObject({ titleText: "Fix the gate", tagIds: [2, -1] });
  expect((await say(page.request, "AddIntent", { words: "garden cut the hedge" })).speech).toBe(
    "Saved to All: Garden cut the hedge. No tab matched, so it has no tags.",
  );
  expect((await say(page.request, "NewIntent", { words: "call the plumber" })).speech).toBe("Saved to All: Call the plumber.");
  expect(await lastNote(page.request)).toMatchObject({ titleText: "Call the plumber", tagIds: [-1] });

  // A tab that doesn't show New notes says so.
  expect((await say(page.request, "AddIntent", { words: "on hold the loft" })).speech).toBe(
    "Saved to On hold: The loft. That tab doesn't show New notes.",
  );

  // The History says it was said to Alexa.
  await page.goto("/history");
  await expect(page.getByText('Added "Call the plumber" by Alexa')).toBeVisible();
});

test("a tab's spoken name works for Alexa, and its hint in the tab editor says so", async ({ page }) => {
  await linkAlexa(page.request);
  await page.goto("/settings");
  await page.getByRole("link", { name: /^Home/ }).click();
  await expect(page.getByText('An easier name to say when adding notes by text message or Alexa, e.g. "do it yourself" for "DIY".')).toBeVisible();
  await page.getByLabel("Spoken name (optional)").fill("house");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("link", { name: /^Home\s*\(house\)/ })).toBeVisible();
  expect((await say(page.request, "AddIntent", { words: "house descale the kettle" })).speech).toBe("Saved to Home: Descale the kettle.");
  expect(await lastNote(page.request)).toMatchObject({ titleText: "Descale the kettle", tagIds: [2, -1] });
});

test('"Alexa, open Nick Notes" keeps listening; "Alexa, ask Nick Notes to …" does one and stops', async ({ page }) => {
  await linkAlexa(page.request);
  const opened = await say(page.request, "", { type: "LaunchRequest" });
  expect(opened).toMatchObject({ speech: "What would you like to add?", reprompt: "What would you like to add?", endSession: false });

  const inSession = await say(page.request, "AddIntent", { words: "work the budget", newSession: false });
  expect(inSession).toMatchObject({ speech: "Saved to Work: The budget. Anything else?", reprompt: "Anything else?", endSession: false });
  const help = await say(page.request, "AMAZON.HelpIntent", { newSession: false });
  expect(help.speech).toContain("Say add, then a tab's name and the note, for example: add Shopping oat milk.");
  expect(help.endSession).toBe(false);
  const fallback = await say(page.request, "AMAZON.FallbackIntent", { newSession: false });
  expect(fallback).toMatchObject({
    speech: "Sorry, I didn't catch that. Start with add, new, due, reset new or email tab. For example: add Shopping oat milk. Anything else?",
    endSession: false,
  });
  // "Stop", "no" or "that's all" end it, with nothing said.
  expect(await say(page.request, "AMAZON.StopIntent", { newSession: false })).toEqual({ status: 200, endSession: true });
  expect(await say(page.request, "AMAZON.NoIntent", { newSession: false })).toEqual({ status: 200, endSession: true });
  expect(await say(page.request, "", { type: "SessionEndedRequest" })).toEqual({ status: 200, endSession: true });

  // One go.
  expect(await say(page.request, "NewIntent", { words: "book the car in" })).toMatchObject({ speech: "Saved to All: Book the car in.", endSession: true });
});

test('"due" sets the due date of the note just added, and says when', async ({ page }) => {
  await linkAlexa(page.request);
  await say(page.request, "AddIntent", { words: "work ring the bank" });
  const added = await lastNote(page.request);
  const read = readSpokenDue("tomorrow 3pm");
  if (!read.ok) throw new Error("tomorrow 3pm should be understood");
  expect((await say(page.request, "DueIntent", { words: "tomorrow at 3 p.m." })).speech).toBe(
    `Ring the bank, due ${spokenDueForSpeech(read.dueDateTime)}.`,
  );
  expect((await notes(page.request)).find((note) => note.id === added.id)!.dueDateTime).toBe(read.dueDateTime);
  const history = (await (await page.request.get("/api/history")).json()) as { changes: { summary: string }[] };
  expect(history.changes[0]!.summary).toBe('Set the due date of "Ring the bank" by Alexa');

  expect((await say(page.request, "DueIntent", {})).speech).toBe("Not set: say when it's due, for example: due tomorrow at 3pm.");
  expect((await say(page.request, "DueIntent", { words: "whenever you like" })).speech).toBe(
    "Not set: I couldn't understand whenever you like as a date and time.",
  );
});

test('"reset new" makes every New note Active', async ({ page }) => {
  await linkAlexa(page.request);
  await say(page.request, "NewIntent", { words: "one" });
  await say(page.request, "NewIntent", { words: "two" });
  // The seed's New note, and the two just said.
  expect((await say(page.request, "ResetNewIntent")).speech).toBe("3 notes made Active.");
  expect((await say(page.request, "ResetNewIntent")).speech).toBe("There were no New notes.");
});

test('"email tab" answers straight away, then the email is sent and a notification says so', async ({ page }) => {
  await linkAlexa(page.request);
  await addDevice(page.request);
  expect((await say(page.request, "EmailTabIntent", { words: "work" })).speech).toBe("Emailing Work.");
  await expect.poll(async () => (await emails(page.request)).map((email) => email.subject)).toEqual(["nwsnotes: Work (3 notes)"]);
  await expect.poll(async () => (await notifications(page.request)).at(-1)).toMatchObject({
    title: "Emailed Work",
    body: "3 notes, sent to admin@example.com.",
  });

  expect((await say(page.request, "EmailTabIntent", { words: "the garden" })).speech).toBe("Not emailed: there's no tab called the garden.");
  expect((await say(page.request, "EmailTabIntent", {})).speech).toBe("Not emailed: say which tab, for example: email tab Shopping.");
  expect(await emails(page.request)).toHaveLength(1);
});

test("failures are said out loud, reading back what was heard, and kept in a notification", async ({ page }) => {
  await linkAlexa(page.request);
  await addDevice(page.request);
  expect((await say(page.request, "AddIntent", { words: "work" })).speech).toBe("Nothing to save after the tab name.");
  expect((await say(page.request, "AddIntent", {})).speech).toBe("Nothing to save after add.");

  const count = (await notes(page.request)).length;
  const me = (await (await page.request.get("/api/me")).json()) as { id: number };
  expect((await page.request.put(`/api/users/${me.id}`, { data: { noteLimit: count } })).ok()).toBe(true);
  expect((await say(page.request, "AddIntent", { words: "work the budget" })).speech).toBe(
    `Not saved: work the budget. You've reached your limit of ${count} notes.`,
  );
  expect(await notes(page.request)).toHaveLength(count);
  expect((await notifications(page.request)).at(-1)).toMatchObject({
    title: "Not saved",
    body: `work the budget\n\nYou've reached your limit of ${count} notes.`,
  });

  // The database being down.
  expect((await page.request.put(`/api/users/${me.id}`, { data: { noteLimit: 1000 } })).ok()).toBe(true);
  await page.request.post("/api/test/database", { data: { reachable: false } });
  try {
    expect((await say(page.request, "AddIntent", { words: "work the budget" })).speech).toBe(
      "Not saved: work the budget. nwsnotes can't save right now. Please try again later.",
    );
  } finally {
    await page.request.post("/api/test/database", { data: { reachable: true } });
  }
});

test("at most 20 commands in 10 minutes from one Alexa account", async ({ page }) => {
  await linkAlexa(page.request);
  for (let i = 1; i <= 20; i++) {
    expect((await say(page.request, "NewIntent", { words: `note ${i}` })).speech).toBe(`Saved to All: Note ${i}.`);
  }
  expect((await say(page.request, "NewIntent", { words: "one too many" })).speech).toBe(
    "Not done: too many in the last few minutes. Wait a few minutes and try again.",
  );
  expect((await notes(page.request)).some((note) => note.titleText === "One too many")).toBe(false);
});

test("requests that aren't from Alexa, signed for this skill, are refused", async ({ page }) => {
  await linkAlexa(page.request);
  const before = (await notes(page.request)).length;
  const add = (options: SayOptions) => say(page.request, "AddIntent", { words: "work forged", ...options });
  // No signature; a signature of something else; a certificate address that isn't Amazon's; a certificate
  // naming another site; a request more than 150 seconds old; another skill.
  expect((await add({ headers: false })).status).toBe(400);
  expect((await add({ signed: "something else" })).status).toBe(400);
  expect((await add({ certUrl: "https://s3.amazonaws.com.example.com/echo.api/echo-api-cert.pem" })).status).toBe(400);
  expect((await add({ certUrl: certUrl("someone-else.pem"), key: OTHER_TEST_KEY })).status).toBe(400);
  expect((await add({ key: OTHER_TEST_KEY })).status).toBe(400);
  expect((await add({ timestamp: new Date(Date.now() - 151_000).toISOString() })).status).toBe(400);
  expect((await add({ skillId: "amzn1.ask.skill.11111111-1111-1111-1111-111111111111" })).status).toBe(400);
  expect(await notes(page.request)).toHaveLength(before);
  // Signed properly, it works.
  expect((await add({})).speech).toBe("Saved to Work: Forged.");
});

test.describe("unit tests", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "desktop", "Unit tests: once is enough.");
  });

  test("the certificate's address must be Amazon's", () => {
    for (const url of [
      "https://s3.amazonaws.com/echo.api/echo-api-cert.pem",
      "https://s3.amazonaws.com:443/echo.api/echo-api-cert.pem",
      "https://s3.amazonaws.com/echo.api/../echo.api/echo-api-cert.pem",
      "HTTPS://S3.AMAZONAWS.COM/echo.api/echo-api-cert.pem",
    ]) {
      expect(alexaCertUrlIsAmazons(url), url).toBe(true);
    }
    for (const url of [
      "http://s3.amazonaws.com/echo.api/echo-api-cert.pem",
      "https://notamazon.com/echo.api/echo-api-cert.pem",
      "https://s3.amazonaws.com/EcHo.aPi/echo-api-cert.pem",
      "https://s3.amazonaws.com/invalid.path/echo-api-cert.pem",
      "https://s3.amazonaws.com:563/echo.api/echo-api-cert.pem",
      "https://s3.amazonaws.com/echo.api/../invalid.path/echo-api-cert.pem",
      "https://user@s3.amazonaws.com/echo.api/echo-api-cert.pem",
      "not a url",
    ]) {
      expect(alexaCertUrlIsAmazons(url), url).toBe(false);
    }
  });

  test("an intent's words are put back together as a text", () => {
    expect(alexaCommandText("AddIntent", " shopping  oat milk ")).toBe("add shopping oat milk");
    expect(alexaCommandText("NewIntent", "call the plumber")).toBe("new call the plumber");
    expect(alexaCommandText("DueIntent", "tomorrow at 3pm")).toBe("due tomorrow at 3pm");
    expect(alexaCommandText("EmailTabIntent", "shopping")).toBe("email tab shopping");
    expect(alexaCommandText("ResetNewIntent", undefined)).toBe("reset new");
    expect(alexaCommandText("AddIntent", undefined)).toBe("add");
    expect(alexaCommandText("AMAZON.FallbackIntent", "hello")).toBeUndefined();
  });

  test("due dates are said in UK time, with the year only when it isn't this year", () => {
    const now = new Date("2026-11-20T12:00:00Z");
    expect(spokenDueForSpeech("2026-11-25T15:00:00Z", now)).toBe("Wednesday 25th November at 3pm");
    expect(spokenDueForSpeech("2026-11-21T09:30:00Z", now)).toBe("Saturday 21st November at 9:30am");
    expect(spokenDueForSpeech("2026-11-22T12:00:00Z", now)).toBe("Sunday 22nd November at midday");
    expect(spokenDueForSpeech("2026-11-23T00:00:00Z", now)).toBe("Monday 23rd November at midnight");
    expect(spokenDueForSpeech("2027-01-05T09:00:00Z", now)).toBe("Tuesday 5th January 2027 at 9am");
    // British Summer Time.
    expect(spokenDueForSpeech("2027-07-11T14:05:00Z", now)).toBe("Sunday 11th July 2027 at 3:05pm");
    expect(spokenDueForSpeech("2026-12-13T19:00:00Z", now)).toBe("Sunday 13th December at 7pm");
  });
});
