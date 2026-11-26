import { useSyncExternalStore } from "react";
import {
  isLifetimeTag,
  lifetimeOf,
  LIFETIME_CHANGES,
  LIFETIME_NEW,
  sameTags,
  withoutMarkers,
  type LifetimeChange,
  type NewNoteRequest,
  type Note,
  type Me,
  type NotesData,
} from "@nwsnotes/shared";
import { ApiError, api, setPageUser } from "./api";
import { idbAvailable, idbDelete, idbGet, idbSet } from "./offlineStore";

/*
 * Offline use. The notes page and the long-form editor add, edit, archive (etc.) and delete notes
 * through the functions here rather than `api` directly. Online, they go straight to the server.
 * Offline (the server couldn't be reached), or while earlier offline changes are still waiting,
 * they go into an outbox kept in IndexedDB and are applied to the local copy straight away. When the
 * server answers again the outbox is sent in order, one entry at a time.
 *
 * Notes created offline get a temporary negative id (-1001, -1002, ...) until their add is sent;
 * the real id then replaces it everywhere, and later changes made with the temporary id still work.
 *
 * A change that alters a note's tags carries the time it was made (tagsChangedDateTime), so the
 * server records when the tags changed rather than when the change reached it.
 *
 * The offline copy and the outbox are kept under the logged-in user's id, so two people using the same
 * device never see each other's notes. Logging out clears that user's.
 *
 * Tabs in one browser share the outbox. Each tab re-reads it before deciding whether a change can go
 * straight to the server, so a change never overtakes one another tab queued earlier, and tells the
 * others (a BroadcastChannel) whenever it changes it, so they show those changes too and, if they can
 * reach the server, send them. Logging out in one tab logs the others out as well.
 */

type OutboxEntry = { seq: number; sending?: boolean } & (
  | { kind: "add"; tempId: number; body: NewNoteRequest }
  | { kind: "update"; noteId: number; body: NewNoteRequest }
  | { kind: "lifetime"; noteId: number; lifetime: LifetimeChange; tagsChangedDateTime?: string }
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

/** Who was last logged in here, so the app can open offline from their copy. */
const USER_KEY = "nwsnotes.user";
const FIRST_TEMP_ID = -1001;
/** While offline, how often to check whether the server can be reached again. */
const PROBE_MS = 15_000;

const emptyPending = (): Pending => ({ outbox: [], latest: {}, idMap: {}, nextTempId: FIRST_TEMP_ID, nextSeq: 1 });

let pending: Pending = emptyPending();
/** Whose copy and outbox these are; undefined until the app knows who is logged in. */
let userId: number | undefined;
const pendingKey = (id: number) => `pending:${id}`;
const dataKey = (id: number) => `data:${id}`;
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
let probeTimer: number | undefined;

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
  /** Another tab changed the waiting changes: lay them over what's shown (withPending). */
  onPendingChanged: () => void;
  /** Another tab logged this user out. */
  onLoggedOut: () => void;
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
  const id = userId;
  if (id === undefined) return;
  const stored = await idbGet<Pending>(pendingKey(id));
  if (userId !== id) return;
  if (stored) pending = stored;
  // None stored: everything was sent, or this user logged out in another tab. (Without IndexedDB the
  // outbox only lives here, in this tab, so it's kept.)
  else if (await idbAvailable()) pending = emptyPending();
}

// ---- Other tabs ------------------------------------------------------------

type TabMessage = { type: "pending-changed" | "logged-out"; userId: number };

const channel = typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel("nwsnotes-offline");

function tellOtherTabs(message: TabMessage) {
  try {
    channel?.postMessage(message);
  } catch {
    // The other tabs still catch up when they next touch the outbox, or reload.
  }
}

if (channel) {
  channel.onmessage = (event: MessageEvent<Partial<TabMessage>>) => {
    const message = event.data;
    if (userId === undefined || message.userId !== userId) return;
    if (message.type === "logged-out") {
      forgetUser();
      handlers.onLoggedOut?.();
    } else if (message.type === "pending-changed") {
      void (async () => {
        await reloadPending();
        publish();
        handlers.onPendingChanged?.();
        // The tab that queued them may be the only one that thinks it's offline.
        if (pending.outbox.length > 0) void flush();
      })();
    }
  };
}

