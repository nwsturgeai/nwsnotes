import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowDown, faArrowUp, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import { NAME_MAX_LENGTH, validateCategory, type Category, type CategoryRequest, type Note } from "@nwsnotes/shared";
import { ApiError, api } from "./api";
import { ConfirmDialog } from "./ConfirmDialog";

interface Props {
  /** "new" to add a category. */
  id: number | "new";
  categories: Category[];
  /** All notes, to say how many a deleted tag is removed from. */
  notes: Note[];
  onSaved: (category: Category) => void;
  /** Returns to the settings page (after saving or cancelling). */
  onClose: () => void;
  onSessionExpired: () => void;
}

/** One tag text box. `id` is set for tags that are already saved. */
interface TagRow {
  key: number;
  id?: number;
  name: string;
}

/** Adding and editing a category share this page. */
export function CategoryEditPage(props: Props) {
  const existing = props.id === "new" ? undefined : props.categories.find((c) => c.id === props.id);
  if (props.id !== "new" && !existing) {
    return (
      <main className="settings-page">
        <h1>Category not found</h1>
        <p>There is no category with id {props.id}.</p>
        <button type="button" className="button" onClick={props.onClose}>
          Back to settings
        </button>
      </main>
    );
  }
  // Keyed so that switching between categories starts a fresh form.
  return <CategoryForm key={String(props.id)} {...props} existing={existing} />;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function CategoryForm({
  categories,
  notes,
  existing,
  onSaved,
  onClose,
  onSessionExpired,
}: Props & { existing: Category | undefined }) {
  // The form starts from the saved category and isn't changed by live updates while open.
  const nextKey = useRef(0);
  const newRow = (tag?: { id: number; name: string }): TagRow => ({ key: nextKey.current++, ...tag, name: tag?.name ?? "" });
  const [name, setName] = useState(existing?.name ?? "");
  const [multiSelect, setMultiSelect] = useState(existing?.multiSelect ?? false);
  const [rows, setRows] = useState<TagRow[]>(() => (existing ? existing.tags.map((tag) => newRow(tag)) : [newRow()]));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  /** Asking before saving, when deleted tags are on notes. */
  const [confirming, setConfirming] = useState<{ message: string; request: CategoryRequest }>();
  const focusKey = useRef<number>(undefined);

  function setRowName(key: number, value: string) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, name: value } : row)));
  }

  function addRow() {
    const row = newRow();
    focusKey.current = row.key;
    setRows((current) => [...current, row]);
  }

  /** Deletes a tag row. A saved tag is only deleted (and removed from notes) when the category is saved. */
  function deleteRow(key: number) {
    setRows((current) => current.filter((row) => row.key !== key));
  }

  /** The arrow to focus after a move, so pressing it again keeps moving the same tag. */
  const focusArrow = useRef<{ key: number; direction: "up" | "down" }>(undefined);

  /** Moves a tag row up (-1) or down (+1); the new order is saved with the category. */
  function moveRow(key: number, by: -1 | 1) {
    setRows((current) => {
      const from = current.findIndex((row) => row.key === key);
      const to = from + by;
      const moving = current[from];
      const other = current[to];
      if (!moving || !other) return current;
      const next = [...current];
      next[from] = other;
      next[to] = moving;
      // At the top or bottom that arrow is greyed out, so the other one takes the focus.
      const edge = by < 0 ? to === 0 : to === next.length - 1;
      focusArrow.current = { key, direction: (by < 0) !== edge ? "up" : "down" };
      return next;
    });
  }

  /** Ref for a row's arrow button: focuses it if it's the one to focus after a move. */
  function arrowRef(key: number, direction: "up" | "down") {
    return (button: HTMLButtonElement | null) => {
      const target = focusArrow.current;
      if (button && target?.key === key && target.direction === direction) {
        focusArrow.current = undefined;
        button.focus();
      }
    };
  }

  function onTagKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Enter in a tag box adds another tag rather than saving.
    if (event.key === "Enter") {
      event.preventDefault();
      addRow();
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;

    const request: CategoryRequest = {
      name,
      multiSelect,
      tags: rows.map((row) => (row.id === undefined ? { name: row.name } : { id: row.id, name: row.name })),
    };
    const check = validateCategory(request, categories, existing);
    if (!check.ok) {
      setError(check.error);
      return;
    }

    // Deleting tags removes them from every note that has them, so say so first.
    const deleted = (existing?.tags ?? []).filter((tag) => !check.category.tags.some((t) => t.id === tag.id));
    const affected = notes.filter((note) => deleted.some((tag) => note.tagIds.includes(tag.id))).length;
    if (affected > 0) {
      const names = deleted.map((tag) => `"${tag.name}"`).join(", ");
      setConfirming({
        message: `Delete ${deleted.length === 1 ? "the tag" : "the tags"} ${names}? ${deleted.length === 1 ? "It" : "They"} will be removed from ${plural(affected, "note")}.`,
        request: check.category,
      });
      return;
    }
    void send(check.category);
  }

  async function send(request: CategoryRequest) {
    setConfirming(undefined);
    setSaving(true);
    setError(undefined);
    try {
      const saved = existing ? await api.updateCategory(existing.id, request) : await api.addCategory(request);
      onSaved(saved);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.isUnauthorized) {
        onSessionExpired();
        return;
      }
      setError(`The category wasn't saved: ${err instanceof Error ? err.message : String(err)}`);
      setSaving(false);
    }
  }

  return (
    <main className="settings-page">
      <h1>{existing ? "Edit category" : "New category"}</h1>
      <form className="category-form" onSubmit={save}>
        <label htmlFor="category-name">Name</label>
        <input
          id="category-name"
          type="text"
          value={name}
          maxLength={NAME_MAX_LENGTH}
          autoComplete="off"
          autoFocus={!existing}
          disabled={saving}
          onChange={(event) => setName(event.target.value)}
        />

        {/* Linked by id as well as wrapping, with a tall tap area, so tapping the text toggles the box. */}
        <label className="checkbox" htmlFor="category-multi-select">
          <input
            id="category-multi-select"
            type="checkbox"
            checked={multiSelect}
            disabled={saving || existing?.multiSelect}
            onChange={(event) => setMultiSelect(event.target.checked)}
          />
          <span>Multi-select: a note can have several tags from this category</span>
        </label>
        {existing?.multiSelect && (
          <p className="hint">A multi-select category can't be changed back to single-select.</p>
        )}

        <fieldset>
          <legend>Tags</legend>
          {rows.map((row, index) => (
            <div key={row.key} className="tag-row">
              <input
                type="text"
                aria-label={`Tag ${index + 1}`}
                value={row.name}
                maxLength={NAME_MAX_LENGTH}
                autoComplete="off"
                placeholder={row.id === undefined ? "New tag" : undefined}
                disabled={saving}
                ref={(input) => {
                  if (input && focusKey.current === row.key) {
                    focusKey.current = undefined;
                    input.focus();
                  }
                }}
                onChange={(event) => setRowName(row.key, event.target.value)}
                onKeyDown={onTagKeyDown}
              />
              {/* Up and down change the tag order; like renames and deletes, it's saved with the category. */}
              <button
                type="button"
                className="note-button"
                ref={arrowRef(row.key, "up")}
                aria-label={`Move up ${row.name || `tag ${index + 1}`}`}
                title="Move up"
                disabled={saving || index === 0}
                onClick={() => moveRow(row.key, -1)}
              >
                <FontAwesomeIcon icon={faArrowUp} />
              </button>
              <button
                type="button"
                className="note-button"
                ref={arrowRef(row.key, "down")}
                aria-label={`Move down ${row.name || `tag ${index + 1}`}`}
                title="Move down"
                disabled={saving || index === rows.length - 1}
                onClick={() => moveRow(row.key, 1)}
              >
                <FontAwesomeIcon icon={faArrowDown} />
              </button>
              <button
                type="button"
                className="note-button"
                aria-label={`Delete tag ${row.name || index + 1}`}
                title="Delete tag"
                // A category needs at least one tag.
                disabled={saving || rows.length === 1}
                onClick={() => deleteRow(row.key)}
              >
                <FontAwesomeIcon icon={faTrashCan} />
              </button>
            </div>
          ))}
          <button type="button" className="button" disabled={saving} onClick={addRow}>
            Add tag
          </button>
        </fieldset>

        {error && (
          <p className="save-error" role="alert">
            {error}
          </p>
        )}

        <div className="form-buttons">
          <button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" className="button" disabled={saving} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
      {confirming && (
        <ConfirmDialog
          message={confirming.message}
          confirmLabel="Delete and save"
          onConfirm={() => void send(confirming.request)}
          onCancel={() => setConfirming(undefined)}
        />
      )}
    </main>
  );
}
