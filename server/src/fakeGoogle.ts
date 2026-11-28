import express, { type NextFunction, type Request, type Response } from "express";
import type { GoogleEvent } from "./google.js";

/*
 * A fake of the parts of Google's sign-in and Calendar API that nwsnotes uses, kept in memory, for
 * development and the end-to-end tests (never in production): connecting works without a Google
 * account, and the tests (under /control) add, change and delete events as a person would in Google.
 * Like Google, every change is announced to the calendar's webhooks, and read back with sync tokens.
 */

interface FakeCalendar {
  id: string;
  summary: string;
  timeZone?: string;
  events: Map<string, { event: GoogleEvent & Record<string, unknown>; changed: number }>;
}

interface Channel {
  id: string;
  calendarId: string;
  address: string;
  token?: string;
  resourceId: string;
}

/** Google's errors' shape. */
function googleError(res: Response, status: number, message: string, reason?: string) {
  res.status(status).json({ error: { code: status, message, ...(reason && { errors: [{ reason, message }] }) } });
}

export class FakeGoogle {
  private seq = 0;
  private readonly codes = new Map<string, string>();
  private readonly refreshTokens = new Set<string>();
  private readonly accessTokens = new Set<string>();
  private readonly calendars = new Map<string, FakeCalendar>();
  private readonly channels = new Map<string, Channel>();
  /** Test settings: the next sign-in is declined; negative reminder minutes are refused; webhooks are sent. */
  private settings = { declineNext: false, refuseNegativeReminders: false, webhooks: true };

  reset(): void {
    this.seq = 0;
    this.codes.clear();
    this.refreshTokens.clear();
    this.accessTokens.clear();
    this.calendars.clear();
    this.channels.clear();
    this.settings = { declineNext: false, refuseNegativeReminders: false, webhooks: true };
  }

  private next(): number {
    return ++this.seq;
  }

