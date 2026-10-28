import { useSyncExternalStore } from "react";
import {
  isLifetimeTag,
  lifetimeOf,
  LIFETIME_CHANGES,
  LIFETIME_NEW,
  type LifetimeChange,
  type NewNoteRequest,
  type Note,
  type NotesData,
} from "@nwsnotes/shared";
import { ApiError, api } from "./api";
import { idbGet, idbSet } from "./offlineStore";

/*
 * Offline use. The notes page and the long-form editor add, edit, archive (etc.) and delete notes
 * through the functions here rather than `api` directly. Online, they go straight to the server.
 * Offline (the server couldn't be reached), or while earlier offline changes are still waiting,
 * they go into an outbox kept in IndexedDB and are applied to the local copy straight away. When the
 * server answers again the outbox is sent in order, one entry at a time.
 *
 * Notes created offline get a temporary negative id (-1001, -1002, ...) until their add is sent;
 * the real id then replaces it everywhere, and later changes made with the temporary id still work.
 */

type OutboxEntry = { seq: number; sending?: boolean } & (
  | { kind: "add"; tempId: number; body: NewNoteRequest }
  | { kind: "update"; noteId: number; body: NewNoteRequest }
  | { kind: "lifetime"; noteId: number; lifetime: LifetimeChange }
  | { kind: "delete"; noteId: number }
);

/** Everything about the waiting changes, stored as one value so tabs on one device can share it. */
interface Pending {
  outbox: OutboxEntry[];
  /** The latest local version of each note the outbox changes (null: deleted), laid over reloaded data. */
  latest: Record<number, Note | null>;
  /** Temporary ids of notes whose add has been sent -> their real ids. */
  idMap: Record<number, number>;
  nextTempId: number;
  nextSeq: number;
}

const PENDING_KEY = "pending";
const DATA_KEY = "data";
const FIRST_TEMP_ID = -1001;
/** While offline, how often to check whether the server can be reached again. */
const PROBE_MS = 15_000;

let pending: Pending = { outbox: [], latest: {}, idMap: {}, nextTempId: FIRST_TEMP_ID, nextSeq: 1 };
/** The data the app is showing (kept by the app), to build offline versions of notes from. */
let data: NotesData | undefined;

export interface OfflineState {
  offline: boolean;
  /** How many changes are waiting to be sent. */
  pendingCount: number;
  /** Notes with changes still waiting to be sent (temporary ids included). */
  pendingIds: ReadonlySet<number>;
}

let state: OfflineState = { offline: false, pendingCount: 0, pendingIds: new Set() };
const listeners = new Set<() => void>();

function publish(change?: Partial<OfflineState>) {
  state = {
    ...state,
    ...change,
    pendingCount: pending.outbox.length,
    pendingIds: new Set(Object.keys(pending.latest).map(Number)),
  };
  for (const listener of listeners) listener();
}

/** The offline state, for components (re-renders when it changes). */
export function useOfflineState(): OfflineState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

export function isOffline(): boolean {
  return state.offline;
}

/** What the app does when syncing changes something it shows. */
interface Handlers {
  /** The outbox was sent: `saved` changes reached the server; `lost` names notes whose change was rejected. */
  onSynced: (saved: number, lost: string[]) => void;
  /** A note created offline now has its real id (and the server's version of it). */
  onRemapped: (tempId: number, note: Note) => void;
  /** The session expired; the outbox is kept and sent after logging in again. */
  onSessionExpired: () => void;
}

let handlers: Partial<Handlers> = {};

export function setOfflineHandlers(next: Partial<Handlers>) {
  handlers = next;
}

// ---- Storage ---------------------------------------------------------------

/** Runs `task` holding a browser lock shared by this device's tabs (or just runs it, without locks). */
function withLock<T>(name: string, task: () => Promise<T>): Promise<T> {
  // The lock's promise resolves with the task's result (its type wraps it in a second Promise).
  return navigator.locks ? (navigator.locks.request(name, task) as unknown as Promise<T>) : task();
}

/** Reads the waiting changes back from IndexedDB (another tab may have changed them). */
async function reloadPending() {
  const stored = await idbGet<Pending>(PENDING_KEY);
  if (stored) pending = stored;
}

/** Changes the waiting changes and stores them, one tab at a time. */
async function changePending(change: (p: Pending) => void): Promise<void> {
  await withLock("nwsnotes-outbox", async () => {
    await reloadPending();
    change(pending);
    // Notes no change refers to any more drop out of `latest`; the reloaded data is right for them.
    const referenced = new Set(pending.outbox.map((entry) => resolve(entry.kind === "add" ? entry.tempId : entry.noteId)));
    for (const id of Object.keys(pending.latest).map(Number)) if (!referenced.has(id)) delete pending.latest[id];
    await idbSet(PENDING_KEY, pending);
  });
  publish();
}

