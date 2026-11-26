import { useEffect, useMemo, useRef, useState } from "react";
import {
  descendantIds,
  lifetimeOf,
  LIFETIME_ARCHIVED,
  LIFETIME_WAITING,
  noteMatchesFilters,
  withoutMarkers,
  type Category,
  type Note,
} from "@nwsnotes/shared";
import { useCollapsedCategories } from "./extraFilters";
import { longFormTree, possibleParents, shortTitle } from "./parents";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBoxArchive, faCaretDown, faCaretRight, faChevronDown, faChevronRight, faHourglass } from "@fortawesome/free-solid-svg-icons";
import { useParentSort, useParentTagSelection, useParentTagsOpen } from "./stylusMode";
import { MixedTagPicker, selectionToFilters } from "./TagPickers";

/** Titles in alphabetical order, ignoring case and formatting markers, with numbers in number order ("2" before "10"). */
const byTitle = (a: Note, b: Note) =>
  withoutMarkers(a.titleText ?? "").localeCompare(withoutMarkers(b.titleText ?? ""), undefined, { sensitivity: "base", numeric: true });

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
  /** The user's categories (not Lifetime), for filtering the list by tag. */
  categories: Category[];
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
export function ParentDialog({ notes, categories, noteOrder, parentId, childId, owner, onSet, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [chosen, setChosen] = useState(parentId);
  /**
   * The tag filter: the add area's own controls (each category as pills or a dropdown, remembered once for
   * the pop-up on this device). The tags ticked are remembered on this device too, so the pop-up opens
   * filtered as it was left.
   */
  const [tagSelection, setTagSelection] = useParentTagSelection();
  const [collapsed, setCollapsed] = useCollapsedCategories("parent-dialog");
  /** The whole tag filter folds away (remembered on this device); closed, its header says how many tags are ticked. */
  const [tagsOpen, setTagsOpen] = useParentTagsOpen();
  /** Notes whose children are folded away (hidden, at every depth). All start open; not remembered. */
  const [folded, setFolded] = useState<ReadonlySet<number>>(() => new Set());
  /** Escape closing an open dropdown list shouldn't also close the pop-up. */
  const escapeClosedList = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const [sort, setSort] = useParentSort();
  // Alphabetical: the notes go in by title with no order of their own, so each note's children are by title too.
  const filters = useMemo(() => selectionToFilters(categories, tagSelection), [categories, tagSelection]);
  /** How many tags are ticked. */
  const ticked = filters.reduce((total, filter) => total + filter.tagIds.length, 0);
  /**
   * With tags ticked: the long-form notes that match (any ticked tag in a category, every category), plus
   * the notes they're inside (greyed, so each match is in its place in the tree), and the chosen parent
   * (so it can always be unticked). Undefined when no tag is ticked: every one is listed.
   */
  const { listed, matching } = useMemo(() => {
    const parents = possibleParents(notes);
    if (filters.length === 0) return { listed: parents, matching: undefined };
    const matching = new Set(parents.filter((note) => noteMatchesFilters(note, filters)).map((note) => note.id));
    const keep = new Set<number>();
    const byId = new Map(parents.map((note) => [note.id, note]));
    for (const id of [...matching, ...(chosen === undefined ? [] : [chosen])]) {
      // The note and each one above it, up to the top (stopping at a loop, which the server never allows).
      for (let note = byId.get(id); note && !keep.has(note.id); note = note.parentId === undefined ? undefined : byId.get(note.parentId)) {
        keep.add(note.id);
      }
    }
    return { listed: parents.filter((note) => keep.has(note.id)), matching };
  }, [notes, filters, chosen]);
  const tree = useMemo(
    () => (sort === "alphabetical" ? longFormTree([...listed].sort(byTitle), []) : longFormTree(listed, noteOrder)),
    [listed, noteOrder, sort],
  );
  /** The note itself and everything under it: choosing one of them would make a loop. */
  const inside = useMemo(() => (childId === undefined ? new Set<number>() : new Set([childId, ...descendantIds(notes, childId)])), [notes, childId]);

  /**
   * The rows shown, each with whether it has children in the list (so a caret to fold them): every entry
   * of the tree except those under a folded note.
   */
  const rows = useMemo(() => {
    const shown: { note: Note; depth: number; hasChildren: boolean }[] = [];
    /** While set, entries deeper than this are under a folded note. */
    let hiddenBelow: number | undefined;
    tree.forEach(({ note, depth }, index) => {
      if (hiddenBelow !== undefined && depth > hiddenBelow) return;
      hiddenBelow = folded.has(note.id) ? depth : undefined;
      shown.push({ note, depth, hasChildren: (tree[index + 1]?.depth ?? -1) > depth });
    });
    return shown;
  }, [tree, folded]);

  function toggleFolded(noteId: number) {
    const next = new Set(folded);
    if (!next.delete(noteId)) next.add(noteId);
    setFolded(next);
  }

  /** Why a note can't be the parent, if it can't. */
  function unavailable(note: Note): string | undefined {
    if (matching && !matching.has(note.id) && note.id !== chosen) return "Doesn't have the ticked tags: shown because a note inside it has them";
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
      // Escape (or the browser's own close) counts as Cancel, unless it's just closing a tag dropdown's list.
      onKeyDownCapture={(event) => {
        if (event.key === "Escape") escapeClosedList.current = !!ref.current?.querySelector(".tag-dropdown-list");
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (escapeClosedList.current) {
          escapeClosedList.current = false;
          return;
        }
        onCancel();
      }}
    >
      <p id="parent-dialog-title" className="due-date-title">
        Parent note
      </p>
      {/* How the list is sorted; child notes are always under their parent, sorted the same way among themselves. */}
      <div className="parent-dialog-sort" role="radiogroup" aria-label="Sort">
        <span className="parent-dialog-sort-label">Sort:</span>
        <label>
          <input type="radio" name="parent-sort" checked={sort === "order"} onChange={() => setSort("order")} />
          Note order
        </label>
        <label>
          <input type="radio" name="parent-sort" checked={sort === "alphabetical"} onChange={() => setSort("alphabetical")} />
          Alphabetical
        </label>
      </div>
      {/* Narrow the list by tag, with the same controls as the add area (pills, or dropdowns), in a section that folds away. */}
      {categories.length > 0 && (
        <div className="parent-dialog-tags">
          <div className="parent-dialog-tags-header">
            <button
              type="button"
              className="parent-dialog-tags-toggle"
              aria-expanded={tagsOpen}
              aria-controls="parent-dialog-tag-filter"
              onClick={() => setTagsOpen(!tagsOpen)}
            >
              <FontAwesomeIcon icon={tagsOpen ? faChevronDown : faChevronRight} className="parent-dialog-tags-chevron" />
              Filter by tag
              {ticked > 0 && <span className="parent-dialog-tags-count">({ticked} ticked)</span>}
            </button>
            {ticked > 0 && (
              <button type="button" className="tag-dropdown-select-all" onClick={() => setTagSelection({})}>
                clear tags
              </button>
            )}
          </div>
          {tagsOpen && (
            <div id="parent-dialog-tag-filter" role="group" aria-label="Filter by tag">
              <MixedTagPicker
                categories={categories}
                selection={tagSelection}
                onChange={setTagSelection}
                disabled={false}
                showSharing
                collapsed={collapsed}
                onCollapsedChange={setCollapsed}
              />
            </div>
          )}
        </div>
      )}
      {tree.length === 0 ? (
        <p className="parent-dialog-empty">
          {filters.length > 0 ? "No long-form notes have the ticked tags." : "There are no long-form notes to choose from."}
        </p>
      ) : (
        <div className="parent-dialog-list" role="group" aria-label="Long-form notes">
          {rows.map(({ note, depth, hasChildren }) => {
            const why = unavailable(note);
            const title = withoutMarkers(note.titleText ?? "");
            const isFolded = folded.has(note.id);
            return (
              <div key={note.id} className="parent-dialog-row" style={depth > 0 ? { paddingLeft: `${depth * 1.25}rem` } : undefined}>
                {/* Left of the tick box: folds or unfolds the notes inside it. Outside the label, so it never ticks the box. */}
                {hasChildren ? (
                  <button
                    type="button"
                    className="parent-dialog-caret"
                    aria-expanded={!isFolded}
                    aria-label={`${isFolded ? "Show" : "Hide"} the notes inside ${title}`}
                    title={isFolded ? "Show the notes inside it" : "Hide the notes inside it"}
                    onClick={() => toggleFolded(note.id)}
                  >
                    <FontAwesomeIcon icon={isFolded ? faCaretRight : faCaretDown} />
                  </button>
                ) : (
                  <span className="parent-dialog-caret" aria-hidden />
                )}
                <label className={why ? "unavailable" : undefined} title={why ?? title}>
                  <input
                    type="checkbox"
                    checked={chosen === note.id}
                    disabled={why !== undefined}
                    onChange={(event) => setChosen(event.target.checked ? note.id : undefined)}
                  />
                  <span className="parent-dialog-title">
                    {/* Long titles are cut to 50 characters (the full title is in the hover text). */}
                    {shortTitle(note, 50)}
                    {note.shared && <span className="parent-dialog-owner"> ({note.shared.ownerName})</span>}
                    <LifetimePill note={note} />
                  </span>
                </label>
              </div>
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

/**
 * After a Waiting or Archived note's title: a small pill in the list's colours for those notes (light grey,
 * or dark grey with white text), with the icon of the list's button for that state. New and Active notes have none.
 */
function LifetimePill({ note }: { note: Note }) {
  const lifetime = lifetimeOf(note);
  if (lifetime !== LIFETIME_WAITING && lifetime !== LIFETIME_ARCHIVED) return null;
  const waiting = lifetime === LIFETIME_WAITING;
  const name = waiting ? "Waiting" : "Archived";
  return (
    <span className={`parent-status-pill ${waiting ? "waiting" : "archived"}`} title={`This note is ${name}`}>
      <FontAwesomeIcon icon={waiting ? faHourglass : faBoxArchive} className="pill-icon" />
      {name}
    </span>
  );
}