  router(): express.Router {
    const router = express.Router();
    router.use(express.urlencoded({ extended: false }));

    // ---- Sign-in ----
    router.get("/oauth/auth", (req, res) => {
      const redirect = new URL(String(req.query.redirect_uri));
      redirect.searchParams.set("state", String(req.query.state ?? ""));
      if (this.settings.declineNext) {
        this.settings.declineNext = false;
        redirect.searchParams.set("error", "access_denied");
      } else {
        const code = `code-${this.next()}`;
        this.codes.set(code, `refresh-${this.next()}`);
        redirect.searchParams.set("code", code);
      }
      res.redirect(redirect.toString());
    });
    router.post("/oauth/token", (req, res) => {
      const body = req.body as Record<string, string | undefined>;
      let refreshToken: string | undefined;
      if (body.grant_type === "authorization_code") {
        refreshToken = this.codes.get(body.code ?? "");
        this.codes.delete(body.code ?? "");
        if (refreshToken) this.refreshTokens.add(refreshToken);
      } else if (body.grant_type === "refresh_token" && this.refreshTokens.has(body.refresh_token ?? "")) {
        refreshToken = body.refresh_token;
      }
      if (!refreshToken) return res.status(400).json({ error: "invalid_grant", error_description: "Token has been expired or revoked." });
      const accessToken = `access-${this.next()}`;
      this.accessTokens.add(accessToken);
      res.json({
        access_token: accessToken,
        expires_in: 3600,
        token_type: "Bearer",
        ...(body.grant_type === "authorization_code" && { refresh_token: refreshToken }),
      });
    });
    router.post("/oauth/revoke", (req, res) => {
      this.refreshTokens.delete(String(req.query.token ?? ""));
      res.json({});
    });

    // ---- Calendar API ----
    const api = express.Router();
    api.use((req: Request, res: Response, next: NextFunction) => {
      const token = /^Bearer (.+)$/.exec(req.get("Authorization") ?? "")?.[1];
      if (!token || !this.accessTokens.has(token)) return googleError(res, 401, "Invalid Credentials", "authError");
      next();
    });
    api.post("/calendars", (req, res) => {
      const body = req.body as { summary?: string; timeZone?: string };
      const calendar: FakeCalendar = { id: `calendar-${this.next()}@fake.google`, summary: body.summary ?? "", timeZone: body.timeZone, events: new Map() };
      this.calendars.set(calendar.id, calendar);
      res.json({ id: calendar.id, summary: calendar.summary, timeZone: calendar.timeZone });
    });
    api.get("/calendars/:calendar", (req, res) => {
      const calendar = this.calendars.get(req.params.calendar);
      if (!calendar) return googleError(res, 404, "Not Found", "notFound");
      res.json({ id: calendar.id, summary: calendar.summary, timeZone: calendar.timeZone });
    });
    api.post("/calendars/:calendar/events", (req, res) => {
      const made = this.addEvent(req.params.calendar, req.body as Record<string, unknown>);
      if (typeof made === "string") return googleError(res, made === "Not Found" ? 404 : 400, made);
      res.json(made);
    });
    api.patch("/calendars/:calendar/events/:event", (req, res) => {
      const changed = this.changeEvent(req.params.calendar, req.params.event, req.body as Record<string, unknown>);
      if (typeof changed === "number") return googleError(res, changed, changed === 410 ? "Resource has been deleted" : "Not Found");
      if (typeof changed === "string") return googleError(res, 400, changed);
      res.json(changed);
    });
    api.delete("/calendars/:calendar/events/:event", (req, res) => {
      const status = this.deleteEvent(req.params.calendar, req.params.event);
      if (status !== 204) return googleError(res, status, status === 410 ? "Resource has been deleted" : "Not Found");
      res.status(204).end();
    });
    api.get("/calendars/:calendar/events", (req, res) => {
      const calendar = this.calendars.get(req.params.calendar);
      if (!calendar) return googleError(res, 404, "Not Found", "notFound");
      const syncToken = typeof req.query.syncToken === "string" ? req.query.syncToken : undefined;
      let since: number | undefined;
      if (syncToken !== undefined) {
        since = Number(/^sync-(\d+)$/.exec(syncToken)?.[1] ?? NaN);
        if (Number.isNaN(since) || since > this.seq) return googleError(res, 410, "Sync token is no longer valid, a full sync is required.", "fullSyncRequired");
      }
      const all = [...calendar.events.values()]
        .filter((stored) => (since === undefined ? stored.event.status !== "cancelled" : stored.changed > since))
        .sort((a, b) => a.changed - b.changed)
        .map((stored) => stored.event);
      const size = Math.max(1, Number(req.query.maxResults ?? 250));
      const offset = Number(req.query.pageToken ?? 0);
      const items = all.slice(offset, offset + size);
      const more = offset + size < all.length;
      res.json({ items, ...(more ? { nextPageToken: String(offset + size) } : { nextSyncToken: `sync-${this.seq}` }) });
    });
    api.post("/calendars/:calendar/events/watch", (req, res) => {
      const body = req.body as { id: string; address: string; token?: string; params?: { ttl?: string } };
      const calendar = this.calendars.get(req.params.calendar);
      if (!calendar) return googleError(res, 404, "Not Found", "notFound");
      const channel: Channel = { id: body.id, calendarId: calendar.id, address: body.address, token: body.token, resourceId: `resource-${calendar.id}` };
      this.channels.set(channel.id, channel);
      res.json({ kind: "api#channel", id: channel.id, resourceId: channel.resourceId, expiration: String(Date.now() + Number(body.params?.ttl ?? 604800) * 1000) });
      this.announce(channel, "sync");
    });
    api.post("/channels/stop", (req, res) => {
      this.channels.delete(String((req.body as { id?: string }).id));
      res.status(204).end();
    });
    router.use("/calendar/v3", api);

    // ---- The tests' controls: as a person would in Google, or Google itself ----
    router.get("/control/calendars", (_req, res) => {
      res.set("Cache-Control", "no-store");
      res.json(
        [...this.calendars.values()].map((calendar) => ({
          id: calendar.id,
          summary: calendar.summary,
          timeZone: calendar.timeZone,
          events: [...calendar.events.values()].filter((stored) => stored.event.status !== "cancelled").map((stored) => stored.event),
          channels: [...this.channels.values()].filter((channel) => channel.calendarId === calendar.id).length,
        })),
      );
    });
    router.post("/control/calendars/:calendar/events", (req, res) => {
      const made = this.addEvent(req.params.calendar, req.body as Record<string, unknown>);
      if (typeof made === "string") return googleError(res, 400, made);
      res.json(made);
    });
    router.patch("/control/calendars/:calendar/events/:event", (req, res) => {
      const changed = this.changeEvent(req.params.calendar, req.params.event, req.body as Record<string, unknown>);
      if (typeof changed !== "object") return googleError(res, typeof changed === "number" ? changed : 400, String(changed));
      res.json(changed);
    });
    router.delete("/control/calendars/:calendar/events/:event", (req, res) => {
      res.status(this.deleteEvent(req.params.calendar, req.params.event)).end();
    });
    router.delete("/control/calendars/:calendar", (req, res) => {
      this.calendars.delete(req.params.calendar);
      res.status(204).end();
    });
    // The person removes nwsnotes' access in their Google account.
    router.post("/control/revoke-all", (_req, res) => {
      this.refreshTokens.clear();
      this.accessTokens.clear();
      res.status(204).end();
    });
    router.post("/control/settings", (req, res) => {
      this.settings = { ...this.settings, ...(req.body as Partial<FakeGoogle["settings"]>) };
      res.json(this.settings);
    });
    return router;
  }

