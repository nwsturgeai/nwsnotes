import { useEffect, useRef, useState } from "react";

interface Props {
  /** The note's current due date (ISO), if it has one. */
  dueDate: string | undefined;
  /** A new due date (ISO), or undefined for "Clear Due Date". */
  onSet: (dueDate: string | undefined) => void;
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
export function DueDateDialog({ dueDate, onSet, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const start = dueDate ? new Date(dueDate) : defaultDueDate();
  // The pickers work in local time: "2026-11-09" and "20:00".
  const [day, setDay] = useState(`${start.getFullYear()}-${two(start.getMonth() + 1)}-${two(start.getDate())}`);
  const [time, setTime] = useState(`${two(start.getHours())}:${two(start.getMinutes())}`);

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
      <div className="form-buttons">
        <button type="button" className="button primary" disabled={!valid} onClick={() => onSet(chosen.toISOString())} autoFocus>
          Set Due Date
        </button>
        {dueDate && (
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
