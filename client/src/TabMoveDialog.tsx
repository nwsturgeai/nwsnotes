import { useEffect, useRef, useState } from "react";
import { tagLabel, type Category, type TabMoveChange } from "@nwsnotes/shared";

/** The dialog closes by itself after this long, as if OK had been clicked. */
const AUTO_OK_SECONDS = 3;
/** Ticking "Auto-accept…" skips the dialog in this window for this long. */
const AUTO_ACCEPT_MS = 5 * 60 * 1000;
const AUTO_ACCEPT_KEY = "nwsnotes.autoAcceptTabMovesUntil";

/** Whether note-to-tab drags are being accepted without the dialog in this window (browser tab). */
export function autoAcceptingTabMoves(): boolean {
  try {
    return Number(window.sessionStorage.getItem(AUTO_ACCEPT_KEY)) > Date.now();
  } catch {
    return false;
  }
}

function startAutoAccepting() {
  try {
    window.sessionStorage.setItem(AUTO_ACCEPT_KEY, String(Date.now() + AUTO_ACCEPT_MS));
  } catch {
    // Without storage, the dialog keeps showing.
  }
}

/** One category's change as a line, e.g. "Context: Work → (none)". */
export function describeTabMoveChange(change: TabMoveChange, categories: Category[]): string {
  const category = categories.find((c) => c.id === change.categoryId);
  const names = (ids: number[]) =>
    ids.length === 0 ? "(none)" : ids.map((id) => category?.tags.find((tag) => tag.id === id)).map((tag) => (tag ? tagLabel(tag) : "?")).join(", ");
  return `${category?.name ?? "?"}: ${names(change.removed)} → ${names(change.added)}`;
}

/**
 * Asks before a note dragged onto a tab gets that tab's tags: lists what changes, with OK and Cancel.
 * After 3 seconds it closes as if OK had been clicked. Escape, or clicking outside, is Cancel.
 */
export function TabMoveDialog({
  tabName,
  changes,
  categories,
  onConfirm,
  onCancel,
}: {
  tabName: string;
  changes: TabMoveChange[];
  categories: Category[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [secondsLeft, setSecondsLeft] = useState(AUTO_OK_SECONDS);
  const [autoAccept, setAutoAccept] = useState(false);
  const autoAcceptRef = useRef(autoAccept);
  autoAcceptRef.current = autoAccept;
  const done = useRef(false);

  function confirm() {
    if (done.current) return;
    done.current = true;
    if (autoAcceptRef.current) startAutoAccepting();
    onConfirm();
  }

  function cancel() {
    if (done.current) return;
    done.current = true;
    onCancel();
  }

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    if (secondsLeft <= 0) {
      confirm();
      return;
    }
    const timer = window.setTimeout(() => setSecondsLeft(secondsLeft - 1), 1000);
    return () => window.clearTimeout(timer);
  });

  return (
    <dialog
      ref={ref}
      className="confirm-dialog tab-move-dialog"
      aria-label={`Move to "${tabName}"`}
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
      // A click on the backdrop lands on the dialog element itself.
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
          if (!inside) cancel();
        }
      }}
    >
      <p>{`Move the note to "${tabName}"? Its tags will change:`}</p>
      <ul className="tab-move-changes">
        {changes.map((change) => (
          <li key={change.categoryId}>{describeTabMoveChange(change, categories)}</li>
        ))}
      </ul>
      <label className="tab-move-auto">
        <input type="checkbox" checked={autoAccept} onChange={(event) => setAutoAccept(event.target.checked)} />
        Auto-accept note-to-tab drags in this window for the next 5 minutes?
      </label>
      <div className="form-buttons">
        <button type="button" className="button primary" onClick={confirm} autoFocus>
          {`OK (${secondsLeft})`}
        </button>
        <button type="button" className="button" onClick={cancel}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