/** Loads the waiting changes when the app starts. */
export async function initOffline(): Promise<void> {
  await reloadPending();
  publish();
}

let saveTimer: number | undefined;

/** The data the app is now showing: kept for building offline changes, and saved for opening offline. */
export function rememberData(next: NotesData) {
  data = next;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void idbSet(DATA_KEY, next), 500);
}

/** The data saved on this device, for opening the app while offline. */
export function savedData(): Promise<NotesData | undefined> {
  return idbGet<NotesData>(DATA_KEY);
}

/**
 * Data from the server (or what's shown) with the changes still waiting laid over it, so they don't
 * vanish on a reload. A note with a temporary id that's no longer waiting was forgotten (a long-form
 * note cancelled offline) or refused by the server, so it goes.
 */
export function withPending(server: NotesData): NotesData {
  const latest = pending.latest;
  const notes = server.notes
    .filter((note) => latest[note.id] !== null && (note.id > 0 || latest[note.id] !== undefined))
    .map((note) => latest[note.id] ?? note);
  // Notes created offline aren't on the server yet.
  for (const [id, note] of Object.entries(latest)) {
    if (note && Number(id) < 0 && !notes.some((n) => n.id === note.id)) notes.push(note);
  }
  return { ...server, notes };
}

// ---- Ids and local notes ---------------------------------------------------

/** A note's id now: a temporary id whose add has been sent becomes the real one. */
function resolve(id: number): number {
  return pending.idMap[id] ?? id;
}

function titleAndDetails(body: NewNoteRequest): Partial<Note> {
  return {
    ...(body.titleText !== undefined ? { titleText: body.titleText } : { titleImage: body.titleImage }),
    ...(body.detailsText !== undefined
      ? { detailsText: body.detailsText }
      : body.detailsImage !== undefined
        ? { detailsImage: body.detailsImage }
        : {}),
  };
}

const userTags = (tagIds: number[]) => tagIds.filter((id) => !isLifetimeTag(id));

/** A note as it is here now, waiting changes included. */
function localNote(id: number): Note | undefined {
  const noteId = resolve(id);
  const latest = pending.latest[noteId];
  if (latest !== undefined) return latest ?? undefined;
  return data?.notes.find((note) => note.id === noteId);
}

function notAvailable(method: string, url: string): ApiError {
  return new ApiError("This note isn't in the offline copy, so it can't be changed until you're back online.", method, url);
}

// ---- Online, or queued -----------------------------------------------------

const QUEUE = Symbol("queue");

/** Sends a change now, unless it must wait behind earlier ones; QUEUE if it should go in the outbox. */
async function tryOnline<T>(send: () => Promise<T>): Promise<T | typeof QUEUE> {
  if (state.offline || pending.outbox.length > 0) return QUEUE;
  try {
    return await send();
  } catch (error) {
    if (error instanceof ApiError && error.isNetworkError) {
      goOffline();
      return QUEUE;
    }
    throw error;
  }
}

/** An entry the sync isn't sending right now, so a newer change can be merged into it. */
const mergeable = (entry: OutboxEntry) => !entry.sending;

export async function addNote(body: NewNoteRequest): Promise<Note> {
  // Sent with every add, so an add retried after its reply was lost isn't saved twice.
  const clientId = crypto.randomUUID();
  const sent = await tryOnline(() =>
    api.addNote({ ...body, ...(body.parentId !== undefined && { parentId: resolve(body.parentId) }), clientId }),
  );
  if (sent !== QUEUE) return sent;

  const now = new Date().toISOString();
  let note: Note | undefined;
  await changePending((p) => {
    const tempId = p.nextTempId--;
    note = {
      id: tempId,
      ...titleAndDetails(body),
      ...(body.parentId !== undefined && { parentId: body.parentId }),
      createdDateTime: now,
      lastModifiedDateTime: now,
      tagIds: [...userTags(body.tagIds), LIFETIME_NEW],
      clientId,
    };
    // The time it was written is kept as its created time.
    p.outbox.push({ seq: p.nextSeq++, kind: "add", tempId, body: { ...body, clientId, createdDateTime: now } });
    p.latest[tempId] = note;
  });
  return note!;
}

