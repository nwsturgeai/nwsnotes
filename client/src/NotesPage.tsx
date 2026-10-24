import { useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { validateTitle, type Category, type Note, type Tag } from "@nwsnotes/shared";
import { ApiError, api } from "./api";
import { selectedTagIds, TagPickers, type TagSelection } from "./TagPickers";

interface Props {
  notes: Note[];
  categories: Category[];
  /** The dropdowns' selections, kept by the app so they survive visits to settings. */
  tagSelection: TagSelection;
  onTagSelectionChange: (selection: TagSelection) => void;
  onNoteAdded: (note: Note) => void;
  onSessionExpired: () => void;
}

export function NotesPage({ notes, categories, tagSelection, onTagSelectionChange, onNoteAdded, onSessionExpired }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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

  async function addNote(event: FormEvent) {
    event.preventDefault();
    if (saving) return;

    const check = validateTitle(title);
    if (!check.ok) {
      setSaveError(check.error);
      inputRef.current?.focus();
      return;
    }

    setSaving(true);
    setSaveError(undefined);
    try {
      // The dropdowns keep their selections, so the next note gets the same tags unless they're changed.
      const note = await api.addNote({ titleText: check.title, tagIds: selectedTagIds(categories, tagSelection) });
      onNoteAdded(note);
      setTitle("");
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        onSessionExpired();
        return;
      }
      setSaveError(`The note wasn't saved: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSaving(false);
      // Focus after the input is re-enabled.
      requestAnimationFrame(() => inputRef.current?.focus());
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
                  {note.titleText}
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
          <label htmlFor="new-note-title">New note</label>
          <div className="new-note-row">
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
            <button type="submit" disabled={saving}>
              {saving ? "Adding…" : "Add"}
            </button>
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
