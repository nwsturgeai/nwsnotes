import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "./fixtures";

/*
 * Google Calendar (Specs/google-calendar.md), against the fake Google in the test server (see
 * server/src/fakeGoogle.ts). The seed's categories: Area (single-select: Work 1, Home 2) and Topic
 * (Ideas 3, Shopping 4, Reading 5). Note 2 is "Buy milk" (Home, Shopping); note 6 is handwritten; note 7,
 * "Holiday plans", is long-form with typed details.
 */
test.beforeEach(() => {
  test.skip(test.info().project.name !== "desktop", "Through the API, apart from Settings: once is enough.");
});

interface EventTime {
  dateTime?: string;
  date?: string;
}
interface FakeEvent {
  id: string;
  summary?: string;
  description?: string;
  start?: EventTime;
  end?: EventTime;
  recurrence?: string[];
  reminders?: { useDefault: boolean; overrides?: { method: string; minutes: number }[] };
  extendedProperties?: { private?: Record<string, string> };
}
interface FakeCalendar {
  id: string;
  summary: string;
  timeZone?: string;
  events: FakeEvent[];
  channels: number;
}
interface ApiNote {
  id: number;
  titleText?: string;
  titleImage?: string;
  detailsText?: string;
  detailsImage?: string;
  tagIds: number[];
  dueDateTime?: string;
  allDay?: boolean;
}

const control = "/api/test/google/control";
const WORK = 1;
const HOME = 2;
const IDEAS = 3;
const SHOPPING = 4;
const NEW = -1;
const BIN = -4;
/** In the future, and in GMT, so UK time is UTC. */
const DUE = "2030-01-02T10:00:00.000Z";

async function connect(request: APIRequestContext) {
  const response = await request.get("/api/google/connect");
  expect(new URL(response.url()).search).toBe("?google=connected");
}

async function calendar(request: APIRequestContext): Promise<FakeCalendar> {
  const calendars = (await (await request.get(`${control}/calendars`)).json()) as FakeCalendar[];
  expect(calendars).toHaveLength(1);
  return calendars[0]!;
}

/** The event of a note (by the note id it carries). */
async function eventOf(request: APIRequestContext, noteId: number): Promise<FakeEvent | undefined> {
  return (await calendar(request)).events.find((event) => event.extendedProperties?.private?.nwsnotesNoteId === String(noteId));
}

/** Syncs now, as the webhook or the 5-minute check would, and waits for it. */
async function sync(request: APIRequestContext) {
  expect((await request.post("/api/test/google-sync")).ok()).toBe(true);
}

async function notes(request: APIRequestContext): Promise<ApiNote[]> {
  return ((await (await request.get("/api/notes")).json()) as { notes: ApiNote[] }).notes;
}

async function note(request: APIRequestContext, id: number): Promise<ApiNote> {
  return (await notes(request)).find((n) => n.id === id)!;
}

/** Edits a note in nwsnotes, as the page would: everything as it is, with `change` on top. */
async function edit(request: APIRequestContext, id: number, change: Partial<ApiNote>) {
  const { titleText, titleImage, detailsText, detailsImage, tagIds, dueDateTime } = await note(request, id);
  const body = { titleText, titleImage, detailsText, detailsImage, tagIds, dueDateTime, ...change };
  const response = await request.put(`/api/notes/${id}`, { data: body });
  expect(response.ok(), await response.text()).toBe(true);
}

async function setLifetime(request: APIRequestContext, id: number, lifetime: string) {
  expect((await request.put(`/api/notes/${id}/lifetime`, { data: { lifetime } })).ok()).toBe(true);
}

/** Adds an event in Google, as the person would. */
async function addEvent(request: APIRequestContext, event: Partial<FakeEvent>): Promise<FakeEvent> {
  const cal = await calendar(request);
  const response = await request.post(`${control}/calendars/${encodeURIComponent(cal.id)}/events`, { data: event });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as FakeEvent;
}

