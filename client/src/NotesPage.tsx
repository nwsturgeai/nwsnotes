import { useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { validateTitle, validateTitleImage, type Category, type Note, type NoteTitle, type Tag } from "@nwsnotes/shared";
import { ApiError, api } from "./api";
import { INK_SCALE, StylusPad, type StylusPadHandle } from "./StylusPad";
import { selectedTagIds, TagPickers, type TagSelection } from "./TagPickers";

interface Props {
  notes: Note[];
  categories: Category[];
  /** In stylus mode, new notes are written on a canvas instead of typed. */
  stylusMode: boolean;
  /** The dropdowns' selections, kept by the app so they survive visits to settings. */
  tagSelection: TagSelection;
  onTagSelectionChange: (selection: TagSelection) => void;
  onNoteAdded: (note: Note) => void;
  onSessionExpired: () => void;
}

export function NotesPage({
  notes,
  categories,
  stylusMode,
  tagSelection,
  onTagSelectionChange,
  onNoteAdded,
  onSessionExpired,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const padRef = useRef<StylusPadHandle>(null);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();

  // Each tag id -> the tag, its category, and its place in the display order (category order, then tag order).
  const tagsById = useMemo(() => {
    const map = new Map<number, { tag: Tag; category: Category; order: number }>();
    let order = 0;
    for (const category of categories) {
      for (const tag of category.tags) map.set(tag.id, { tag, category, order: order++ });
    }
    return map;
  }, [categories]);

  // Newest notes are at the bottom, so keep the list scrolled to the bottom
  // when the page opens and whenever a note is added.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [notes.length]);

  /** The title to save, or undefined (with the error shown) if there isn't a valid one. */
  function newTitle(): NoteTitle | undefined {
    if (stylusMode) {
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

  async function addNote(event: FormEvent) {
    event.preventDefault();
    if (saving) return;

    const noteTitle = newTitle();
    if (!noteTitle) return;

    setSaving(true);
    setSaveError(undefined);
    try {
      // The dropdowns keep their selections, so the next note gets the same tags unless they're changed.
      const note = await api.addNote({ ...noteTitle, tagIds: selectedTagIds(categories, tagSelection) });
      onNoteAdded(note);
      if (stylusMode) padRef.current?.clear();
      else setTitle("");
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        onSessionExpired();
        return;
      }
      // The typed title or the writing is kept, so the note can be added again.
      setSaveError(`The note wasn't saved: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSaving(false);
      // Focus after the input is re-enabled.
      if (!stylusMode) requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  return (
    <div className="notes-page">
      <div className="note-list" ref={listRef}>
        {notes.length === 0 ? (
          <p className="empty">No notes yet. Add your first one below.</p>
        ) : (
          <ul>
            {notes.map((note) => {
              const tags = note.tagIds
                .map((id) => tagsById.get(id))
                .filter((entry) => entry !== undefined)
                .sort((a, b) => a.order - b.order);
              return (
                <li key={note.id}>
                  {note.titleImage !== undefined ? <HandwrittenTitle image={note.titleImage} /> : note.titleText}
                  {tags.length > 0 && (
                    <ul className="pills">
                      {tags.map(({ tag, category }) => (
                        <li key={tag.id} title={category.name}>
                          {tag.name}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="new-note">
        <form onSubmit={addNote}>
          <label htmlFor={stylusMode ? undefined : "new-note-title"}>New note</label>
          <div className="new-note-row">
            {stylusMode ? (
              <StylusPad ref={padRef} disabled={saving} onInk={() => setSaveError(undefined)} />
            ) : (
              <input
                id="new-note-title"
                ref={inputRef}
                type="text"
                value={title}
                placeholder="Type a note title and press Enter"
                autoComplete="off"
                autoFocus
                disabled={saving}
                onChange={(event) => setTitle(event.target.value)}
              />
            )}
            <button type="submit" disabled={saving}>
              {saving ? "Adding…" : "Add"}
            </button>
            {stylusMode && (
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
          {saveError && (
            <p className="save-error" role="alert">
              {saveError}
            </p>
          )}
          <TagPickers
            categories={categories}
            selection={tagSelection}
            onChange={onTagSelectionChange}
            disabled={saving}
          />
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
