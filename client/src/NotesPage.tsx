import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPen } from "@fortawesome/free-solid-svg-icons";
import {
  noteMatchesTab,
  validateTitle,
  validateTitleImage,
  type Category,
  type Note,
  type NoteTitle,
  type Tab,
} from "@nwsnotes/shared";
import { ApiError, api } from "./api";
import { INK_SCALE, StylusPad, type StylusPadHandle } from "./StylusPad";
import { constraintsFor, missingRequiredCategory, selectedTagIds, TagPickers, type TagSelection } from "./TagPickers";
import { TagPills } from "./TagPills";

interface Props {
  notes: Note[];
  categories: Category[];
  /** The selected tab, or undefined for "All". Only matching notes are listed. */
  selectedTab: Tab | undefined;
  /** In stylus mode, new notes are written on a canvas instead of typed. */
  stylusMode: boolean;
  /** The dropdowns' selections for new notes, kept by the app so they survive visits to settings and edits. */
  tagSelection: TagSelection;
  onTagSelectionChange: (selection: TagSelection) => void;
  /** The note being edited, if any. The app keeps this so it can block changing tab meanwhile. */
  editingNote: Note | undefined;
  onEditStart: (note: Note) => void;
  onEditEnd: () => void;
  onNoteAdded: (note: Note) => void;
  onNoteUpdated: (note: Note) => void;
  onSessionExpired: () => void;
}

/** A note's tags as dropdown selections: category id -> tag ids. */
function selectionFor(note: Note, categories: Category[]): TagSelection {
  return Object.fromEntries(
    categories.map((category) => [
      category.id,
      category.tags.filter((tag) => note.tagIds.includes(tag.id)).map((tag) => tag.id),
    ]),
  );
}