/** Changes the waiting changes and stores them, one tab at a time. */
async function changePending(change: (p: Pending) => void): Promise<void> {
  const id = userId;
  if (id === undefined) return;
  await withLock("nwsnotes-outbox", async () => {
    await reloadPending();
    change(pending);
    // Notes no change refers to any more drop out of `latest`; the reloaded data is right for them.
    const referenced = new Set(pending.outbox.map((entry) => resolve(entry.kind === "add" ? entry.tempId : entry.noteId)));
    for (const id of Object.keys(pending.latest).map(Number)) if (!referenced.has(id)) delete pending.latest[id];
    await idbSet(pendingKey(id), pending);
  });
  tellOtherTabs({ type: "pending-changed", userId: id });
  publish();
}

/** Who is logged in (when the app starts, or after logging in): loads their waiting changes. */
export async function setOfflineUser(me: Me): Promise<void> {
  if (userId !== me.id) {
    window.clearTimeout(saveTimer);
    userId = me.id;
    pending = emptyPending();
    data = undefined;
  }
  setPageUser(me.id);
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(me));
  } catch {
    // Without local storage, the app just can't open offline before it has reached the server.
  }
  await reloadPending();
  publish();
}

/** The user last logged in on this device, for opening the app offline. */
export function savedUser(): Me | undefined {
  try {
    const text = localStorage.getItem(USER_KEY);
    return text ? (JSON.parse(text) as Me) : undefined;
  } catch {
    return undefined;
  }
}

/** This tab stops showing anyone: forgets the user, and what it held of their changes. */
function forgetUser() {
  window.clearTimeout(saveTimer);
  window.clearInterval(probeTimer);
  probeTimer = undefined;
  userId = undefined;
  setPageUser(undefined);
  pending = emptyPending();
  data = undefined;
  publish({ offline: false });
}

/** Logging out: this user's offline copy and waiting changes are removed from this device, and their other tabs log out too. */
export async function clearOfflineUser(): Promise<void> {
  const id = userId;
  forgetUser();
  try {
    localStorage.removeItem(USER_KEY);
  } catch {
    // Nothing to remove.
  }
  if (id !== undefined) {
    await withLock("nwsnotes-outbox", async () => {
      await idbDelete(pendingKey(id));
      await idbDelete(dataKey(id));
    });
    tellOtherTabs({ type: "logged-out", userId: id });
  }
}

let saveTimer: number | undefined;

/** The data the app is now showing: kept for building offline changes, and saved for opening offline. */
export function rememberData(next: NotesData) {
  const id = userId;
  if (id === undefined) return;
  data = next;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void idbSet(dataKey(id), next), 500);
}

/** The data saved on this device for the user, for opening the app while offline. */
export function savedData(): Promise<NotesData | undefined> {
  return userId === undefined ? Promise.resolve(undefined) : idbGet<NotesData>(dataKey(userId));
}

/**
 * Data from the server (or what's shown) with the changes still waiting laid over it, so they don't
 * vanish on a reload. A note with a temporary id whose add was sent gets its real id; one that's no longer
 * waiting otherwise was forgotten (a long-form note cancelled offline) or refused by the server, so it goes.
 */
