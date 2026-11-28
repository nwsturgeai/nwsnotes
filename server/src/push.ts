import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import * as webpush from "web-push";
import { WebPushError, type PushSubscription } from "web-push";
import { withoutMarkers } from "@nwsnotes/shared";
import type { Notebooks } from "./notebooks.js";
import { RequestError } from "./store.js";

/** A device's subscription, and the user whose device it is. */
type Device = PushSubscription & { userId: number };

/** How often the server looks for notes that have fallen due. */
const CHECK_EVERY_MS = 60 * 1000;

/** What the service worker (push-sw.js) shows: the notification's heading and text, and a tag so a repeat replaces it. */
export interface PushMessage {
  title: string;
  body?: string;
  tag: string;
}

/**
 * Due-date reminders as Web Push notifications. The server's keys (VAPID) are made on first start and
 * kept in the data folder, as are the devices' subscriptions (not in the save-files: they belong to
 * each device, and each to the user who registered it). Every minute it sends a reminder for each note
 * that has just fallen due, to that note's user's devices only.
 */
export class PushReminders {
  private subscriptions: Device[] = [];
  private keys = { publicKey: "", privateKey: "" };
  private checking = false;
  /** Whether a note's alert comes from elsewhere (its Google Calendar event), so nwsnotes sends no reminder for it. */
  alertsElsewhere?: (userId: number, noteId: number) => boolean;
  /** End-to-end tests only: what would have been sent, as push services can't be reached from the tests. */
  private sentForTests: (PushMessage & { userId: number; devices: number })[] = [];

  constructor(
    private readonly dataDir: string,
    private readonly contact: string,
    private readonly notebooks: Notebooks,
    /** The end-to-end tests: nothing is sent; what would have been is kept for them to check. */
    private readonly testMode = false,
  ) {}

  private get keysFile() {
    return path.join(this.dataDir, "push-keys.json");
  }

  private get subscriptionsFile() {
    return path.join(this.dataDir, "push-subscriptions.json");
  }

  /** Loads (or makes) the keys and the devices, then starts the minute-by-minute check. */
  async init(): Promise<void> {
    const keys = await readJson<{ publicKey?: string; privateKey?: string }>(this.keysFile);
    if (keys?.publicKey && keys.privateKey) {
      this.keys = { publicKey: keys.publicKey, privateKey: keys.privateKey };
    } else {
      this.keys = webpush.generateVAPIDKeys();
      await writeJson(this.keysFile, this.keys);
      console.log(`Made new push keys in ${this.keysFile}`);
    }
    webpush.setVapidDetails(this.contact, this.keys.publicKey, this.keys.privateKey);
    this.subscriptions = (await readJson<(PushSubscription & { userId: number })[]>(this.subscriptionsFile)) ?? [];
    console.log(`Reminders go to ${this.subscriptions.length} device(s).`);

    // Straight away (to catch reminders missed while the server was down), then every minute.
    void this.checkDue();
    setInterval(() => void this.checkDue(), CHECK_EVERY_MS).unref();
  }

  publicKey(): string {
    return this.keys.publicKey;
  }

  /** Adds a device's subscription for this user, or updates it if the device sends it again (perhaps for another user). */
  async subscribe(userId: number, raw: unknown): Promise<void> {
    const subscription = validSubscription(raw);
    this.subscriptions = [...this.subscriptions.filter((s) => s.endpoint !== subscription.endpoint), { ...subscription, userId }];
    await writeJson(this.subscriptionsFile, this.subscriptions);
  }

  /** Forgets a device (reminders turned off, or logging out). */
  async unsubscribe(userId: number, raw: unknown): Promise<void> {
    const endpoint = (raw as { endpoint?: unknown } | undefined)?.endpoint;
    if (typeof endpoint !== "string") throw new RequestError(400, `"endpoint" must be the subscription's endpoint.`);
    // Only this user's own device.
    if (this.subscriptions.some((s) => s.endpoint === endpoint && s.userId === userId)) await this.remove([endpoint]);
  }

  /** End-to-end tests only: forgets every device, so each test starts with none, and what was sent. */
  async forgetAllDevices(): Promise<void> {
    this.subscriptions = [];
    this.sentForTests = [];
    await writeJson(this.subscriptionsFile, this.subscriptions);
  }