  private addEvent(calendarId: string, body: Record<string, unknown>): (GoogleEvent & Record<string, unknown>) | string {
    const calendar = this.calendars.get(calendarId);
    if (!calendar) return "Not Found";
    const refused = this.checkReminders(body);
    if (refused) return refused;
    const changed = this.next();
    const event = { ...body, id: `event${changed}`, etag: `"${changed}"`, status: "confirmed", updated: new Date().toISOString() } as GoogleEvent &
      Record<string, unknown>;
    calendar.events.set(event.id, { event, changed });
    this.changed(calendarId);
    return event;
  }

  private changeEvent(calendarId: string, eventId: string, body: Record<string, unknown>): (GoogleEvent & Record<string, unknown>) | number | string {
    const stored = this.calendars.get(calendarId)?.events.get(eventId);
    if (!stored) return 404;
    if (stored.event.status === "cancelled") return 410;
    const refused = this.checkReminders(body);
    if (refused) return refused;
    const changed = this.next();
    const merged: Record<string, unknown> = { ...stored.event };
    for (const [key, value] of Object.entries(body)) {
      if (key === "extendedProperties") {
        const old = (stored.event.extendedProperties ?? {}) as { private?: Record<string, string> };
        merged[key] = { ...old, private: { ...old.private, ...(value as { private?: Record<string, string> }).private } };
      } else if (value === null) {
        delete merged[key];
      } else {
        merged[key] = value;
      }
    }
    const event = { ...merged, etag: `"${changed}"`, updated: new Date().toISOString() } as unknown as GoogleEvent & Record<string, unknown>;
    this.calendars.get(calendarId)!.events.set(eventId, { event, changed });
    this.changed(calendarId);
    return event;
  }

  private deleteEvent(calendarId: string, eventId: string): number {
    const stored = this.calendars.get(calendarId)?.events.get(eventId);
    if (!stored) return 404;
    if (stored.event.status === "cancelled") return 410;
    const changed = this.next();
    this.calendars.get(calendarId)!.events.set(eventId, { event: { ...stored.event, status: "cancelled", etag: `"${changed}"` }, changed });
    this.changed(calendarId);
    return 204;
  }

  /** Google refuses reminders it can't show: here, negative minutes, when the tests ask it to. */
  private checkReminders(body: Record<string, unknown>): string | undefined {
    const overrides = (body.reminders as { overrides?: { minutes: number }[] } | undefined)?.overrides ?? [];
    if (this.settings.refuseNegativeReminders && overrides.some((reminder) => reminder.minutes < 0)) return "Invalid reminder minutes.";
    return undefined;
  }

  /** Tells the calendar's webhooks it changed, as Google does. */
  private changed(calendarId: string): void {
    for (const channel of this.channels.values()) if (channel.calendarId === calendarId) this.announce(channel, "exists");
  }

  private announce(channel: Channel, state: "sync" | "exists"): void {
    if (!this.settings.webhooks) return;
    setTimeout(() => {
      void fetch(channel.address, {
        method: "POST",
        headers: {
          "X-Goog-Channel-ID": channel.id,
          ...(channel.token && { "X-Goog-Channel-Token": channel.token }),
          "X-Goog-Resource-ID": channel.resourceId,
          "X-Goog-Resource-State": state,
        },
      }).catch(() => undefined);
    }, 0);
  }
}