/** Changes an event in Google, as the person would. */
async function changeEvent(request: APIRequestContext, eventId: string, change: Partial<FakeEvent>) {
  const cal = await calendar(request);
  const response = await request.patch(`${control}/calendars/${encodeURIComponent(cal.id)}/events/${eventId}`, { data: change });
  expect(response.ok(), await response.text()).toBe(true);
}

async function deleteEvent(request: APIRequestContext, eventId: string) {
  const cal = await calendar(request);
  expect((await request.delete(`${control}/calendars/${encodeURIComponent(cal.id)}/events/${eventId}`)).status()).toBe(204);
}

/** The note made from an event (the newest note with that title). */
async function noteTitled(request: APIRequestContext, title: string): Promise<ApiNote | undefined> {
  return (await notes(request)).filter((n) => n.titleText === title).at(-1);
}

const userTags = (n: ApiNote | undefined) => (n?.tagIds ?? []).filter((id) => id > 0).sort();

test("connecting makes an nwsnotes calendar, and a note's due date becomes an event", async ({ page }) => {
  const request = page.request;
  expect(await (await request.get("/api/google")).json()).toEqual({ connected: false });
  await connect(request);
  expect(await (await request.get("/api/google")).json()).toEqual({ connected: true });
  const cal = await calendar(request);
  expect(cal).toMatchObject({ summary: "nwsnotes", timeZone: "Europe/London", events: [], channels: 1 });

  await edit(request, 2, { dueDateTime: DUE });
  await sync(request);
  expect(await eventOf(request, 2)).toMatchObject({
    summary: "Buy milk",
    description: "#Home #Shopping",
    start: { dateTime: DUE },
    end: { dateTime: "2030-01-02T10:15:00.000Z" },
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 0 }] },
  });
  // Notes with no due date have none.
  expect((await calendar(request)).events).toHaveLength(1);
});

test("on connecting, notes due in the future get events, and ones already past due don't", async ({ page }) => {
  const request = page.request;
  await edit(request, 1, { dueDateTime: DUE });
  await edit(request, 9, { dueDateTime: "2020-01-01T09:00:00.000Z" });
  await connect(request);
  await sync(request);
  expect(await eventOf(request, 1)).toBeDefined();
  expect(await eventOf(request, 9)).toBeUndefined();
  // Given a new due date, the past-due one gets an event.
  await edit(request, 9, { dueDateTime: DUE });
  await sync(request);
  expect(await eventOf(request, 9)).toBeDefined();
});

test("changes in nwsnotes follow to Google: title, due date (keeping the event's length), tags and details", async ({ page }) => {
  const request = page.request;
  await connect(request);
  await edit(request, 2, { dueDateTime: DUE });
  await sync(request);
  const event = (await eventOf(request, 2))!;

  // Stretched to an hour in Google, then moved in nwsnotes: it stays an hour.
  await changeEvent(request, event.id, { end: { dateTime: "2030-01-02T11:00:00.000Z" } });
  await sync(request);
  expect((await note(request, 2)).dueDateTime).toBe(DUE);
  await edit(request, 2, { titleText: "Buy oat milk", tagIds: [WORK, SHOPPING, IDEAS], dueDateTime: "2030-01-03T08:30:00.000Z" });
  await sync(request);
  expect(await eventOf(request, 2)).toMatchObject({
    id: event.id,
    summary: "Buy oat milk",
    description: "#Work #Ideas #Shopping",
    start: { dateTime: "2030-01-03T08:30:00.000Z" },
    end: { dateTime: "2030-01-03T09:30:00.000Z" },
  });

  // A long-form note's typed details are the description, after the tags line.
  await edit(request, 7, { dueDateTime: DUE });
  await sync(request);
  expect((await eventOf(request, 7))?.description).toBe("#Home\n\nFlights\nHotel");
  await edit(request, 7, { detailsText: "Flights\nHotel\nCar hire" });
  await sync(request);
  expect((await eventOf(request, 7))?.description).toBe("#Home\n\nFlights\nHotel\nCar hire");

  // A handwritten note's event is "Handwritten note".
  await edit(request, 6, { dueDateTime: DUE });
  await sync(request);
  expect(await eventOf(request, 6)).toMatchObject({ summary: "Handwritten note", description: "#Home" });
});

