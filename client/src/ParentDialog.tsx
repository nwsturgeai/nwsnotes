import { useEffect, useMemo, useRef, useState } from "react";
import { descendantIds, withoutMarkers, type Note } from "@nwsnotes/shared";
import { longFormTree, possibleParents, shortTitle } from "./parents";

interface PillProps {
  /** Every note the user can see, to find the parent's title. */
  notes: Note[];
  parentId: number | undefined;
  disabled?: boolean;
  onClick: () => void;
}

/**
 * The "Parent" line's pill, when adding or editing a note: the parent's title (cut short, as on the
 * note's own pill in the list), or "(none)". Tapping it opens the Parent pop-up.
 */
export function ParentPill({ notes, parentId, disabled, onClick }: PillProps) {
  const parent = parentId === undefined ? undefined : notes.find((note) => note.id === parentId);
  const text = parent ? shortTitle(parent, 20) : "(none)";
  return (
    <button
      type="button"
      className="tag-pill parent-pill"
      aria-label={`Parent: ${parent ? withoutMarkers(parent.titleText ?? "") : "none"}. Change the parent note`}
      title={parent ? `${withoutMarkers(parent.titleText ?? "")} (tap to change the parent note)` : "Choose a parent note"}
      disabled={disabled}
      onClick={onClick}
    >
      {text}
    </button>
  );
}

interface Props {
  /** Every note the user can see. */
  notes: Note[];
  /** The shared note order, for listing the long-form notes in the same order as the list. */
  noteOrder: number[];
  /** The note's parent now. */
  parentId: number | undefined;
  /** The note being edited (it and the notes under it can't be its parent), or undefined for a new note. */
  childId?: number;
  /**
   * Whose notebook the note is in: a note shared with you is its owner's, and so is a new note with their
   * shared tags. Undefined for your own. A parent must be in the same notebook.
   */
  owner: { id: number; name: string } | undefined;
  /** The chosen parent, or undefined for none. */
  onSet: (parentId: number | undefined) => void;
  onCancel: () => void;
}

/**
 * The app's own pop-up for setting, changing or removing a note's parent: every long-form note that isn't
 * in the Bin, as a tree (each one's long-form child notes indented under it), with at most one ticked.
 */
export function ParentDialog({ notes, noteOrder, parentId, childId, owner, onSet, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [chosen, setChosen] = useState(parentId);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const tree = useMemo(() => longFormTree(possibleParents(notes), noteOrder), [notes, noteOrder]);
  /** The note itself and everything under it: choosing one of them would make a loop. */
  const inside = useMemo(() => (childId === undefined ? new Set<number>() : new Set([childId, ...descendantIds(notes, childId)])), [notes, childId]);

  /** Why a note can't be the parent, if it can't. */
  function unavailable(note: Note): string | undefined {
    if (inside.has(note.id)) return note.id === childId ? "A note can't be its own parent" : "This note is inside the note being changed";
    const noteOwner = note.shared?.ownerId;
    if (noteOwner !== owner?.id) {
      return note.shared
        ? `This is ${note.shared.ownerName}'s note: a note's parent must belong to the same person`
        : `This is your note, and the note being changed is ${owner?.name ?? "someone else"}'s: a note's parent must belong to the same person`;
    }
    return undefined;
  }

  return (
    <dialog
      ref={ref}
      className="confirm-dialog parent-dialog"
      aria-labelledby="parent-dialog-title"
      // Escape (or the browser's own close) counts as Cancel.
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <p id="parent-dialog-title" className="due-date-title">
        Parent note
      </p>
      {tree.length === 0 ? (
        <p className="parent-dialog-empty">There are no long-form notes to choose from.</p>
      ) : (
        <div className="parent-dialog-list" role="group" aria-label="Long-form notes">
          {tree.map(({ note, depth }) => {
            const why = unavailable(note);
            return (
              <label
                key={note.id}
                className={why ? "unavailable" : undefined}
                title={why ?? withoutMarkers(note.titleText ?? "")}
                style={depth > 0 ? { paddingLeft: `${0.5 + depth * 1.25}rem` } : undefined}
              >
                <input
                  type="checkbox"
                  checked={chosen === note.id}
                  disabled={why !== undefined}
                  onChange={(event) => setChosen(event.target.checked ? note.id : undefined)}
                />
                <span className="parent-dialog-title">
                  {withoutMarkers(note.titleText ?? "")}
                  {note.shared && <span className="parent-dialog-owner"> ({note.shared.ownerName})</span>}
                </span>
              </label>
            );
          })}
        </div>
      )}
      <div className="form-buttons">
        <button type="button" className="button primary" onClick={() => onSet(chosen)} autoFocus>
          Set Parent
        </button>
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
