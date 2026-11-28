import { randomBytes, randomUUID } from "node:crypto";
import express, { type RequestHandler } from "express";
import {
  addDays,
  ALL_DAY_ALERT_HOUR,
  ALL_DAY_DUE_HOUR,
  ALL_DAY_DUE_MINUTE,
  DEFAULT_EVENT_MINUTES,
  DETAILS_TEXT_MAX_LENGTH,
  descriptionText,
  fromUkClock,
  HANDWRITTEN_EVENT_DESCRIPTION,
  HANDWRITTEN_EVENT_TITLE,
  hashtagOf,
  hashtagText,
  isAllDayTime,
  isLifetimeTag,
  isLongForm,
  joinDescription,
  lifetimeOf,
  LIFETIME_ACTIVE,
  LIFETIME_NEW,
  LIFETIME_WAITING,
  sameHashtag,
  splitDescription,
  SPOKEN_TIME_ZONE,
  tagForHashtag,
  takeTitleHashtags,
  TITLE_MAX_LENGTH,
  UNTITLED_EVENT,
  ukClock,
  type Category,
  type Note,
} from "@nwsnotes/shared";
import type { GoogleConfig } from "./config.js";
import type { Db } from "./db.js";
import type { LiveUpdates } from "./live.js";
import type { Notebooks } from "./notebooks.js";
import type { PushReminders } from "./push.js";
import { RequestError, type CalendarChange, type NoteStore } from "./store.js";
import { userOf } from "./auth.js";
import { noteLimitOf } from "./users.js";

/*
 * Two-way sync between each connected user's notes and an "nwsnotes" calendar in their Google account
 * (see Specs/google-calendar.md). Each user's sync runs one at a time: first what changed in Google
 * since last time (read with a sync token) is applied to the notes, then Google is made to match the
 * notes. For each synced note, the event as it was last written or read (its "link") is kept, so a
 * change made in Google can be told from nwsnotes' own, field by field: a field changed in Google wins.
 * It runs after every save of the user's notebook, when Google says the calendar changed (a webhook),
 * and every 5 minutes in case a webhook was missed.
 */

/** What nwsnotes asks Google for: making secondary calendars, and the events on them. */
const SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
/** The calendar nwsnotes makes in each user's account. */
const CALENDAR_NAME = "nwsnotes";
/** Events nwsnotes makes and reads are in UK time, as dictated due dates are. */
const TIME_ZONE = SPOKEN_TIME_ZONE;
/** The event's private property holding its note's id. */
const NOTE_ID_PROPERTY = "nwsnotesNoteId";

const CALLBACK_PATH = "/api/google/callback";
const WEBHOOK_PATH = "/api/google/webhook";
/** Where the browser goes back to after connecting: Settings, saying how it went. */
const SETTINGS_PATH = "/settings";

/** In case a webhook is missed. */
const POLL_EVERY_MS = 5 * 60 * 1000;
/** Watch channels are renewed when they have less than this left. */
const RENEW_WITHIN_MS = 24 * 60 * 60 * 1000;
const RENEW_CHECK_EVERY_MS = 60 * 60 * 1000;
/** Google keeps a channel for at most about a week. */
const CHANNEL_TTL_SECONDS = 7 * 24 * 60 * 60;
/** A sign-in's state (and so the time to finish it) lasts this long. */
const STATE_LIFETIME_MS = 15 * 60 * 1000;
/** Changes saved close together are synced together. */
const SYNC_DELAY_MS = 200;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const PROBLEM_ACCESS = "Google no longer lets nwsnotes use your calendar. Connect again to carry on.";
const PROBLEM_CALENDAR_GONE = "The nwsnotes calendar was deleted in Google. Connect again to make a new one.";
/** The reason given to the error when the calendar has gone. */
const CALENDAR_GONE = "calendarGone";

/** An event's start or end: a time, or a date (an all-day event). */
interface EventTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

/** An event, as the Calendar API has it (only the parts nwsnotes uses). */
export interface GoogleEvent {
  id: string;
  etag?: string;
  status?: string;
  summary?: string;
  description?: string;
  start?: EventTime;
  end?: EventTime;
  recurrence?: string[];
  recurringEventId?: string;
  extendedProperties?: { private?: Record<string, string> };
}

/** A user's connection. */
interface Account {
  refreshToken: string;
  calendarId: string;
  /** How far the calendar's changes have been read. */
  syncToken?: string;
  /** Google's webhook for the calendar: our id for it and its secret, Google's id for the calendar, and when it ends (ms). */
  channel?: { id: string; token: string; resourceId: string; expiration: number };
  connectedDateTime: string;
  /** Notes already past due when the user connected, with that due date: they get no event while it's unchanged. */
  skipped?: Record<string, string>;
  /** Set when syncing has stopped until the user connects again (shown in Settings). */
  problem?: string;
}

/** A synced note's event, as it was last written or read. */
interface Link {
  eventId: string;
  etag?: string;
  /** A recurring series: its note has no due date, and never gets an event of its own. */
  recurring?: true;
  summary: string;
  description: string;
  start?: EventTime;
  end?: EventTime;
  /** The tags line's hashtags that name a tag, as written or typed, and the tag each one stands for. */
  tags: { word: string; tagId: number }[];
  /** Hashtags on the tags line that name no tag, kept as typed. */
  unknown: string[];
  /** The event carries the note's id (events added in Google get it at the next write). */
  marked?: true;
  /** nwsnotes last sent the event with no alert (its note has no reminder). Events added in Google keep their own alerts. */
  noAlert?: true;
}