test("clearing the due date, archiving or binning deletes the event; reinstating puts it back", async ({ page }) => {
  const request = page.request;
  await connect(request);
  await edit(request, 2, { dueDateTime: DUE });
  await edit(request, 1, { dueDateTime: DUE });
  await sync(request);
  expect((await calendar(request)).events).toHaveLength(2);

  await edit(request, 2, { dueDateTime: undefined });
  await setLifetime(request, 1, "Archived");
  await sync(request);
  expect((await calendar(request)).events).toHaveLength(0);
  // The notes are still there.
  expect((await note(request, 2)).titleText).toBe("Buy milk");

  await setLifetime(request, 1, "Active");
  await sync(request);
  expect(await eventOf(request, 1)).toMatchObject({ summary: "Plan the team meeting" });
  await setLifetime(request, 1, "Waiting");
  await sync(request);
  expect(await eventOf(request, 1)).toBeDefined();
  await setLifetime(request, 1, "Bin");
  await sync(request);
  expect(await eventOf(request, 1)).toBeUndefined();
});

test("an event added in Google becomes a New note, its hashtags its tags, its description long-form details", async ({ page }) => {
  const request = page.request;
  await connect(request);

  // Hashtags in the title go to the tags line; ones that name no tag stay.
  await addEvent(request, { summary: "Oat milk #shopping #home #1", start: { dateTime: DUE }, end: { dateTime: "2030-01-02T10:30:00.000Z" } });
  await sync(request);
  const milk = (await noteTitled(request, "Oat milk #1"))!;
  expect(milk).toMatchObject({ dueDateTime: DUE });
  expect(milk.tagIds.sort()).toEqual([HOME, SHOPPING, NEW].sort());
  expect(milk.detailsText).toBeUndefined();
  // The event is tidied: the hashtags on the tags line (spelt as the tags are), the title without them, and its own length kept.
  expect(await eventOf(request, milk.id)).toMatchObject({
    summary: "Oat milk #1",
    description: "#Home #Shopping",
    end: { dateTime: "2030-01-02T10:30:00.000Z" },
  });

  // A description makes it long-form; the tags line gives tags, with an underscore for a space, and unknown hashtags kept as typed.
  await addEvent(request, {
    summary: "Kitchen plan",
    description: "#Ideas #Shoping\n\nNew <b>cupboards</b><br>Paint",
    start: { dateTime: DUE },
    end: { dateTime: "2030-01-02T10:15:00.000Z" },
  });
  await sync(request);
  const kitchen = (await noteTitled(request, "Kitchen plan"))!;
  expect(kitchen.detailsText).toBe("New cupboards\nPaint");
  expect(userTags(kitchen)).toEqual([IDEAS]);
  expect((await eventOf(request, kitchen.id))?.description).toBe("#Ideas #Shoping\n\nNew <b>cupboards</b><br>Paint");

  // With no hashtags, no tags; with no title, "(No title)".
  await addEvent(request, { start: { dateTime: DUE }, end: { dateTime: DUE } });
  await sync(request);
  expect(userTags(await noteTitled(request, "(No title)"))).toEqual([]);

  // In the History, as from Google Calendar.
  const history = (await (await request.get("/api/history")).json()) as { changes: { summary: string }[] };
  expect(history.changes.map((change) => change.summary)).toEqual(
    expect.arrayContaining(['Added "Oat milk #1" from Google Calendar', 'Added long-form note "Kitchen plan" from Google Calendar']),
  );
});

