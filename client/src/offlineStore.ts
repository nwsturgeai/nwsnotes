/*
 * A small key-value store in the browser's IndexedDB, for the offline copy of the data and the outbox
 * of changes waiting to be sent. IndexedDB rather than local storage, because handwritten notes are
 * images and local storage is small. If IndexedDB isn't available (e.g. blocked site data), reads
 * find nothing and writes do nothing: the app still works online, just not offline.
 */

const DB_NAME = "nwsnotes";
const STORE = "kv";

let opening: Promise<IDBDatabase | undefined> | undefined;

function open(): Promise<IDBDatabase | undefined> {
  opening ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
      request.onblocked = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
  return opening;
}

/** The value stored under `key`, or undefined if there's none (or no IndexedDB). */
export async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await open();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

/** Stores `value` under `key`; resolves once it's written (or at once, if there's no IndexedDB). */
export async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await open();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}