/** A user tag that hashtags can name, with its category (tags of single-select categories replace each other). */
interface TagChoice {
  id: number;
  name: string;
  categoryId: number;
  multiSelect: boolean;
}

/** An event as nwsnotes wants it, for a note. */
interface WantedEvent {
  summary: string;
  description: string;
  start?: EventTime;
  end?: EventTime;
  allDay: boolean;
  tags: Link["tags"];
  unknown: string[];
}

/** An error from Google: its HTTP status and Google's reason, if it gave one (e.g. "invalid_grant"). */
export class GoogleError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly reason?: string,
  ) {
    super(message);
  }
}

/** Google's sign-in and Calendar API. */
class GoogleApi {
  constructor(private readonly config: GoogleConfig) {}

  get redirectUri(): string {
    return `${this.config.publicUrl}${CALLBACK_PATH}`;
  }

  /** Google's page asking the user to let nwsnotes use their calendar. */
  signInUrl(state: string): string {
    const url = new URL(this.config.authUrl);
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: SCOPE,
      // A refresh token, every time (so connecting again always gets one).
      access_type: "offline",
      prompt: "consent",
      state,
    }).toString();
    return url.toString();
  }

  /** A sign-in's code, or a refresh token, exchanged for an access token (and, the first time, a refresh token). */
  async token(grant: { code: string } | { refreshToken: string }): Promise<{ accessToken: string; expiresAt: number; refreshToken?: string }> {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      ...("code" in grant
        ? { grant_type: "authorization_code", code: grant.code, redirect_uri: this.redirectUri }
        : { grant_type: "refresh_token", refresh_token: grant.refreshToken }),
    });
    const response = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const body = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!response.ok || !body.access_token) {
      throw new GoogleError(response.status, body.error_description ?? body.error ?? `Google's sign-in answered ${response.status}.`, body.error);
    }
    return {
      accessToken: body.access_token,
      // A minute early, so it's never used just as it runs out.
      expiresAt: Date.now() + ((body.expires_in ?? 3600) - 60) * 1000,
      ...(body.refresh_token && { refreshToken: body.refresh_token }),
    };
  }

  /** Revokes a token (best effort: disconnecting goes ahead anyway). */
  async revoke(token: string): Promise<void> {
    await fetch(`${this.config.revokeUrl}?${new URLSearchParams({ token }).toString()}`, { method: "POST" });
  }

  /** A Calendar API call. A 204 gives undefined. */
  async call<T>(accessToken: string, method: string, path: string, options: { query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
    const query = options.query ? `?${new URLSearchParams(options.query).toString()}` : "";
    const response = await fetch(`${this.config.calendarApi}${path}${query}`, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, ...(options.body !== undefined && { "Content-Type": "application/json" }) },
      ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
    });
    if (response.status === 204) return undefined as T;
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } };
    if (!response.ok) {
      throw new GoogleError(response.status, body.error?.message ?? `Google Calendar answered ${response.status}.`, body.error?.errors?.[0]?.reason);
    }
    return body as T;
  }
}

/** The user tags hashtags can name, in category order then tag order (Lifetime and shared tags aren't among them). */
function tagChoices(categories: readonly Category[]): TagChoice[] {
  return categories
    .filter((category) => !category.system && !category.shared)
    .flatMap((category) => category.tags.map((tag) => ({ id: tag.id, name: tag.name, categoryId: category.id, multiSelect: category.multiSelect })));
}

/** `tagIds` with `added` put on: a tag of a single-select category replaces that category's other tag. */
function withTags(tagIds: number[], added: number[], tags: TagChoice[]): number[] {
  let result = [...tagIds];
  for (const id of added) {
    if (result.includes(id)) continue;
    const tag = tags.find((t) => t.id === id);
    if (!tag) continue;
    if (!tag.multiSelect) result = result.filter((other) => tags.find((t) => t.id === other)?.categoryId !== tag.categoryId);
    result.push(id);
  }
  return result;
}

/** The first tag each hashtag names: two of a single-select category, the first wins. Hashtags naming no tag are `unknown`. */
function readHashtags(words: string[], tags: TagChoice[]): { tags: Link["tags"]; unknown: string[] } {
  const found: Link["tags"] = [];
  const unknown: string[] = [];
  for (const word of words) {
    const tag = tagForHashtag(hashtagText(word) ?? "", tags);
    if (!tag) unknown.push(word);
    else if (!found.some((f) => f.tagId === tag.id || tags.find((t) => t.id === f.tagId)?.categoryId === tag.categoryId && !tag.multiSelect)) {
      found.push({ word, tagId: tag.id });
    }
  }
  return { tags: found, unknown };
}

/** The date a UK clock shows at this moment, as "2026-11-28". */
function ukDate(iso: string): string {
  const clock = ukClock(new Date(iso));
  return `${clock.year}-${String(clock.month).padStart(2, "0")}-${String(clock.day).padStart(2, "0")}`;
}

/** A date string a number of days later. */
function laterDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const moved = addDays({ year, month, day }, days);
  return `${moved.year}-${String(moved.month).padStart(2, "0")}-${String(moved.day).padStart(2, "0")}`;
}

/** Whether a description nwsnotes wants says the same as the event's (which may be HTML, edited on Google's website, left as it is if so). */
function sameDescription(wanted: string, event: string): boolean {
  return wanted === event || wanted === descriptionText(event);
}

/** Whether two event times are the same moment (or the same date). */
function sameTime(a: EventTime | undefined, b: EventTime | undefined): boolean {
  if (a?.date !== undefined || b?.date !== undefined) return a?.date === b?.date;
  if (a?.dateTime === undefined || b?.dateTime === undefined) return a?.dateTime === b?.dateTime;
  return Date.parse(a.dateTime) === Date.parse(b.dateTime);
}