test("two tags with the same name: a hashtag names the first; two of a single-select category: the first wins", async ({ page }) => {
  const request = page.request;
  // A second "Home", in a new category.
  const made = await request.post("/api/categories", { data: { name: "Places", multiSelect: true, tags: [{ name: "Home" }, { name: "Garden shed" }] } });
  expect(made.ok(), await made.text()).toBe(true);
  const places = (await made.json()) as { tags: { id: number; name: string }[] };
  const secondHome = places.tags[0]!.id;
  const shed = places.tags[1]!.id;
  await connect(request);

  await addEvent(request, { summary: "Tidy", description: "#Work #Home #garden_shed", start: { dateTime: DUE }, end: { dateTime: DUE } });
  await sync(request);
  const tidy = (await noteTitled(request, "Tidy"))!;
  // Work and Home are both Area (single-select): Work, the first. The hashtag #Home would be Area's Home anyway.
  expect(userTags(tidy)).toEqual([WORK, shed].sort());

  // A note with the second Home keeps it through the round trip, though its hashtag reads as the first.
  await edit(request, 2, { tagIds: [secondHome], dueDateTime: DUE });
  await sync(request);
  const event = (await eventOf(request, 2))!;
  expect(event.description).toBe("#Home");
  await changeEvent(request, event.id, { summary: "Buy milk today" });
  await sync(request);
  expect(await note(request, 2)).toMatchObject({ titleText: "Buy milk today" });
  expect(userTags(await note(request, 2))).toEqual([secondHome]);
});

test("changes in Google follow to the note: title, time, tags, details; and deleting the event bins it", async ({ page }) => {
  const request = page.request;
  await connect(request);
  await edit(request, 2, { dueDateTime: DUE });
  await sync(request);
  const event = (await eventOf(request, 2))!;

  // Renamed and moved; Shopping's hashtag taken off and Work's put on (replacing Home, as Area is single-select).
  await changeEvent(request, event.id, {
    summary: "Buy bread",
    description: "#Work",
    start: { dateTime: "2030-01-05T12:00:00.000Z" },
    end: { dateTime: "2030-01-05T12:15:00.000Z" },
  });
  await sync(request);
  const bread = await note(request, 2);
  expect(bread).toMatchObject({ titleText: "Buy bread", dueDateTime: "2030-01-05T12:00:00.000Z" });
  expect(userTags(bread)).toEqual([WORK]);
  expect(bread.detailsText).toBeUndefined();

  // A description added to a regular note makes it long-form; removing it later leaves it long-form.
  await changeEvent(request, event.id, { description: "#Work\n\nWholemeal" });
  await sync(request);
  expect((await note(request, 2)).detailsText).toBe("Wholemeal");
  await changeEvent(request, event.id, { description: "#Work" });
  await sync(request);
  expect((await note(request, 2)).detailsText).toBe("Wholemeal");
  // nwsnotes writes the details back, as the note still has them.
  expect((await eventOf(request, 2))?.description).toBe("#Work\n\nWholemeal");

  // Deleted in Google: the note goes to the Bin.
  await deleteEvent(request, event.id);
  await sync(request);
  expect((await note(request, 2)).tagIds).toContain(BIN);
  const history = (await (await request.get("/api/history")).json()) as { changes: { summary: string }[] };
  expect(history.changes[0]!.summary).toBe('Moved "Buy bread" to the Bin from Google Calendar');
  expect(history.changes.map((change) => change.summary)).toContain('Renamed "Buy milk" to "Buy bread" from Google Calendar');
});

test("a handwritten note's title and handwritten details can't be changed from Google, but its hashtags can", async ({ page }) => {
  const request = page.request;
  await connect(request);
  await edit(request, 6, { dueDateTime: DUE });
  await sync(request);
  const event = (await eventOf(request, 6))!;
  await changeEvent(request, event.id, { summary: "Something else #Shopping", description: "#Home\n\nTyped details" });
  await sync(request);
  const handwritten = await note(request, 6);
  expect(handwritten.titleText).toBeUndefined();
  expect(handwritten.detailsText).toBeUndefined();
  expect(userTags(handwritten)).toEqual([HOME, SHOPPING]);
});

