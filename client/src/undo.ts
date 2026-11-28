import { useEffect, useState } from "react";
import type { MadeChange } from "@nwsnotes/shared";
import { changesMadeBy, pageUser } from "./api";

/*
 * The Undo button (see Specs/undo.md): the latest change made to notes on this page, which the header
 * offers to undo for 5 minutes. After Undo it offers Redo (for 5 minutes from the undo), and so on; going
 * back further is done in History. Kept for this browser tab only (sessionStorage), so it survives a reload.
 */

/** How long the button stays after a change (or after an Undo or Redo). */
export const UNDO_WINDOW_MS = 5 * 60 * 1000;

export interface UndoOffer {
  /** What the button does. */
  mode: "undo" | "redo";
  /** The History changes it would undo: the change itself, or the Undo (or Redo) that undid it. */
  changes: MadeChange[];
  /** What was changed, for the button's tooltip and the message afterwards, e.g. `Archived "Buy milk"`. */
  label: string;
  /** When the change, Undo or Redo was made (ms): the button goes UNDO_WINDOW_MS later. */
  at: number;
  /** Whose notes: the button only shows for that user. */
  userId: number;
  /** Set for a long-form note's add and autosaves: cancelling that new note takes the offer away. */
  longFormNoteId?: number;
}

const KEY = "nwsnotes.undo";
/** Sent on the window when the offer changes, so every place showing it updates. */
const CHANGED = "nwsnotes-undo-changed";

function read(): UndoOffer | undefined {
  try {
    const stored = window.sessionStorage.getItem(KEY);
    return stored ? (JSON.parse(stored) as UndoOffer) : undefined;
  } catch {
    return memory;
  }
}

/** Used when storage is unavailable (e.g. blocked site data): the offer lasts until the page is reloaded. */
let memory: UndoOffer | undefined;

function write(offer: UndoOffer | undefined) {
  memory = offer;
  try {
    if (offer) window.sessionStorage.setItem(KEY, JSON.stringify(offer));
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // See `memory`.
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** Sets what the button offers (Undo, or Redo after an Undo), from now. */
export function setUndoOffer(offer: Omit<UndoOffer, "at" | "userId">) {
  const userId = pageUser();
  if (userId === undefined || offer.changes.length === 0) return;
  write({ ...offer, at: Date.now(), userId });
}

/**
 * After a change to notes made on the notes page: offers to undo it, if its reply came straight from the
 * server (a change queued offline can't be undone this way). Anything else leaves the offer as it was.
 */
export function offerUndo(result: unknown, options: { longFormNoteId?: number } = {}) {
  const changes = changesMadeBy(result);
  if (!changes || changes.length === 0) return;
  setUndoOffer({ mode: "undo", changes, label: changes[0]!.summary, ...options });
}

/**
 * Adds a follow-on change to the Undo offered for `first` (e.g. the order saved after a note added at the
 * top), so one Undo takes back both. Does nothing if something else is offered by now.
 */
export function extendUndo(first: unknown, then: unknown) {
  const firstChanges = changesMadeBy(first);
  const more = changesMadeBy(then);
  const offer = read();
  if (!firstChanges || !more || !offer || offer.mode !== "undo") return;
  if (offer.changes.map((change) => change.id).join() !== firstChanges.map((change) => change.id).join()) return;
  write({ ...offer, changes: [...offer.changes, ...more] });
}

/** A new long-form note was cancelled (and deleted): an offer to undo its add or edits goes. */
export function forgetUndoFor(longFormNoteId: number) {
  if (read()?.longFormNoteId === longFormNoteId) write(undefined);
}

/** Takes the offer away (e.g. it can't be undone any more). */
export function clearUndo() {
  write(undefined);
}

/** The current offer for this page's user, while it lasts (it goes by itself after UNDO_WINDOW_MS). */
export function useUndoOffer(): UndoOffer | undefined {
  const [offer, setOffer] = useState(read);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const changed = () => {
      setOffer(read());
      setNow(Date.now());
    };
    window.addEventListener(CHANGED, changed);
    return () => window.removeEventListener(CHANGED, changed);
  }, []);

  // Re-renders as the offer runs out.
  const ends = offer ? offer.at + UNDO_WINDOW_MS : undefined;
  useEffect(() => {
    if (ends === undefined) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, ends - Date.now()) + 50);
    return () => window.clearTimeout(timer);
  }, [ends, now]);

  if (!offer || ends === undefined || now >= ends || offer.userId !== pageUser()) return undefined;
  return offer;
}
