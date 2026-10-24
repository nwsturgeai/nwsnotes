import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { NAME_MAX_LENGTH, validateCategory, type Category, type CategoryRequest } from "@nwsnotes/shared";
import { ApiError, api } from "./api";

interface Props {
  /** "new" to add a category. */
  id: number | "new";
  categories: Category[];
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

function CategoryForm({
  categories,
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
  const focusKey = useRef<number>(undefined);

  function setRowName(key: number, value: string) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, name: value } : row)));
  }

  function addRow() {
    const row = newRow();
    focusKey.current = row.key;
    setRows((current) => [...current, row]);
  }

  function onTagKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Enter in a tag box adds another tag rather than saving.
    if (event.key === "Enter") {
      event.preventDefault();
      addRow();
    }
  }

  async function save(event: FormEvent) {
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

    setSaving(true);
    setError(undefined);
    try {
      const saved = existing
        ? await api.updateCategory(existing.id, check.category)
        : await api.addCategory(check.category);
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

        <label className="checkbox">
          <input
            type="checkbox"
            checked={multiSelect}
            disabled={saving || existing?.multiSelect}
            onChange={(event) => setMultiSelect(event.target.checked)}
          />
          Multi-select: a note can have several tags from this category
        </label>
        {existing?.multiSelect && (
          <p className="hint">A multi-select category can't be changed back to single-select.</p>
        )}

        <fieldset>
          <legend>Tags</legend>
          {rows.map((row, index) => (
            <input
              key={row.key}
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
    </main>
  );
}