test("all-day events are due at 20:00 and stay all-day, until the time is changed in nwsnotes", async ({ page }) => {
  const request = page.request;
  await connect(request);
  // In summer (BST), 20:00 is 19:00 UTC. Several days long: due on the first.
  await addEvent(request, { summary: "Camping", start: { date: "2030-07-02" }, end: { date: "2030-07-05" } });
  await sync(request);
  const camping = (await noteTitled(request, "Camping"))!;
  expect(camping).toMatchObject({ dueDateTime: "2030-07-02T19:00:00.000Z", allDay: true });

  // A new date (still 20:00) in nwsnotes: still all-day, for as many days.
  await edit(request, camping.id, { dueDateTime: "2030-07-09T19:00:00.000Z" });
  await sync(request);
  expect(await note(request, camping.id)).toMatchObject({ allDay: true });
  expect(await eventOf(request, camping.id)).toMatchObject({ start: { date: "2030-07-09" }, end: { date: "2030-07-12" } });

  // A time other than 20:00: a timed event of 15 minutes, and no longer all-day.
  await edit(request, camping.id, { dueDateTime: "2030-07-09T08:00:00.000Z" });
  await sync(request);
  expect((await note(request, camping.id)).allDay).toBeUndefined();
  const timed = (await eventOf(request, camping.id))!;
  expect(timed.start).toMatchObject({ dateTime: "2030-07-09T08:00:00.000Z" });
  expect(timed.end).toMatchObject({ dateTime: "2030-07-09T08:15:00.000Z" });
  expect(timed.start?.date).toBeUndefined();
  expect(timed.reminders).toEqual({ useDefault: false, overrides: [{ method: "popup", minutes: 0 }] });

  // An all-day note's event alerts at 09:00 on the day.
  await addEvent(request, { summary: "Bin day", start: { date: "2030-01-07" }, end: { date: "2030-01-08" } });
  await sync(request);
  const binDay = (await noteTitled(request, "Bin day"))!;
  await edit(request, binDay.id, { dueDateTime: "2030-01-14T20:00:00.000Z" });
  await sync(request);
  expect((await eventOf(request, binDay.id))?.reminders).toEqual({ useDefault: false, overrides: [{ method: "popup", minutes: -540 }] });
});

test("if Google refuses the 09:00 alert on an all-day event, the calendar's own alerts are used", async ({ page }) => {
  const request = page.request;
  await connect(request);
  await request.post(`${control}/settings`, { data: { refuseNegativeReminders: true } });
  await addEvent(request, { summary: "Bin day", start: { date: "2030-01-07" }, end: { date: "2030-01-08" } });
  await sync(request);
  const binDay = (await noteTitled(request, "Bin day"))!;
  await edit(request, binDay.id, { dueDateTime: "2030-01-14T20:00:00.000Z" });
  await sync(request);
  expect(await eventOf(request, binDay.id)).toMatchObject({ start: { date: "2030-01-14" }, reminders: { useDefault: true } });
});

test("a recurring event becomes a note with no due date, linked to the series", async ({ page }) => {
  const request = page.request;
  await connect(request);
  const series = await addEvent(request, {
    summary: "Water the plants #Home",
    recurrence: ["RRULE:FREQ=WEEKLY"],
    start: { dateTime: DUE },
    end: { dateTime: "2030-01-02T10:15:00.000Z" },
  });
  await sync(request);
  const plants = (await noteTitled(request, "Water the plants"))!;
  expect(plants.dueDateTime).toBeUndefined();
  expect(userTags(plants)).toEqual([HOME]);

  // Renamed in Google: renamed. Given a due date in nwsnotes: no event of its own, and the series is unchanged.
  await changeEvent(request, series.id, { summary: "Water the house plants" });
  await sync(request);
  expect((await note(request, plants.id)).titleText).toBe("Water the house plants");
  await edit(request, plants.id, { dueDateTime: DUE });
  await sync(request);
  const events = (await calendar(request)).events;
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ id: series.id, recurrence: ["RRULE:FREQ=WEEKLY"], start: { dateTime: DUE } });

  // Deleting the series bins the note.
  await deleteEvent(request, series.id);
  await sync(request);
  expect((await note(request, plants.id)).tagIds).toContain(BIN);
});

test("Google's webhook syncs a change made there without waiting for the 5-minute check", async ({ page }) => {
  const request = page.request;
  await connect(request);
  await addEvent(request, { summary: "Ring the dentist", start: { dateTime: DUE }, end: { dateTime: DUE } });
  await expect.poll(async () => (await noteTitled(request, "Ring the dentist"))?.dueDateTime, { timeout: 5000 }).toBe(DUE);
});