/** When an event makes its note due: its start, or 20:00 (UK time) on an all-day event's first day. */
function dueOf(start: EventTime | undefined): { dueDateTime?: string; allDay: boolean } {
  if (start?.date) {
    const [year, month, day] = start.date.split("-").map(Number) as [number, number, number];
    return { dueDateTime: fromUkClock(year, month, day, ALL_DAY_DUE_HOUR, ALL_DAY_DUE_MINUTE).toISOString(), allDay: true };
  }
  if (start?.dateTime && !Number.isNaN(Date.parse(start.dateTime))) return { dueDateTime: new Date(start.dateTime).toISOString(), allDay: false };
  return { allDay: false };
}

/** An event's title and description as nwsnotes reads them: the title without its tag hashtags, the tags line's words, and the body. */
function readEvent(event: Pick<GoogleEvent, "summary" | "description">, tags: TagChoice[]) {
  const title = takeTitleHashtags(event.summary ?? "", (text) => tagForHashtag(text, tags) !== undefined);
  const { tagWords, body } = splitDescription(descriptionText(event.description ?? ""));
  return { title: title.title, titleTagWords: title.tagWords, tagWords, body };
}

/** The alert Google shows: one pop-up at the start, or at 09:00 on an all-day event's day; none for a note with no reminder. */
function alertsFor(allDay: boolean, noReminder: boolean) {
  if (noReminder) return { useDefault: false, overrides: [] };
  // An all-day event "starts" at midnight, so 09:00 that day is 540 minutes after it.
  return { useDefault: false, overrides: [{ method: "popup", minutes: allDay ? -ALL_DAY_ALERT_HOUR * 60 : 0 }] };
}

export class GoogleCalendar {
  private readonly api: GoogleApi;
  private readonly accounts = new Map<number, Account>();
  private readonly links = new Map<number, Map<number, Link>>();
  private readonly accessTokens = new Map<number, { token: string; expiresAt: number }>();
  /** Sign-ins under way: the state given to Google, and whose it is. */
  private readonly states = new Map<string, { userId: number; expires: number }>();
  /** Each user's sync under way, and whether another change has come in since it started. */
  private readonly jobs = new Map<number, { again: boolean; done: Promise<void> }>();
  /** Google refused the 09:00 alert on all-day events once: they use the calendar's own alerts from then on. */
  private allDayAlertRefused = false;

  constructor(
    private readonly config: GoogleConfig,
    private readonly db: Db,
    private readonly notebooks: Notebooks,
    private readonly push: PushReminders,
    private readonly live: LiveUpdates,
  ) {
    this.api = new GoogleApi(config);
  }

  /** Loads the connections and the events, then syncs after every save, every 5 minutes, and renews the webhooks. */
  async init(): Promise<void> {
    this.notebooks.addSavedListener((userId) => this.schedule(userId));
    await this.loadWhenReachable();
    setInterval(() => {
      for (const userId of this.accounts.keys()) this.schedule(userId);
    }, POLL_EVERY_MS).unref();
    setInterval(() => void this.renewChannels(), RENEW_CHECK_EVERY_MS).unref();
  }

  /** Loads the connections, trying again every 30 seconds while the database can't be reached (nothing syncs meanwhile). */
  private async loadWhenReachable(): Promise<void> {
    try {
      await this.load();
    } catch (error) {
      console.warn("Google Calendar: couldn't load the connections; trying again in 30 seconds.", error instanceof Error ? error.message : error);
      setTimeout(() => void this.loadWhenReachable(), 30_000).unref();
      return;
    }
    console.log(`Google Calendar: ${this.accounts.size} user(s) connected.`);
    for (const userId of this.accounts.keys()) this.schedule(userId);
    void this.renewChannels();
  }

  private async load(): Promise<void> {
    this.accounts.clear();
    this.links.clear();
    for (const row of await this.db.query<{ user_id: number; data: Account }>("SELECT user_id, data FROM nwsnotes.google_accounts")) {
      this.accounts.set(row.user_id, row.data);
    }
    for (const row of await this.db.query<{ user_id: number; note_id: number; data: Link }>("SELECT user_id, note_id, data FROM nwsnotes.google_events")) {
      this.linksOf(row.user_id).set(row.note_id, row.data);
    }
  }

  // ---- What other parts of the server ask ------------------------------------

  /** Whether a note's alert comes from Google (it has an event of its own), not nwsnotes' reminder. */
  alertsInGoogle(userId: number, noteId: number): boolean {
    const account = this.accounts.get(userId);
    const link = this.links.get(userId)?.get(noteId);
    return account !== undefined && account.problem === undefined && link !== undefined && !link.recurring;
  }

  /** Settings: whether the user is connected, and any problem that has stopped the sync. */
  status(userId: number): { connected: boolean; problem?: string } {
    const account = this.accounts.get(userId);
    return { connected: account !== undefined, ...(account?.problem && { problem: account.problem }) };
  }

  /** End-to-end tests only: forgets every connection. */
  async resetForTests(): Promise<void> {
    await this.idle();
    await this.db.query("DELETE FROM nwsnotes.google_accounts");
    await this.db.query("DELETE FROM nwsnotes.google_events");
    this.accounts.clear();
    this.links.clear();
    this.accessTokens.clear();
    this.states.clear();
    this.allDayAlertRefused = false;
  }

  /** End-to-end tests only: resolves once no sync is running or waiting. */
  async idle(): Promise<void> {
    while (this.jobs.size > 0) await Promise.all([...this.jobs.values()].map((job) => job.done));
  }

