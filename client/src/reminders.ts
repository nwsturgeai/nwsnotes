import { api } from "./api";

/**
 * Due-date reminders on this device: browser notifications pushed by the server (Web Push), shown by
 * the service worker even when the app is closed.
 */

/**
 * - "unavailable": no service worker (development) or no push support in this browser
 * - "blocked": the browser has been told not to show this site's notifications
 * - "on" / "off": whether this device is subscribed
 */
export type ReminderState = "unavailable" | "blocked" | "on" | "off";

export const remindersAvailable =
  !import.meta.env.DEV && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export async function reminderState(): Promise<ReminderState> {
  if (!remindersAvailable) return "unavailable";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission !== "granted") return "off";
  return (await currentSubscription()) ? "on" : "off";
}

/** The server's key, from base64url text to the bytes the browser wants. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

/** Asks for permission if needed, subscribes this device and registers it with the server. */
export async function turnOnReminders(): Promise<ReminderState> {
  if (!remindersAvailable) return "unavailable";
  const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (permission === "denied") return "blocked";
  if (permission !== "granted") return "off";
  let subscription = await currentSubscription();
  if (!subscription) {
    const { publicKey } = await api.pushKey();
    const registration = await navigator.serviceWorker.ready;
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  }
  await api.pushSubscribe(subscription.toJSON());
  return "on";
}

/** Unsubscribes this device and tells the server to forget it. */
export async function turnOffReminders(): Promise<ReminderState> {
  if (!remindersAvailable) return "unavailable";
  const subscription = await currentSubscription();
  if (subscription) {
    await api.pushUnsubscribe(subscription.endpoint);
    await subscription.unsubscribe();
  }
  return reminderState();
}

/** Straight after logging in: asks for permission if the browser hasn't been asked yet, and subscribes. */
export function remindAfterLogin() {
  if (!remindersAvailable || Notification.permission === "denied") return;
  turnOnReminders().catch((error: unknown) => console.warn("Couldn't turn on reminders:", error));
}

/** At start-up: makes sure the server still has this device's subscription, if it has one. */
export function registerReminders() {
  if (!remindersAvailable || Notification.permission !== "granted") return;
  currentSubscription()
    .then((subscription) => subscription && api.pushSubscribe(subscription.toJSON()))
    .catch((error: unknown) => console.warn("Couldn't register this device for reminders:", error));
}