export async function updateNote(id: number, body: NewNoteRequest): Promise<Note> {
  const sent = await tryOnline(() => api.updateNote(resolve(id), body));
  if (sent !== QUEUE) return sent;

  const base = localNote(id);
  if (!base) throw notAvailable("PUT", `/api/notes/${id}`);
  const noteId = resolve(id);
  const { titleText, titleImage, detailsText, detailsImage, ...rest } = base;
  void [titleText, titleImage, detailsText, detailsImage];
  const note: Note = {
    ...rest,
    ...titleAndDetails(body),
    // Editing keeps the note's Lifetime.
    tagIds: [...userTags(body.tagIds), lifetimeOf(base)],
    lastModifiedDateTime: new Date().toISOString(),
  };
  await changePending((p) => {
    const add = p.outbox.find((e) => e.kind === "add" && e.tempId === noteId && mergeable(e));
    const update = p.outbox.find((e) => e.kind === "update" && e.noteId === noteId && mergeable(e));
    if (add?.kind === "add") {
      // Not sent yet: send the note as it is now, keeping what only an add has.
      const { clientId, createdDateTime, parentId } = add.body;
      add.body = { ...body, clientId, createdDateTime, ...(parentId !== undefined && { parentId }) };
    } else if (update?.kind === "update") {
      // Only the latest version needs sending (e.g. long-form autosaves).
      update.body = body;
    } else {
      p.outbox.push({ seq: p.nextSeq++, kind: "update", noteId, body });
    }
    p.latest[noteId] = note;
  });
  return note;
}

export async function setLifetime(id: number, lifetime: LifetimeChange): Promise<Note> {
  const sent = await tryOnline(() => api.setLifetime(resolve(id), lifetime));
  if (sent !== QUEUE) return sent;

  const base = localNote(id);
  if (!base) throw notAvailable("PUT", `/api/notes/${id}/lifetime`);
  const noteId = resolve(id);
  const note: Note = {
    ...base,
    tagIds: [...userTags(base.tagIds), LIFETIME_CHANGES[lifetime]],
    lastModifiedDateTime: new Date().toISOString(),
  };
  await changePending((p) => {
    const earlier = p.outbox.find((e) => e.kind === "lifetime" && e.noteId === noteId && mergeable(e));
    if (earlier?.kind === "lifetime") earlier.lifetime = lifetime;
    else p.outbox.push({ seq: p.nextSeq++, kind: "lifetime", noteId, lifetime });
    p.latest[noteId] = note;
  });
  return note;
}

/** Deletes a note (cancelling a new long-form note). One created offline and not sent yet is just forgotten. */
export async function deleteNote(id: number): Promise<{ ok: true }> {
  const noteId = resolve(id);
  if (pending.outbox.some((e) => e.kind === "add" && e.tempId === noteId && mergeable(e))) {
    await changePending((p) => {
      p.outbox = p.outbox.filter((e) => (e.kind === "add" ? e.tempId : e.noteId) !== noteId);
      // Its child notes stay, without a parent (the server would refuse a parent that doesn't exist).
      for (const entry of p.outbox) {
        if (entry.kind === "add" && entry.body.parentId === noteId) {
          const { parentId, ...body } = entry.body;
          void parentId;
          entry.body = body as NewNoteRequest;
        }
      }
      for (const [key, note] of Object.entries(p.latest)) {
        if (note?.parentId === noteId) {
          const { parentId, ...rest } = note;
          void parentId;
          p.latest[Number(key)] = rest;
        }
      }
      delete p.latest[noteId];
    });
    return { ok: true };
  }

  const sent = await tryOnline(() => api.deleteNote(noteId));
  if (sent !== QUEUE) return sent;
  await changePending((p) => {
    // Its other waiting changes don't matter any more.
    p.outbox = p.outbox.filter((e) => e.kind === "add" || e.noteId !== noteId || e.sending);
    p.outbox.push({ seq: p.nextSeq++, kind: "delete", noteId });
    p.latest[noteId] = null;
  });
  return { ok: true };
}

// ---- Offline and back ------------------------------------------------------

let probeTimer: number | undefined;

/** The server couldn't be reached: start checking for it, and queue changes meanwhile. */
export function goOffline() {
  if (state.offline) return;
  publish({ offline: true });
  window.clearInterval(probeTimer);
  probeTimer = window.setInterval(() => void probe(), PROBE_MS);
}

/** The server answered: send anything waiting. */
export function markOnline() {
  if (state.offline) {
    window.clearInterval(probeTimer);
    probeTimer = undefined;
    publish({ offline: false });
  }
  if (pending.outbox.length > 0) void flush();
}