  /** End-to-end tests only: syncs this user now (as the 5-minute check would), and waits for it. */
  async syncNowForTests(userId: number): Promise<void> {
    this.schedule(userId);
    await this.idle();
  }

  // ---- The API's routes --------------------------------------------------------

  /** `/api/google`: the status, connecting and disconnecting (logged in), Google's return from the sign-in, and its webhook. */
  router(requireSession: RequestHandler): express.Router {
    const router = express.Router();

    // Google sends the browser back here after the sign-in. The session cookie isn't sent on a visit from
    // another site (it's SameSite=Strict), so the sign-in's state says whose it is.
    router.get("/callback", async (req, res) => {
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const started = this.states.get(state);
      this.states.delete(state);
      if (!started || started.expires < Date.now()) return res.redirect(`${SETTINGS_PATH}?google=failed`);
      if (typeof req.query.code !== "string") return res.redirect(`${SETTINGS_PATH}?google=declined`);
      try {
        await this.connect(started.userId, req.query.code);
        res.redirect(`${SETTINGS_PATH}?google=connected`);
      } catch (error) {
        console.error(`Couldn't connect user ${started.userId}'s Google Calendar:`, error);
        res.redirect(`${SETTINGS_PATH}?google=failed`);
      }
    });

    // Google says the calendar changed. Answered straight away; the sync runs afterwards.
    router.post("/webhook", (req, res) => {
      const id = req.get("X-Goog-Channel-ID");
      const token = req.get("X-Goog-Channel-Token");
      const entry = [...this.accounts].find(([, account]) => account.channel?.id === id && account.channel?.token === token);
      // "sync" is only Google saying the channel has started.
      if (entry && req.get("X-Goog-Resource-State") !== "sync") this.schedule(entry[0]);
      res.status(200).end();
    });

    router.use(requireSession);
    router.get("/", (_req, res) => {
      res.set("Cache-Control", "no-store");
      res.json(this.status(userOf(res).id));
    });
    // The Connect button: off to Google's sign-in.
    router.get("/connect", (_req, res) => {
      const state = randomBytes(24).toString("base64url");
      for (const [key, value] of this.states) if (value.expires < Date.now()) this.states.delete(key);
      this.states.set(state, { userId: userOf(res).id, expires: Date.now() + STATE_LIFETIME_MS });
      res.redirect(this.api.signInUrl(state));
    });
    router.post("/disconnect", async (_req, res) => {
      await this.disconnect(userOf(res).id);
      res.json(this.status(userOf(res).id));
    });
    return router;
  }

  // ---- Connecting and disconnecting --------------------------------------------

  /**
   * Finishes a sign-in: keeps the refresh token, makes the "nwsnotes" calendar (or keeps the one already
   * made, connecting again after a problem), starts the webhook, and syncs.
   */
  private async connect(userId: number, code: string): Promise<void> {
    const tokens = await this.api.token({ code });
    if (!tokens.refreshToken) throw new GoogleError(400, "Google gave no refresh token.");
    this.accessTokens.set(userId, { token: tokens.accessToken, expiresAt: tokens.expiresAt });
    await this.idle();
    const previous = this.accounts.get(userId);
    let calendarId = previous?.calendarId;
    if (calendarId) {
      // Connecting again: the same calendar, if it's still there.
      try {
        await this.api.call(tokens.accessToken, "GET", `/calendars/${encodeURIComponent(calendarId)}`);
      } catch (error) {
        if (!(error instanceof GoogleError && (error.status === 404 || error.status === 410))) throw error;
        calendarId = undefined;
      }
    }
    if (previous?.channel) await this.stopChannel(tokens.accessToken, previous.channel);
    if (!calendarId) {
      const made = await this.api.call<{ id: string }>(tokens.accessToken, "POST", "/calendars", { body: { summary: CALENDAR_NAME, timeZone: TIME_ZONE } });
      calendarId = made.id;
      // A new calendar has none of the old events.
      await this.db.query("DELETE FROM nwsnotes.google_events WHERE user_id = $1", [userId]);
      this.links.delete(userId);
    }
    const now = new Date();
    const store = await this.notebooks.for(userId);
    // Notes already past due get no event (until their due date changes).
    const skipped = Object.fromEntries(
      store
        .notesAndCategories()
        .notes.filter((note) => note.dueDateTime !== undefined && Date.parse(note.dueDateTime) <= now.getTime() && !this.links.get(userId)?.has(note.id))
        .map((note) => [String(note.id), note.dueDateTime!]),
    );
    const account: Account = {
      refreshToken: tokens.refreshToken,
      calendarId,
      connectedDateTime: now.toISOString(),
      ...(previous?.calendarId === calendarId && previous.syncToken && { syncToken: previous.syncToken }),
      ...(Object.keys(skipped).length > 0 && { skipped: { ...(previous?.calendarId === calendarId ? previous.skipped : {}), ...skipped } }),
    };
    await this.saveAccount(userId, account);
    await this.watch(userId, account, tokens.accessToken);
    console.log(`User ${userId} connected Google Calendar.`);
    this.schedule(userId);
  }

  /** Stops the sync and forgets the connection; the calendar is left in Google. */
  async disconnect(userId: number): Promise<void> {
    const account = this.accounts.get(userId);
    if (!account) return;
    await this.idle();
    try {
      const token = await this.accessToken(userId, account);
      if (account.channel) await this.stopChannel(token, account.channel);
    } catch {
      // Gone already: nothing to stop.
    }
    await this.api.revoke(account.refreshToken).catch(() => undefined);
    await this.db.query("DELETE FROM nwsnotes.google_accounts WHERE user_id = $1", [userId]);
    await this.db.query("DELETE FROM nwsnotes.google_events WHERE user_id = $1", [userId]);
    this.accounts.delete(userId);
    this.links.delete(userId);
    this.accessTokens.delete(userId);
    console.log(`User ${userId} disconnected Google Calendar.`);
  }