export function NotesPage({
  notes,
  categories,
  selectedTab,
  stylusMode,
  tagSelection,
  onTagSelectionChange,
  editingNote,
  onEditStart,
  onEditEnd,
  onNoteAdded,
  onNoteUpdated,
  onSessionExpired,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const padRef = useRef<StylusPadHandle>(null);
  const [title, setTitle] = useState("");
  /** The tags chosen while editing a note (the new-note choices are kept separately and come back afterwards). */
  const [editSelection, setEditSelection] = useState<TagSelection>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  /** The kind of pointer that last touched the new-note controls, for browsers whose clicks don't say. */
  const lastPointerType = useRef("");

  /** The canvas is shown in stylus mode, and when editing a handwritten note whatever the mode. */
  const showCanvas = editingNote ? editingNote.titleImage !== undefined : stylusMode;

  /**
   * While the canvas is showing, finger and palm taps on the new-note controls (Add/Update, Cancel,
   * Clear, the tag dropdowns and their lists) do nothing, so a hand resting on the screen while writing
   * can't press anything. Only taps are stopped: fingers can still scroll the area. Keyboard use isn't affected.
   */
  function ignoreTouchWhileWriting(event: ReactMouseEvent) {
    if (!showCanvas) return;
    const click = event.nativeEvent as Partial<PointerEvent>;
    const pointerType = "pointerType" in click ? click.pointerType : lastPointerType.current;
    if (pointerType === "touch") {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  // Hidden notes aren't changed, just not listed.
  const visibleNotes = useMemo(
    () => (selectedTab ? notes.filter((note) => noteMatchesTab(note, selectedTab)) : notes),
    [notes, selectedTab],
  );
  /** What the selected tab requires of new notes, so they always match it and stay visible. */
  const constraints = useMemo(() => constraintsFor(selectedTab), [selectedTab]);

  // Newest notes are at the bottom, so keep the list scrolled to the bottom
  // when the page opens, whenever a note is added, and when the tab changes.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [visibleNotes.length, selectedTab?.id]);

  function startEdit(note: Note) {
    // Any new note that was being typed or written is discarded.
    setTitle(note.titleText ?? "");
    setEditSelection(selectionFor(note, categories));
    setSaveError(undefined);
    onEditStart(note);
    if (note.titleText !== undefined) {
      requestAnimationFrame(() => {
        const input = inputRef.current;
        input?.focus();
        input?.setSelectionRange(input.value.length, input.value.length);
      });
    }
  }

  /** Back to adding notes, with an empty title box or canvas. */
  function finishEdit() {
    setTitle("");
    setEditSelection({});
    setSaveError(undefined);
    onEditEnd();
  }

  // Escape cancels an edit (unless it's closing an open tag list).
  useEffect(() => {
    if (!editingNote) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving && !document.querySelector(".tag-dropdown-list")) finishEdit();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  // Leaving the page (e.g. with the back button) cancels an edit, so the tabs aren't left blocked.
  const onEditEndRef = useRef(onEditEnd);
  onEditEndRef.current = onEditEnd;
  useEffect(() => () => onEditEndRef.current(), []);

  /** The title to save, or undefined (with the error shown) if there isn't a valid one. */
  function newTitle(): NoteTitle | undefined {
    if (showCanvas) {
      const pad = padRef.current;
      if (!pad?.hasInk()) {
        setSaveError("Nothing has been written yet.");
        return undefined;
      }
      const check = validateTitleImage(pad.toImage());
      if (!check.ok) setSaveError(check.error);
      return check.ok ? { titleImage: check.value } : undefined;
    }
    const check = validateTitle(title);
    if (!check.ok) {
      setSaveError(check.error);
      inputRef.current?.focus();
    }
    return check.ok ? { titleText: check.title } : undefined;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;

    const noteTitle = newTitle();
    if (!noteTitle) return;
    // The tab's rules only apply to new notes; an edited note can be given any tags.
    if (!editingNote) {
      const missing = missingRequiredCategory(categories, tagSelection, constraints);
      if (missing) {
        setSaveError(`Choose a ${missing.name} tag: this tab only shows notes with one.`);
        return;
      }
    }

    setSaving(true);
    setSaveError(undefined);
    try {
      if (editingNote) {
        const tagIds = selectedTagIds(categories, editSelection);
        onNoteUpdated(await api.updateNote(editingNote.id, { ...noteTitle, tagIds }));
        finishEdit();
      } else {
        // The dropdowns keep their selections, so the next note gets the same tags unless they're changed.
        const tagIds = selectedTagIds(categories, tagSelection, constraints);
        onNoteAdded(await api.addNote({ ...noteTitle, tagIds }));
        if (showCanvas) padRef.current?.clear();
        else setTitle("");
      }
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        onSessionExpired();
        return;
      }
      // The typed title or the writing is kept, so it can be saved again.
      setSaveError(`The note wasn't saved: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSaving(false);
      // Focus after the input is re-enabled.
      if (!showCanvas) requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  return (
    <div className="notes-page">
      <div className="note-list" ref={listRef}>
        {visibleNotes.length === 0 ? (
          <p className="empty">{selectedTab ? "No notes in this tab yet." : "No notes yet. Add your first one below."}</p>
        ) : (
          <ul>
            {visibleNotes.map((note) => (
              <li key={note.id} className={note.id === editingNote?.id ? "editing" : undefined}>
                <div className="note-body">
                  {note.titleImage !== undefined ? <HandwrittenTitle image={note.titleImage} /> : note.titleText}
                  <TagPills tagIds={note.tagIds} categories={categories} />
                </div>
                <button
                  type="button"
                  className="note-edit"
                  aria-label={note.id === editingNote?.id ? "Editing this note" : "Edit note"}
                  title={editingNote ? "Finish or cancel the current edit first" : "Edit note"}
                  // Only one note can be edited at a time.
                  disabled={editingNote !== undefined || saving}
                  onClick={() => startEdit(note)}
                >
                  <FontAwesomeIcon icon={faPen} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={editingNote ? "new-note editing" : "new-note"}>
        <form
          onSubmit={submit}
          onPointerDownCapture={(event) => {
            lastPointerType.current = event.pointerType;
          }}
          onClickCapture={ignoreTouchWhileWriting}
        >
          {/* No "New note" heading; the text box is labelled for screen readers instead. */}
          <div className="new-note-row">
            {showCanvas ? (
              <StylusPad
                // A fresh pad for each note edited (loaded with its image), and an empty one for new notes.
                key={editingNote ? `edit-${editingNote.id}` : "new"}
                ref={padRef}
                disabled={saving}
                initialImage={editingNote?.titleImage}
                onInk={() => setSaveError(undefined)}
              />
            ) : (
              <input
                id="new-note-title"
                ref={inputRef}
                type="text"
                aria-label={editingNote ? "Note title" : "New note"}
                value={title}
                placeholder="Type a note title and press Enter"
                autoComplete="off"
                autoFocus
                disabled={saving}
                onChange={(event) => setTitle(event.target.value)}
              />
            )}
            {/* Clear sits under Add, leaving more width for handwriting. */}
            <div className="new-note-buttons">
              <button type="submit" disabled={saving}>
                {editingNote ? (saving ? "Updating…" : "Update") : saving ? "Adding…" : "Add"}
              </button>
              {editingNote && (
                <button type="button" className="button" disabled={saving} onClick={finishEdit}>
                  Cancel
                </button>
              )}
              {showCanvas && (
                <button
                  type="button"
                  className="button"
                  disabled={saving}
                  onClick={() => {
                    padRef.current?.clear();
                    setSaveError(undefined);
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          {saveError && (
            <p className="save-error" role="alert">
              {saveError}
            </p>
          )}
          {editingNote ? (
            <TagPickers categories={categories} selection={editSelection} onChange={setEditSelection} disabled={saving} />
          ) : (
            <TagPickers
              categories={categories}
              selection={tagSelection}
              onChange={onTagSelectionChange}
              disabled={saving}
              constraints={constraints}
              tabName={selectedTab?.name}
            />
          )}
        </form>
      </div>
    </div>
  );
}

/** A handwritten note's image, shown at the size it was written. */
function HandwrittenTitle({ image }: { image: string }) {
  const size = pngSize(image);
  return (
    <img
      className="note-image"
      src={image}
      alt="Handwritten note"
      // Sizing it before it loads keeps the list from jumping (and scrolled to the bottom).
      width={size ? size.width / INK_SCALE : undefined}
      height={size ? size.height / INK_SCALE : undefined}
    />
  );
}

/** Reads a PNG data URL's pixel size from its header (bytes 16-23), or undefined if it can't. */
function pngSize(dataUrl: string): { width: number; height: number } | undefined {
  try {
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1, dataUrl.indexOf(",") + 1 + 32);
    const bytes = atob(base64);
    const read = (at: number) =>
      ((bytes.charCodeAt(at) << 24) | (bytes.charCodeAt(at + 1) << 16) | (bytes.charCodeAt(at + 2) << 8) | bytes.charCodeAt(at + 3)) >>> 0;
    return { width: read(16), height: read(20) };
  } catch {
    return undefined;
  }
}