export function withPending(server: NotesData): NotesData {
  const latest = pending.latest;
  const ids = new Set(server.notes.map((note) => note.id));
  const notes = server.notes
    // A note created offline whose add has been sent (maybe by another tab) takes its real id.
    .map((note) => {
      const id = note.id < 0 ? pending.idMap[note.id] : undefined;
      const parentId = note.parentId !== undefined && note.parentId < 0 ? pending.idMap[note.parentId] : undefined;
      return id === undefined && parentId === undefined ? note : { ...note, ...(id !== undefined && { id }), ...(parentId !== undefined && { parentId }) };
    })
    .filter((note, index) => !(server.notes[index]!.id < 0 && note.id > 0 && ids.has(note.id)))
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

/** The parts of a note an add or edit sets: title, details and due date (left out: none). */
function titleAndDetails(body: NewNoteRequest): Partial<Note> {
  return {
    ...(body.titleText !== undefined ? { titleText: body.titleText } : { titleImage: body.titleImage }),
    ...(body.detailsText !== undefined
      ? { detailsText: body.detailsText }
      : body.detailsImage !== undefined
        ? { detailsImage: body.detailsImage, ...(body.detailsMorePages?.length && { detailsMorePages: body.detailsMorePages }) }
        : {}),
    ...(body.dueDateTime !== undefined && { dueDateTime: body.dueDateTime }),
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
  // Another tab may have queued changes this one hasn't heard about yet; this one mustn't overtake them.
  await reloadPending();
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

/** A change just went into the outbox: if this tab can reach the server, it goes out behind the others. */
function queued() {
  if (!state.offline) void flush();
}

/** Whether a note has changes waiting in the outbox (so the version this tab shows isn't the server's yet). */
export function isWaiting(id: number): boolean {
  return pending.latest[resolve(id)] !== undefined;
}

/** An entry the sync isn't sending right now, so a newer change can be merged into it. */
const mergeable = (entry: OutboxEntry) => !entry.sending;

/** An edit with its parent's temporary id (a long-form note created offline) replaced by the real one once known. */
function withParentResolved(body: NewNoteRequest): NewNoteRequest {
  return typeof body.parentId === "number" ? { ...body, parentId: resolve(body.parentId) } : body;
}

export async function addNote(body: NewNoteRequest): Promise<Note> {
  // Sent with every add, so an add retried after its reply was lost isn't saved twice.
  const clientId = crypto.randomUUID();
  const sent = await tryOnline(() =>
    api.addNote({ ...withParentResolved(body), clientId }),
  );
  if (sent !== QUEUE) return sent;

  const now = new Date().toISOString();
  let note: Note | undefined;
  await changePending((p) => {
    const tempId = p.nextTempId--;
    note = {
      id: tempId,
      ...titleAndDetails(body),
      ...(typeof body.parentId === "number" && { parentId: body.parentId }),
      createdDateTime: now,
      lastModifiedDateTime: now,
      tagsChangedDateTime: now,
      tagIds: [...userTags(body.tagIds), LIFETIME_NEW],
      clientId,
    };
    // The time it was written is kept as its created time.
    p.outbox.push({ seq: p.nextSeq++, kind: "add", tempId, body: { ...body, clientId, createdDateTime: now } });
    p.latest[tempId] = note;
  });
  queued();
  return note!;
}

/**
 * Edits a note. `startedFrom`: its lastModifiedDateTime when the edit started; online, the edit is refused
 * (ApiError.isNoteChanged) if the note has changed since. A queued edit is sent without it, as before:
 * an offline change replaces any made elsewhere meanwhile, rather than being lost when it's sent.
 */
export async function updateNote(id: number, body: NewNoteRequest, startedFrom?: string): Promise<Note> {
  const sent = await tryOnline(() => api.updateNote(resolve(id), withParentResolved(body), startedFrom));
  if (sent !== QUEUE) return sent;

  const base = localNote(id);
  if (!base) throw notAvailable("PUT", `/api/notes/${id}`);
  const noteId = resolve(id);
  const { titleText, titleImage, detailsText, detailsImage, detailsMorePages, dueDateTime, parentId: oldParent, ...rest } = base;
  void [titleText, titleImage, detailsText, detailsImage, detailsMorePages, dueDateTime];
  // A parent id sets it, null takes it away, and leaving it out keeps the one it has.
  const parentId = body.parentId === undefined ? oldParent : (body.parentId ?? undefined);
  const now = new Date().toISOString();
  // Editing keeps the note's Lifetime.
  const tagIds = [...userTags(body.tagIds), lifetimeOf(base)];
  const tagsChanged = !sameTags(base.tagIds, tagIds);
  const note: Note = {
    ...rest,
    ...titleAndDetails(body),
    ...(parentId !== undefined && { parentId }),
    tagIds,
    lastModifiedDateTime: now,
    tagsChangedDateTime: tagsChanged ? now : base.tagsChangedDateTime,
  };
  /** The time to send: this edit's if it changed the tags, otherwise that of the change it's merged into. */
  const tagsTime = (earlier: NewNoteRequest | undefined) =>
    tagsChanged ? { tagsChangedDateTime: now } : earlier?.tagsChangedDateTime ? { tagsChangedDateTime: earlier.tagsChangedDateTime } : {};
  await changePending((p) => {
    const add = p.outbox.find((e) => e.kind === "add" && e.tempId === noteId && mergeable(e));
    const update = p.outbox.find((e) => e.kind === "update" && e.noteId === noteId && mergeable(e));
    if (add?.kind === "add") {
      // Not sent yet: send the note as it is now, keeping what only an add has (and its parent, unless changed).
      const { clientId, createdDateTime } = add.body;
      const { parentId: _parent, ...fields } = body;
      add.body = { ...fields, ...tagsTime(add.body), clientId, createdDateTime, ...(parentId !== undefined && { parentId }) };
    } else if (update?.kind === "update") {
      // Only the latest version needs sending (e.g. long-form autosaves), with a parent change it made kept.
      const keptParent = body.parentId === undefined && update.body.parentId !== undefined ? { parentId: update.body.parentId } : {};
      update.body = { ...body, ...keptParent, ...tagsTime(update.body) };
    } else {
      p.outbox.push({ seq: p.nextSeq++, kind: "update", noteId, body: { ...body, ...tagsTime(undefined) } });
    }
    p.latest[noteId] = note;
  });
  queued();
  return note;
}

export async function setLifetime(id: number, lifetime: LifetimeChange): Promise<Note> {
  const sent = await tryOnline(() => api.setLifetime(resolve(id), lifetime));
  if (sent !== QUEUE) return sent;

  const base = localNote(id);
  if (!base) throw notAvailable("PUT", `/api/notes/${id}/lifetime`);
  const noteId = resolve(id);
  const now = new Date().toISOString();
  const tagsChanged = lifetimeOf(base) !== LIFETIME_CHANGES[lifetime];
  const note: Note = {
    ...base,
    tagIds: [...userTags(base.tagIds), LIFETIME_CHANGES[lifetime]],
    lastModifiedDateTime: now,
    tagsChangedDateTime: tagsChanged ? now : base.tagsChangedDateTime,
  };
  await changePending((p) => {
    const earlier = p.outbox.find((e) => e.kind === "lifetime" && e.noteId === noteId && mergeable(e));
    if (earlier?.kind === "lifetime") {
      earlier.lifetime = lifetime;
      if (tagsChanged) earlier.tagsChangedDateTime = now;
    } else {
      p.outbox.push({ seq: p.nextSeq++, kind: "lifetime", noteId, lifetime, ...(tagsChanged && { tagsChangedDateTime: now }) });
    }
    p.latest[noteId] = note;
  });
  queued();
  return note;
}

/** Deletes a note (cancelling a new long-form note). One created offline and not sent yet is just forgotten. */
export async function deleteNote(id: number): Promise<{ ok: true }> {
  await reloadPending();
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
        // An edit that moved a note into it takes the note out of its parent instead.
        if (entry.kind === "update" && entry.body.parentId === noteId) entry.body = { ...entry.body, parentId: null };
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
  queued();
  return { ok: true };
}

// ---- Offline and back ------------------------------------------------------

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
  return note?.titleText ? `"${withoutMarkers(note.titleText)}"` : "a handwritten note";
}

async function send(entry: OutboxEntry): Promise<Note | undefined> {
  switch (entry.kind) {
    case "add": {
      const { body } = entry;
      return api.addNote(withParentResolved(body));
    }
    case "update":
      await api.updateNote(resolve(entry.noteId), withParentResolved(entry.body));
      return undefined;
    case "lifetime":
      await api.setLifetime(resolve(entry.noteId), entry.lifetime, entry.tagsChangedDateTime);
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