  /** Asks Google to call the webhook when the calendar changes. Without it the 5-minute check still syncs. */
  private async watch(userId: number, account: Account, accessToken: string): Promise<void> {
    const channel = { id: randomUUID(), token: randomBytes(24).toString("base64url") };
    try {
      const made = await this.api.call<{ resourceId: string; expiration?: string }>(
        accessToken,
        "POST",
        `/calendars/${encodeURIComponent(account.calendarId)}/events/watch`,
        {
          body: {
            id: channel.id,
            type: "web_hook",
            address: `${this.config.publicUrl}${WEBHOOK_PATH}`,
            token: channel.token,
            params: { ttl: String(CHANNEL_TTL_SECONDS) },
          },
        },
      );
      const expiration = Number(made.expiration ?? Date.now() + CHANNEL_TTL_SECONDS * 1000);
      await this.saveAccount(userId, { ...account, channel: { ...channel, resourceId: made.resourceId, expiration } });
    } catch (error) {
      console.warn(`Couldn't start Google Calendar's webhook for user ${userId} (it's checked every 5 minutes instead):`, error instanceof Error ? error.message : error);
    }
  }

  private async stopChannel(accessToken: string, channel: NonNullable<Account["channel"]>): Promise<void> {
    await this.api.call(accessToken, "POST", "/channels/stop", { body: { id: channel.id, resourceId: channel.resourceId } }).catch(() => undefined);
  }

  /** Renews each webhook that's about to end (and starts one where it couldn't be started before). */
  private async renewChannels(): Promise<void> {
    for (const [userId, account] of this.accounts) {
      if (account.problem || (account.channel && account.channel.expiration - Date.now() > RENEW_WITHIN_MS)) continue;
      try {
        const token = await this.accessToken(userId, account);
        const old = account.channel;
        await this.watch(userId, account, token);
        if (old) await this.stopChannel(token, old);
      } catch (error) {
        this.failed(userId, error);
      }
    }
  }

  // ---- Running the sync ----------------------------------------------------------

  /** Syncs the user soon (after any sync already under way), unless they aren't connected. */
  private schedule(userId: number): void {
    const account = this.accounts.get(userId);
    if (!account || account.problem) return;
    const job = this.jobs.get(userId);
    if (job) {
      job.again = true;
      return;
    }
    const entry: { again: boolean; done: Promise<void> } = { again: true, done: Promise.resolve() };
    entry.done = (async () => {
      await new Promise((resolve) => setTimeout(resolve, SYNC_DELAY_MS));
      try {
        while (entry.again) {
          entry.again = false;
          await this.sync(userId);
        }
      } finally {
        this.jobs.delete(userId);
      }
    })();
    this.jobs.set(userId, entry);
  }

  private async sync(userId: number): Promise<void> {
    const account = this.accounts.get(userId);
    const user = this.notebooks.users.byId(userId);
    if (!account || account.problem || !user || user.disabled) return;
    try {
      const store = await this.notebooks.for(userId);
      await this.pull(userId, store);
      await this.pushChanges(userId, store);
    } catch (error) {
      this.failed(userId, error);
    }
  }

  /** A sync that failed: stops syncing if Google no longer allows it, or the calendar has gone; otherwise it's tried again later. */
  private failed(userId: number, error: unknown): void {
    const account = this.accounts.get(userId);
    if (account && error instanceof GoogleError && (error.reason === "invalid_grant" || error.status === 401)) {
      void this.setProblem(userId, PROBLEM_ACCESS);
    } else if (account && error instanceof GoogleError && error.reason === CALENDAR_GONE) {
      void this.setProblem(userId, PROBLEM_CALENDAR_GONE);
    } else {
      console.warn(`Couldn't sync user ${userId}'s Google Calendar (tried again later):`, error instanceof Error ? error.message : error);
    }
  }

  private async setProblem(userId: number, problem: string): Promise<void> {
    const account = this.accounts.get(userId);
    if (!account) return;
    console.warn(`User ${userId}'s Google Calendar sync has stopped: ${problem}`);
    await this.saveAccount(userId, { ...account, problem }).catch(() => undefined);
  }