test("a note with an event gets Google's alert, not nwsnotes' reminder", async ({ page }) => {
  const request = page.request;
  expect((await request.post("/api/push/subscribe", { data: { endpoint: "https://push.example.com/1", keys: { p256dh: "k", auth: "a" } } })).ok()).toBe(true);
  const soon = () => new Date(Date.now() + 1500).toISOString();
  // Not connected: nwsnotes' reminder.
  await edit(request, 1, { dueDateTime: soon() });
  await page.waitForTimeout(2000);
  await request.post("/api/test/check-reminders");
  const sent = async () => ((await (await request.get("/api/test/notifications")).json()) as { title: string }[]).map((n) => n.title);
  expect(await sent()).toEqual(["Due: Plan the team meeting"]);

  // Connected, with an event: none from nwsnotes.
  await connect(request);
  await edit(request, 2, { dueDateTime: soon() });
  await sync(request);
  expect(await eventOf(request, 2)).toBeDefined();
  await page.waitForTimeout(2000);
  await request.post("/api/test/check-reminders");
  expect(await sent()).toEqual(["Due: Plan the team meeting"]);
});

test("when the notebook is full, an event isn't added, and a notification says so", async ({ page }) => {
  const request = page.request;
  expect((await request.post("/api/push/subscribe", { data: { endpoint: "https://push.example.com/2", keys: { p256dh: "k", auth: "a" } } })).ok()).toBe(true);
  const me = (await (await request.get("/api/me")).json()) as { id: number };
  const count = (await notes(request)).length;
  expect((await request.put(`/api/users/${me.id}`, { data: { noteLimit: count } })).ok()).toBe(true);
  await connect(request);
  await addEvent(request, { summary: "One too many", start: { dateTime: DUE }, end: { dateTime: DUE } });
  await sync(request);
  expect(await noteTitled(request, "One too many")).toBeUndefined();
  const sent = (await (await request.get("/api/test/notifications")).json()) as { title: string; body?: string }[];
  expect(sent.at(-1)).toMatchObject({ title: "Not added from Google Calendar", body: '"One too many": your notebook is full.' });
});

test("access removed in Google, or the calendar deleted, stops the sync until connecting again", async ({ page }) => {
  const request = page.request;
  await connect(request);
  await request.post(`${control}/revoke-all`);
  await edit(request, 2, { dueDateTime: DUE });
  await sync(request);
  expect(await (await request.get("/api/google")).json()).toEqual({
    connected: true,
    problem: "Google no longer lets nwsnotes use your calendar. Connect again to carry on.",
  });
  // Connecting again carries on, with the same calendar.
  await connect(request);
  await sync(request);
  expect(await (await request.get("/api/google")).json()).toEqual({ connected: true });
  expect(await eventOf(request, 2)).toBeDefined();

  const cal = await calendar(request);
  await request.delete(`${control}/calendars/${encodeURIComponent(cal.id)}`);
  await edit(request, 2, { titleText: "Buy oat milk" });
  await sync(request);
  expect(((await (await request.get("/api/google")).json()) as { problem?: string }).problem).toBe(
    "The nwsnotes calendar was deleted in Google. Connect again to make a new one.",
  );
  // Connecting again makes a new calendar, with the note's event in it.
  await connect(request);
  await sync(request);
  expect(await eventOf(request, 2)).toMatchObject({ summary: "Buy oat milk" });
});

test("disconnecting stops the sync and leaves the calendar in Google", async ({ page }) => {
  const request = page.request;
  await connect(request);
  await edit(request, 2, { dueDateTime: DUE });
  await sync(request);
  expect((await request.post("/api/google/disconnect")).ok()).toBe(true);
  expect(await (await request.get("/api/google")).json()).toEqual({ connected: false });
  await edit(request, 2, { titleText: "Buy oat milk" });
  await sync(request);
  const cal = await calendar(request);
  expect(cal.channels).toBe(0);
  expect(cal.events).toEqual([expect.objectContaining({ summary: "Buy milk" })]);
});
