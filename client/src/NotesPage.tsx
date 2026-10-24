import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { validateTitle, type Note } from "@nwsnotes/shared";
import { ApiError, api } from "./api";

interface Props {
  notes: Note[];
  onNoteAdded: (note: Note) => void;
  onSessionExpired: () => void;
}

export function NotesPage({ notes, onNoteAdded, onSessionExpired }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();

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
      const note = await api.addNote({ titleText: check.title });
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
            {notes.map((note) => (
              <li key={note.id}>{note.titleText}</li>
            ))}
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
        </form>
      </div>
    </div>
  );
}