  /** A Calendar API call for this user, refreshing the access token when needed (once more after a 401). */
  private async call<T>(userId: number, method: string, path: string, options: { query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
    const account = this.accounts.get(userId)!;
    const fullPath = `/calendars/${encodeURIComponent(account.calendarId)}${path}`;
    try {
      return await this.api.call<T>(await this.accessToken(userId, account), method, fullPath, options);
    } catch (error) {
      if (!(error instanceof GoogleError && error.status === 401)) throw error;
      this.accessTokens.delete(userId);
      return this.api.call<T>(await this.accessToken(userId, account), method, fullPath, options);
    }
  }

  private async accessToken(userId: number, account: Account): Promise<string> {
    const cached = this.accessTokens.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.token;
    const fresh = await this.api.token({ refreshToken: account.refreshToken });
    this.accessTokens.set(userId, { token: fresh.accessToken, expiresAt: fresh.expiresAt });
    return fresh.accessToken;
  }

  // ---- From Google to nwsnotes ----------------------------------------------------

  /** Applies every change made to the calendar since it was last read. */
  private async pull(userId: number, store: NoteStore): Promise<void> {
    let account = this.accounts.get(userId)!;
    let syncToken = account.syncToken;
    let pageToken: string | undefined;
    let events: GoogleEvent[] = [];
    let nextSyncToken: string | undefined;
    for (;;) {
      let page: { items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string };
      try {
        page = await this.call(userId, "GET", "/events", {
          query: { showDeleted: "true", maxResults: "250", ...(syncToken && { syncToken }), ...(pageToken && { pageToken }) },
        });
      } catch (error) {
        // The calendar itself has gone (deleted in Google).
        if (error instanceof GoogleError && error.status === 404) throw new GoogleError(404, PROBLEM_CALENDAR_GONE, CALENDAR_GONE);
        // The sync token has expired: everything is read again (events already known are matched by their etag).
        if (error instanceof GoogleError && error.status === 410 && syncToken) {
          syncToken = undefined;
          pageToken = undefined;
          events = [];
          continue;
        }
        throw error;
      }
      events.push(...(page.items ?? []));
      if (page.nextPageToken) {
        pageToken = page.nextPageToken;
        continue;
      }
      nextSyncToken = page.nextSyncToken;
      break;
    }
    const before = store.notesAndCategories().notes;
    for (const event of events) await this.applyEvent(userId, store, event);
    // The user's open pages show the changes straight away (their other users' are told by Notebooks).
    if (store.notesAndCategories().notes !== before) this.live.notifyChanged(userId, undefined);
    account = this.accounts.get(userId)!;
    if (nextSyncToken && nextSyncToken !== account.syncToken) await this.saveAccount(userId, { ...account, syncToken: nextSyncToken });
  }

  private async applyEvent(userId: number, store: NoteStore, event: GoogleEvent): Promise<void> {
    // One occurrence of a series changed on its own: not followed (the series is the note).
    if (event.recurringEventId) return;
    const links = this.linksOf(userId);
    const found = [...links].find(([, link]) => link.eventId === event.id);
    if (event.status === "cancelled") {
      if (!found) return;
      await this.removeLink(userId, found[0]);
      await store.calendarUpdate(found[0], { toBin: true });
      return;
    }
    if (!found) {
      // An event of a note whose record was lost: linked again as it is, and made to match the note.
      const noteId = Number(event.extendedProperties?.private?.[NOTE_ID_PROPERTY]);
      if (Number.isInteger(noteId) && store.noteById(noteId) && !links.has(noteId)) {
        await this.saveLink(userId, noteId, this.linkFrom(event, [], []));
        return;
      }
      await this.addNote(userId, store, event);
      return;
    }
    const [noteId, link] = found;
    // Our own change, coming back.
    if (event.etag !== undefined && event.etag === link.etag) return;
    await this.applyChange(userId, store, noteId, link, event);
  }

  /** An event added in Google: a New note, with the tags its hashtags name. */
  private async addNote(userId: number, store: NoteStore, event: GoogleEvent): Promise<void> {
    const user = this.notebooks.users.byId(userId)!;
    const tags = tagChoices(store.notesAndCategories().categories);
    const read = readEvent(event, tags);
    const fromLine = readHashtags(read.tagWords, tags);
    const fromTitle = readHashtags(read.titleTagWords, tags);
    const tagIds = withTags([], [...fromTitle.tags, ...fromLine.tags].map((t) => t.tagId), tags);
    const recurring = (event.recurrence?.length ?? 0) > 0;
    const due = recurring ? { allDay: false } : dueOf(event.start);
    const title = (read.title || UNTITLED_EVENT).slice(0, TITLE_MAX_LENGTH).trim();
    const details = read.body !== "" ? { detailsText: read.body.slice(0, DETAILS_TEXT_MAX_LENGTH) } : undefined;
    let note: Note;
    try {
      ({ note } = await store.add({ titleText: title }, tagIds, details, undefined, {
        ...(due.dueDateTime && { dueDateTime: due.dueDateTime }),
        allDay: due.allDay,
        source: "calendar",
        createdByUserId: userId,
        noteLimit: noteLimitOf(user),
      }));
    } catch (error) {
      if (error instanceof RequestError && error.status === 409) {
        console.warn(`Google Calendar: user ${userId}'s notebook is full, so event ${event.id} wasn't added.`);
        await this.push.notify(userId, { title: "Not added from Google Calendar", body: `"${title}": your notebook is full.`, tag: "google-full" });
        return;
      }
      throw error;
    }
    await this.saveLink(userId, note.id, { ...this.linkFrom(event, fromLine.tags, fromLine.unknown), ...(recurring && { recurring: true as const }) });
  }

  /** An event changed in Google: each part that changed there (since it was last written or read) changes the note. */
  private async applyChange(userId: number, store: NoteStore, noteId: number, link: Link, event: GoogleEvent): Promise<void> {
    const note = store.noteById(noteId);
    if (!note) {
      await this.removeLink(userId, noteId);
      return;
    }
    const tags = tagChoices(store.notesAndCategories().categories);
    const now = readEvent(event, tags);
    const before = readEvent(link, tags);
    const change: CalendarChange = {};

    // The title (a handwritten note's title isn't changed, but its hashtags still are).
    if (now.title !== before.title && note.titleText !== undefined) {
      const title = (now.title || UNTITLED_EVENT).slice(0, TITLE_MAX_LENGTH).trim();
      if (title !== note.titleText) change.titleText = title;
    }

    // The tags: hashtags taken off the tags line take their tag off the note; new ones (and any in the title) put theirs on.
    const kept = link.tags.filter((t) => now.tagWords.some((word) => word === t.word));
    const newWords = now.tagWords.filter((word) => !link.tags.some((t) => t.word === word));
    const added = readHashtags(newWords, tags);
    const fromTitle = readHashtags(now.titleTagWords, tags);
    const removedIds = link.tags.filter((t) => !kept.includes(t)).map((t) => t.tagId);
    const userTags = note.tagIds.filter((id) => !isLifetimeTag(id));
    const tagIds = withTags(
      userTags.filter((id) => !removedIds.includes(id)),
      [...added.tags, ...fromTitle.tags].map((t) => t.tagId),
      tags,
    );
    if (tagIds.length !== userTags.length || tagIds.some((id) => !userTags.includes(id))) change.tagIds = tagIds;

    // The body: a typed note's details (a regular one becomes long-form). Removing it changes nothing.
    if (now.body !== before.body && now.body !== "" && note.titleText !== undefined && note.detailsImage === undefined) {
      const details = now.body.slice(0, DETAILS_TEXT_MAX_LENGTH);
      if (details !== note.detailsText) change.detailsText = details;
    }

    // The time (a series' note has none).
    if (!link.recurring && !sameTime(event.start, link.start)) {
      const due = dueOf(event.start);
      change.dueDateTime = due.dueDateTime ?? null;
      change.allDay = due.allDay;
    }

    await this.saveLink(userId, noteId, {
      ...this.linkFrom(event, [...kept, ...added.tags], added.unknown.concat(link.unknown.filter((word) => now.tagWords.includes(word)))),
      ...(link.recurring && { recurring: true as const }),
      ...(link.noAlert && { noAlert: true as const }),
    });
    if (Object.keys(change).length > 0) await store.calendarUpdate(noteId, change);
  }

  /** A link holding the event as Google has it. */
  private linkFrom(event: GoogleEvent, tags: Link["tags"], unknown: string[]): Link {
    return {
      eventId: event.id,
      ...(event.etag !== undefined && { etag: event.etag }),
      summary: event.summary ?? "",
      description: event.description ?? "",
      ...(event.start && { start: event.start }),
      ...(event.end && { end: event.end }),
      tags,
      unknown: [...new Set(unknown)],
      ...(event.extendedProperties?.private?.[NOTE_ID_PROPERTY] !== undefined && { marked: true as const }),
    };
  }

  // ---- From nwsnotes to Google ----------------------------------------------------

  /** Makes the calendar match the notes: events made, changed and deleted. */
  private async pushChanges(userId: number, store: NoteStore): Promise<void> {
    const { notes, categories } = store.notesAndCategories();
    const tags = tagChoices(categories);
    const links = this.linksOf(userId);
    const ids = new Set(notes.map((note) => note.id));
    for (const [noteId, link] of [...links]) {
      if (ids.has(noteId)) continue;
      await this.removeLink(userId, noteId);
      if (!link.recurring) await this.deleteEvent(userId, link.eventId);
    }
    for (const note of notes) {
      const link = links.get(note.id);
      if (link?.recurring) {
        // A series: only its title and description follow the note.
        const wanted = this.wanted(note, link, tags);
        const patch = this.textPatch(note, link, wanted);
        if (Object.keys(patch).length > 0) await this.writeEvent(userId, note, link, wanted, patch);
        continue;
      }
      if (!this.synced(userId, note)) {
        if (link) {
          await this.removeLink(userId, note.id);
          await this.deleteEvent(userId, link.eventId);
        }
        continue;
      }
      const wanted = this.wanted(note, link, tags);
      if (!link) {
        await this.writeEvent(userId, note, undefined, wanted, {
          summary: wanted.summary,
          description: wanted.description,
          start: wanted.start,
          end: wanted.end,
          reminders: alertsFor(wanted.allDay, note.noReminder === true),
          extendedProperties: { private: { [NOTE_ID_PROPERTY]: String(note.id) } },
        });
        continue;
      }
      const timeChanged = !sameTime(wanted.start, link.start) || !sameTime(wanted.end, link.end);
      // The reminder turned off or on in nwsnotes: the alert follows.
      const alertChanged = (link.noAlert === true) !== (note.noReminder === true);
      const patch = {
        ...this.textPatch(note, link, wanted),
        ...(timeChanged && { start: wanted.start, end: wanted.end }),
        ...((timeChanged || alertChanged) && { reminders: alertsFor(wanted.allDay, note.noReminder === true) }),
      };
      if (Object.keys(patch).length > 0) await this.writeEvent(userId, note, link, wanted, patch);
    }
  }

  /** What of an event's title and description needs changing, and the note's id if it doesn't carry it yet (one added in Google). */
  private textPatch(note: Note, link: Link, wanted: WantedEvent): Record<string, unknown> {
    return {
      ...(wanted.summary !== link.summary && { summary: wanted.summary }),
      ...(!sameDescription(wanted.description, link.description) && { description: wanted.description }),
      ...(!link.marked && { extendedProperties: { private: { [NOTE_ID_PROPERTY]: String(note.id) } } }),
    };
  }

  /** Whether a note has an event: the user's own, due, New, Active or Waiting, and not past due when they connected. */
  private synced(userId: number, note: Note): boolean {
    if (note.dueDateTime === undefined) return false;
    if (![LIFETIME_NEW, LIFETIME_ACTIVE, LIFETIME_WAITING].includes(lifetimeOf(note))) return false;
    return this.accounts.get(userId)?.skipped?.[String(note.id)] !== note.dueDateTime;
  }

  /** The event a note should have. */
  private wanted(note: Note, link: Link | undefined, tags: TagChoice[]): WantedEvent {
    // The note's tags in category and tag order, each as the hashtag last written or typed for it (if it still names it).
    const tagWords = tags
      .filter((tag) => note.tagIds.includes(tag.id))
      .map((tag) => {
        const written = link?.tags.find((t) => t.tagId === tag.id && sameHashtag(hashtagText(t.word) ?? "", tag.name));
        return { word: written?.word ?? hashtagOf(tag.name), tagId: tag.id };
      });
    const unknown = link?.unknown ?? [];
    const body = note.detailsImage !== undefined ? HANDWRITTEN_EVENT_DESCRIPTION : isLongForm(note) ? (note.detailsText ?? "") : "";
    const wanted: WantedEvent = {
      summary: note.titleText ?? HANDWRITTEN_EVENT_TITLE,
      description: joinDescription([...tagWords.map((t) => t.word), ...unknown], body),
      allDay: false,
      tags: tagWords,
      unknown,
    };
    if (note.dueDateTime === undefined) return wanted;
    if (note.allDay && isAllDayTime(note.dueDateTime)) {
      // All-day: as many days as the event has now (one, to start with).
      const date = ukDate(note.dueDateTime);
      const days =
        link?.start?.date && link.end?.date ? Math.max(1, Math.round((Date.parse(link.end.date) - Date.parse(link.start.date)) / DAY_MS)) : 1;
      return { ...wanted, allDay: true, start: { date }, end: { date: laterDate(date, days) } };
    }
    // Timed: as long as the event is now (DEFAULT_EVENT_MINUTES, to start with).
    const length =
      link?.start?.dateTime && link.end?.dateTime
        ? Math.max(0, Date.parse(link.end.dateTime) - Date.parse(link.start.dateTime))
        : DEFAULT_EVENT_MINUTES * MINUTE_MS;
    const start = Date.parse(note.dueDateTime);
    return {
      ...wanted,
      start: { dateTime: new Date(start).toISOString(), timeZone: TIME_ZONE },
      end: { dateTime: new Date(start + length).toISOString(), timeZone: TIME_ZONE },
    };
  }

  /** Makes (no link) or changes an event, keeping what Google answers as the note's link. */
  private async writeEvent(userId: number, note: Note, link: Link | undefined, wanted: WantedEvent, body: Record<string, unknown>): Promise<void> {
    let sent = body;
    const noAlert = body.reminders ? note.noReminder === true : link?.noAlert === true;
    if (this.allDayAlertRefused && wanted.allDay && body.reminders && !noAlert) sent = { ...body, reminders: { useDefault: true } };
    let event: GoogleEvent;
    try {
      event = await this.sendEvent(userId, link, sent);
    } catch (error) {
      if (error instanceof GoogleError && (error.status === 404 || error.status === 410) && link) {
        // Deleted in Google meanwhile: as if read from Google, the note goes to the Bin.
        await this.removeLink(userId, note.id);
        await (await this.notebooks.for(userId)).calendarUpdate(note.id, { toBin: true });
        return;
      }
      // Google wouldn't take the 09:00 alert on an all-day event: the calendar's own alerts instead, from now on.
      if (!(error instanceof GoogleError && error.status === 400 && wanted.allDay && sent.reminders && !noAlert)) throw error;
      console.warn("Google Calendar refused the 09:00 alert on an all-day event; all-day events use the calendar's own alerts.", error.message);
      this.allDayAlertRefused = true;
      event = await this.sendEvent(userId, link, { ...body, reminders: { useDefault: true } });
    }
    await this.saveLink(userId, note.id, {
      ...this.linkFrom(event, wanted.tags, wanted.unknown),
      ...(link?.recurring && { recurring: true as const }),
      ...(noAlert && { noAlert: true as const }),
    });
  }

  private sendEvent(userId: number, link: Link | undefined, body: Record<string, unknown>): Promise<GoogleEvent> {
    return link
      ? this.call<GoogleEvent>(userId, "PATCH", `/events/${encodeURIComponent(link.eventId)}`, { body })
      : this.call<GoogleEvent>(userId, "POST", "/events", { body });
  }

  private async deleteEvent(userId: number, eventId: string): Promise<void> {
    try {
      await this.call(userId, "DELETE", `/events/${encodeURIComponent(eventId)}`);
    } catch (error) {
      // Already deleted in Google.
      if (!(error instanceof GoogleError && (error.status === 404 || error.status === 410))) throw error;
    }
  }

  // ---- Stored data ---------------------------------------------------------------

  private linksOf(userId: number): Map<number, Link> {
    let links = this.links.get(userId);
    if (!links) {
      links = new Map();
      this.links.set(userId, links);
    }
    return links;
  }

  private async saveAccount(userId: number, account: Account): Promise<void> {
    await this.db.query(
      "INSERT INTO nwsnotes.google_accounts (user_id, data) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data",
      [userId, JSON.stringify(account)],
    );
    this.accounts.set(userId, account);
  }

  private async saveLink(userId: number, noteId: number, link: Link): Promise<void> {
    await this.db.query(
      "INSERT INTO nwsnotes.google_events (user_id, note_id, data) VALUES ($1, $2, $3) ON CONFLICT (user_id, note_id) DO UPDATE SET data = EXCLUDED.data",
      [userId, noteId, JSON.stringify(link)],
    );
    this.linksOf(userId).set(noteId, link);
  }

  private async removeLink(userId: number, noteId: number): Promise<void> {
    await this.db.query("DELETE FROM nwsnotes.google_events WHERE user_id = $1 AND note_id = $2", [userId, noteId]);
    this.linksOf(userId).delete(noteId);
  }
}
