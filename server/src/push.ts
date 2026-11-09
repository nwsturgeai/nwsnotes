import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import webpush, { WebPushError, type PushSubscription } from "web-push";
import { RequestError, type NoteStore } from "./store.js";

/** How often the server looks for notes that have fallen due. */
const CHECK_EVERY_MS = 60 * 1000;

/** What the service worker (push-sw.js) shows: the notification's text, and a tag so a repeat replaces it. */
interface PushMessage {
  title: string;
  tag: string;
}

/**
 * Due-date reminders as Web Push notifications. The server's keys (VAPID) are made on first start and
 * kept in the data folder, as are the devices' subscriptions (not in the save-files: they belong to
 * each device). Every minute it sends a reminder for each note that has just fallen due.
 */
export class PushReminders {
  private subscriptions: PushSubscription[] = [];
  private keys = { publicKey: "", privateKey: "" };
  private checking = false;

  constructor(
    private readonly dataDir: string,
    private readonly contact: string,
    private readonly store: NoteStore,
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
    this.subscriptions = (await readJson<PushSubscription[]>(this.subscriptionsFile)) ?? [];
    console.log(`Reminders go to ${this.subscriptions.length} device(s).`);

    // Straight away (to catch reminders missed while the server was down), then every minute.
    void this.checkDue();
    setInterval(() => void this.checkDue(), CHECK_EVERY_MS).unref();
  }

  publicKey(): string {
    return this.keys.publicKey;
  }

  /** Adds a device's subscription, or updates it if the device sends it again. */
  async subscribe(raw: unknown): Promise<void> {
    const subscription = validSubscription(raw);
    this.subscriptions = [...this.subscriptions.filter((s) => s.endpoint !== subscription.endpoint), subscription];
    await writeJson(this.subscriptionsFile, this.subscriptions);
  }

  /** Forgets a device (reminders turned off, or logging out). */
  async unsubscribe(raw: unknown): Promise<void> {
    const endpoint = (raw as { endpoint?: unknown } | undefined)?.endpoint;
    if (typeof endpoint !== "string") throw new RequestError(400, `"endpoint" must be the subscription's endpoint.`);
    await this.remove([endpoint]);
  }

  /** "Send test": returns how many devices it reached. */
  sendTest(): Promise<number> {
    return this.sendToAll({ title: "Test reminder", tag: "test" });
  }

  /** Sends to every device; devices the push service says are gone are forgotten. Returns how many it reached. */
  private async sendToAll(message: PushMessage): Promise<number> {
    const payload = JSON.stringify(message);
    const gone: string[] = [];
    let reached = 0;
    await Promise.all(
      this.subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(subscription, payload);
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

  /** Sends a reminder for each note that has fallen due, then records that it was sent. */
  private async checkDue(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      const due = this.store.dueForReminder(new Date());
      if (due.length === 0) return;
      for (const note of due) {
        await this.sendToAll({
          title: note.titleText !== undefined ? `Due: ${note.titleText}` : "A note is due",
          tag: `note-${note.id}`,
        });
      }
      // Recorded even if no device was reached, so a reminder is never sent late to a device added later.
      await this.store.markReminded(due);
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