/** While offline, checks whether the server can be reached again. */
export async function probe(): Promise<void> {
  if (!state.offline) return;
  try {
    await api.ping();
    markOnline();
  } catch (error) {
    if (error instanceof ApiError && error.isUnauthorized) {
      // Reachable, but logged out: the outbox waits for the login.
      window.clearInterval(probeTimer);
      probeTimer = undefined;
      publish({ offline: false });
      handlers.onSessionExpired?.();
    }
  }
}

// The browser's own signals only prompt a check; the check decides.
window.addEventListener("online", () => void probe());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void probe();
});

// ---- Syncing ---------------------------------------------------------------

let flushing = false;

/** A short description of the note a change was for, for "changes lost" notices. */
function describe(entry: OutboxEntry): string {
  const note = localNote(entry.kind === "add" ? entry.tempId : entry.noteId);
  return note?.titleText ? `"${note.titleText}"` : "a handwritten note";
}

async function send(entry: OutboxEntry): Promise<Note | undefined> {
  switch (entry.kind) {
    case "add": {
      const { body } = entry;
      return api.addNote({ ...body, ...(body.parentId !== undefined && { parentId: resolve(body.parentId) }) });
    }
    case "update":
      await api.updateNote(resolve(entry.noteId), entry.body);
      return undefined;
    case "lifetime":
      await api.setLifetime(resolve(entry.noteId), entry.lifetime);
      return undefined;
    case "delete":
      try {
        await api.deleteNote(resolve(entry.noteId));
      } catch (error) {
        // Already gone (e.g. emptied from the Bin elsewhere): nothing was lost.
        if (!(error instanceof ApiError && error.status === 404)) throw error;
      }
      return undefined;
  }
}

/**
 * Sends the outbox in order, one entry at a time, then tells the app (which reloads everything).
 * A network or server failure stops it, to try again later; an entry the server rejects is dropped
 * and named in the notice; an expired session keeps everything for after the login. Only one tab
 * on a device sends at a time.
 */
export async function flush(): Promise<void> {
  if (flushing || state.offline) return;
  flushing = true;
  let saved = 0;
  const lost: string[] = [];
  try {
    await withLock("nwsnotes-sync", async () => {
      for (;;) {
        await reloadPending();
        const entry = pending.outbox[0];
        if (!entry || state.offline) break;
        // Marked, so changes made meanwhile aren't merged into what's already on its way.
        await changePending((p) => {
          const first = p.outbox.find((e) => e.seq === entry.seq);
          if (first) first.sending = true;
        });

        let outcome: "sent" | "dropped" | "stop" = "sent";
        let added: Note | undefined;
        try {
          added = await send(entry);
        } catch (error) {
          if (error instanceof ApiError && error.isNetworkError) {
            goOffline();
            outcome = "stop";
          } else if (error instanceof ApiError && error.isUnauthorized) {
            handlers.onSessionExpired?.();
            outcome = "stop";
          } else if (error instanceof ApiError && error.status !== undefined && error.status < 500) {
            lost.push(describe(entry));
            outcome = "dropped";
          } else {
            outcome = "stop";
          }
        }

        if (outcome === "stop") {
          await changePending((p) => {
            const first = p.outbox.find((e) => e.seq === entry.seq);
            if (first) delete first.sending;
          });
          break;
        }
        await changePending((p) => {
          p.outbox = p.outbox.filter((e) => e.seq !== entry.seq);
          if (entry.kind !== "add") return;
          if (outcome === "dropped") {
            // A note the server wouldn't create: its later changes can't be sent either.
            p.outbox = p.outbox.filter((e) => (e.kind === "add" ? e.tempId : e.noteId) !== entry.tempId);
            delete p.latest[entry.tempId];
            return;
          }
          // The note now has its real id: everything waiting moves over to it.
          const realId = added!.id;
          p.idMap[entry.tempId] = realId;
          const local = p.latest[entry.tempId];
          delete p.latest[entry.tempId];
          if (local) p.latest[realId] = { ...local, id: realId };
          for (const [key, note] of Object.entries(p.latest)) {
            if (note?.parentId === entry.tempId) p.latest[Number(key)] = { ...note, parentId: realId };
          }
        });
        if (outcome === "sent") saved++;
        if (entry.kind === "add" && added) handlers.onRemapped?.(entry.tempId, added);
      }
    });
  } finally {
    flushing = false;
  }
  if (saved > 0 || lost.length > 0) handlers.onSynced?.(saved, lost);
}

/** The note changes, made online or queued while offline; used like `api`. */
export const offlineApi = { addNote, updateNote, setLifetime, deleteNote };
