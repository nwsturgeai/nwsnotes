import { useEffect, useRef, useState } from "react";
import type { Note } from "@nwsnotes/shared";

/** A note's due date (ISO), and whether it has no reminder ("Remind me?" unticked). */
export interface Due {
  dueDateTime: string;
  noReminder?: true;
}

/** A note's due date, if it has one. */
export function dueOf(note: Note | undefined): Due | undefined {
  if (note?.dueDateTime === undefined) return undefined;
  return { dueDateTime: note.dueDateTime, ...(note.noReminder && { noReminder: true as const }) };
}

/** A due date's part of an add or edit (nothing for none, which clears it). */
export function dueRequest(due: Due | undefined): { dueDateTime?: string; noReminder?: boolean } {
  return due ? { dueDateTime: due.dueDateTime, ...(due.noReminder && { noReminder: true }) } : {};
}

/** Whether two due dates are the same, reminder included. */
export function sameDue(a: Due | undefined, b: Due | undefined): boolean {
  return a?.dueDateTime === b?.dueDateTime && (a?.noReminder === true) === (b?.noReminder === true);
}

/** A due date's tooltip, e.g. "Due 12/11 20:00", or "Due 12/11 20:00 (no reminder)". */
export function dueTitle(due: Due, allDay = false): string {
  return `Due ${formatNoteDate(due.dueDateTime, allDay)}${due.noReminder ? " (no reminder)" : ""}`;
}

/** This device's last "Remind me?" choice for a new note's due date: "off" when it was unticked. */
const NEW_NOTE_REMIND_KEY = "nwsnotes.newNoteRemind";

function rememberedRemind(): boolean {
  try {
    return localStorage.getItem(NEW_NOTE_REMIND_KEY) !== "off";
  } catch {
    return true;
  }
}

function rememberRemind(remind: boolean) {
  try {
    if (remind) localStorage.removeItem(NEW_NOTE_REMIND_KEY);
    else localStorage.setItem(NEW_NOTE_REMIND_KEY, "off");
  } catch {
    // Not remembered (storage blocked): next time starts ticked.
  }
}

interface Props {
  /** The note's current due date, if it has one. */
  due: Due | undefined;
  /**
   * For a note being added: with no due date yet, "Remind me?" starts as it was last set for a new note on
   * this device, and the choice made here is remembered for the next one.
   */
  newNote?: boolean;
  /** A new due date, or undefined for "Clear Due Date". */
  onSet: (due: Due | undefined) => void;
  onCancel: () => void;
}

const two = (n: number) => String(n).padStart(2, "0");

/** With no due date yet: 20:00 today, or tomorrow if it's already 20:00 or later. */
function defaultDueDate(): Date {
  const date = new Date();
  if (date.getHours() >= 20) date.setDate(date.getDate() + 1);
  date.setHours(20, 0, 0, 0);
  return date;
}

/** The app's own pop-up for choosing a note's due date, with the device's date and time pickers. */
export function DueDateDialog({ due, newNote = false, onSet, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const start = due ? new Date(due.dueDateTime) : defaultDueDate();
  // The pickers work in local time: "2026-11-09" and "20:00".
  const [day, setDay] = useState(`${start.getFullYear()}-${two(start.getMonth() + 1)}-${two(start.getDate())}`);
  const [time, setTime] = useState(`${two(start.getHours())}:${two(start.getMinutes())}`);
  // As the note has it; for a new due date ticked, or for a note being added as last time on this device.
  const [remind, setRemind] = useState(() => (due ? due.noReminder !== true : !newNote || rememberedRemind()));

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  // A date and time typed in local time; invalid while either box is empty or half-filled.
  const chosen = new Date(`${day}T${time}`);
  const valid = day !== "" && time !== "" && !Number.isNaN(chosen.getTime());

  return (
    <dialog
      ref={ref}
      className="confirm-dialog due-date-dialog"
      aria-labelledby="due-date-title"
      // Escape (or the browser's own close) counts as Cancel.
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <p id="due-date-title" className="due-date-title">
        Due date
      </p>
      <div className="due-date-fields">
        <input type="date" aria-label="Due date" value={day} onChange={(event) => setDay(event.target.value)} />
        <input type="time" aria-label="Due time" value={time} onChange={(event) => setTime(event.target.value)} />
      </div>
      <label className="due-date-remind">
        <input type="checkbox" checked={remind} onChange={(event) => setRemind(event.target.checked)} />
        Remind me?
      </label>
      <div className="form-buttons">
        <button
          type="button"
          className="button primary"
          disabled={!valid}
          onClick={() => {
            if (newNote) rememberRemind(remind);
            onSet({ dueDateTime: chosen.toISOString(), ...(!remind && { noReminder: true as const }) });
          }}
          autoFocus
        >
          Set Due Date
        </button>
        {due && (
          <button type="button" className="button" onClick={() => onSet(undefined)}>
            Clear Due Date
          </button>
        )}
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}

/**
 * A note's creation or due time in the device's local time, as "dd/MM HH:mm" (e.g. "26/10 14:05"),
 * with the year as "dd/MM/yy" when it isn't this year (e.g. "12/01/27 20:00").
 */
export function formatNoteDate(iso: string, allDay = false): string {
  const date = new Date(iso);
  const year = date.getFullYear() === new Date().getFullYear() ? "" : `/${two(date.getFullYear() % 100)}`;
  // An all-day note (from Google Calendar) shows "all day" in place of its 20:00.
  const time = allDay ? "all day" : `${two(date.getHours())}:${two(date.getMinutes())}`;
  return `${two(date.getDate())}/${two(date.getMonth() + 1)}${year} ${time}`;
}
