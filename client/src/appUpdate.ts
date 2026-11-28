import { useSyncExternalStore } from "react";
import { registerSW } from "virtual:pwa-register";
import { isOffline } from "./offline";

/**
 * New versions of the app. The service worker downloads a new version in the background, then it
 * waits until "Reload" is tapped, so the app never reloads by itself in the middle of something.
 */

/** The app checks for a new version at most this often (besides the browser's own check at start-up). */
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
/** While the app is open, how often it looks at whether the daily check is due. */
const DUE_CHECK_EVERY_MS = 60 * 60 * 1000;
const LAST_CHECK_KEY = "nwsnotes.lastUpdateCheck";

/** In development there's no service worker, so there's nothing to update. */
export const updatesAvailable = !import.meta.env.DEV && "serviceWorker" in navigator;

/** When this version was built, set by Vite at build time. */
export const buildTime = new Date(__BUILD_TIME__);

let updateReady = false;
let registration: ServiceWorkerRegistration | undefined;
const listeners = new Set<() => void>();

function setUpdateReady() {
  updateReady = true;
  for (const listener of listeners) listener();
}

/** Whether a new version has been downloaded and is waiting for "Reload" (re-renders when it changes). */
export function useUpdateReady(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => updateReady,
  );
}

/** How long Reload waits for the new version to take over before reloading anyway. */
const SWITCH_TIMEOUT_MS = 5000;
let reloading = false;

/**
 * Switches to the downloaded new version, then reloads the page. It doesn't rely on the page being
 * in the service worker's charge (it isn't after a hard refresh, Ctrl+F5), so it tells the waiting
 * version to take over itself, and reloads once it has, or after a few seconds whatever happens.
 */
export async function reloadToUpdate() {
  if (reloading) return;
  reloading = true;
  const waiting = registration?.waiting ?? (await navigator.serviceWorker?.getRegistration())?.waiting;
  if (waiting) {
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, SWITCH_TIMEOUT_MS);
      const done = () => {
        if (waiting.state === "activated" || waiting.state === "redundant") {
          window.clearTimeout(timer);
          resolve();
        }
      };
      waiting.addEventListener("statechange", done);
      waiting.postMessage({ type: "SKIP_WAITING" });
      done();
    });
  }
  window.location.reload();
}

function lastCheck(): number {
  try {
    return Number(localStorage.getItem(LAST_CHECK_KEY)) || 0;
  } catch {
    return 0;
  }
}

function rememberCheck() {
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
  } catch {
    // Not remembered: the next due-check simply checks again.
  }
}

/**
 * Asks the server whether there's a new version and, if so, waits for it to download.
 * Returns whether a new version is ready. Throws if the server couldn't be asked.
 */
export async function checkForUpdate(): Promise<boolean> {
  if (updateReady) return true;
  if (!registration) throw new Error("the app's update service isn't running.");
  await registration.update();
  rememberCheck();
  const downloading = registration.installing;
  if (downloading) {
    // Finished once it's waiting ("installed"), or failed ("redundant").
    await new Promise<void>((resolve) => {
      const done = () => {
        if (downloading.state !== "installing") {
          downloading.removeEventListener("statechange", done);
          resolve();
        }
      };
      downloading.addEventListener("statechange", done);
      done();
    });
  }
  // A page loaded past the service worker (a hard refresh) isn't told of the new version, so say so here.
  if (registration.waiting && !updateReady) setUpdateReady();
  return updateReady;
}

/** The daily check: only if the last one was a day or more ago, and not while offline. */
function checkIfDue() {
  if (isOffline() || Date.now() - lastCheck() < CHECK_EVERY_MS) return;
  checkForUpdate().catch(() => {
    // Not remembered as a check, so it's tried again next time.
  });
}

/** Registers the service worker and starts the daily checks. Called once, at start-up. */
export function initAppUpdates() {
  if (!updatesAvailable) return;
  registerSW({
    immediate: true,
    onNeedRefresh: setUpdateReady,
    onRegisteredSW: (_url, registered) => {
      registration = registered;
      // Downloaded earlier and still waiting (the page may not be told of it after a hard refresh).
      if (registered?.waiting) setUpdateReady();
      checkIfDue();
    },
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkIfDue();
  });
  window.setInterval(checkIfDue, DUE_CHECK_EVERY_MS);
}