  /** End-to-end tests only: the notifications that would have been sent to this user, oldest first. */
  notificationsForTests(userId: number): (PushMessage & { devices: number })[] {
    return this.sentForTests.filter((sent) => sent.userId === userId).map(({ userId: _user, ...sent }) => sent);
  }

  /** End-to-end tests only: looks for notes that have fallen due now, rather than at the next minute. */
  checkDueForTests(): Promise<void> {
    return this.checkDue();
  }

  /** A notification to every device of the user that has reminders on. Returns how many it reached. */
  notify(userId: number, message: PushMessage): Promise<number> {
    return this.sendToUser(userId, message);
  }

  /** "Send test": returns how many of this user's devices it reached. */
  sendTest(userId: number): Promise<number> {
    return this.sendToUser(userId, { title: "Test reminder", tag: "test" });
  }

  /** Sends to every device of the user; devices the push service says are gone are forgotten. Returns how many it reached. */
  private async sendToUser(userId: number, message: PushMessage): Promise<number> {
    if (this.testMode) {
      const devices = this.subscriptions.filter((device) => device.userId === userId).length;
      if (devices > 0) this.sentForTests.push({ ...message, userId, devices });
      return devices;
    }
    const payload = JSON.stringify(message);
    const gone: string[] = [];
    let reached = 0;
    await Promise.all(
      this.subscriptions.filter((device) => device.userId === userId).map(async ({ userId: _user, ...subscription }) => {
        try {
          // High urgency, or Android holds the reminder back while the phone is idle (Doze) until it next wakes.
          await webpush.sendNotification(subscription, payload, { urgency: "high" });
          reached++;
        } catch (error) {
          if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
            gone.push(subscription.endpoint);
          } else {
            console.error(`Couldn't send a reminder to ${new URL(subscription.endpoint).host}:`, error);
          }
        }
      }),
    );
    if (gone.length > 0) await this.remove(gone);
    return reached;
  }

  private async remove(endpoints: string[]): Promise<void> {
    const kept = this.subscriptions.filter((s) => !endpoints.includes(s.endpoint));
    if (kept.length === this.subscriptions.length) return;
    this.subscriptions = kept;
    await writeJson(this.subscriptionsFile, this.subscriptions);
  }

  /**
   * Sends a reminder for each note that has fallen due, then records that it was sent. Every user with
   * a device is checked (their notebook is loaded if it isn't yet), and every notebook already loaded.
   */
  private async checkDue(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      const users = this.notebooks.users;
      if (!users.isReady()) return;
      const ids = new Set([...this.subscriptions.map((device) => device.userId), ...(await this.notebooks.loaded()).map((store) => store.userId)]);
      for (const userId of ids) {
        const user = users.byId(userId);
        if (!user || user.disabled) continue;
        try {
          const store = await this.notebooks.for(userId);
          const due = store.dueForReminder(new Date());
          if (due.length === 0) continue;
          for (const note of due) {
            // Recorded as reminded all the same, so disconnecting doesn't send a late one.
            if (this.alertsElsewhere?.(userId, note.id)) continue;
            await this.sendToUser(userId, {
              title: note.titleText !== undefined ? `Due: ${withoutMarkers(note.titleText)}` : "A note is due",
              tag: `note-${note.id}`,
            });
          }
          // Recorded even if no device was reached, so a reminder is never sent late to a device added later.
          await store.markReminded(due);
        } catch (error) {
          console.error(`Couldn't send user ${userId}'s reminders:`, error);
        }
      }
    } catch (error) {
      console.error("Couldn't send reminders:", error);
    } finally {
      this.checking = false;
    }
  }
}

/** A browser's push subscription: an https endpoint and its two keys. */
function validSubscription(raw: unknown): PushSubscription {
  const { endpoint, keys } = (raw ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const isHttps = typeof endpoint === "string" && URL.canParse(endpoint) && new URL(endpoint).protocol === "https:";
  if (!isHttps || typeof keys?.p256dh !== "string" || typeof keys.auth !== "string") {
    throw new RequestError(400, "That isn't a valid push subscription.");
  }
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Written to a temporary name and renamed, so a crash can't leave a half-written file. */
async function writeJson(file: string, value: unknown): Promise<void> {
  const temp = `${file}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), "utf8");
  await rename(temp, file);
}
