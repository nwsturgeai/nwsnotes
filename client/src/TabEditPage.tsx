import { useState, type FormEvent } from "react";
import { TAB_NAME_MAX_LENGTH, validateTab, type Category, type Tab, type TabRequest } from "@nwsnotes/shared";
import { ApiError, api } from "./api";
import { TagPickers, type TagSelection } from "./TagPickers";

interface Props {
  /** "new" to add a tab. */
  id: number | "new";
  tabs: Tab[];
  categories: Category[];
  onSaved: (tab: Tab) => void;
  onDeleted: (id: number) => void;
  /** Returns to the settings page (after saving, cancelling or deleting). */
  onClose: () => void;
  onSessionExpired: () => void;
}

/** Adding and editing a tab share this page. */
export function TabEditPage(props: Props) {
  const existing = props.id === "new" ? undefined : props.tabs.find((t) => t.id === props.id);
  if (props.id !== "new" && !existing) {
    return (
      <main className="settings-page">
        <h1>Tab not found</h1>
        <p>There is no tab with id {props.id}. It may have been deleted on another page.</p>
        <button type="button" className="button" onClick={props.onClose}>
          Back to settings
        </button>
      </main>
    );
  }
  // Keyed so that switching between tabs starts a fresh form.
  return <TabForm key={String(props.id)} {...props} existing={existing} />;
}

function TabForm({
  tabs,
  categories,
  existing,
  onSaved,
  onDeleted,
  onClose,
  onSessionExpired,
}: Props & { existing: Tab | undefined }) {
  // The form starts from the saved tab and isn't changed by live updates while open.
  const [name, setName] = useState(existing?.name ?? "");
  const [selection, setSelection] = useState<TagSelection>(() =>
    Object.fromEntries((existing?.categories ?? []).map((filter) => [filter.categoryId, filter.tagIds])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  /** Runs a save or delete, showing any failure on the page and keeping the edits. */
  async function run(action: () => Promise<void>, failure: string) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.isUnauthorized) {
        onSessionExpired();
        return;
      }
      setError(`${failure}: ${err instanceof Error ? err.message : String(err)}`);
      setBusy(false);
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const request: TabRequest = {
      name,
      // Categories with nothing ticked aren't part of the filter.
      categories: categories
        .map((category) => ({
          categoryId: category.id,
          tagIds: category.tags.filter((tag) => (selection[category.id] ?? []).includes(tag.id)).map((tag) => tag.id),
        }))
        .filter((filter) => filter.tagIds.length > 0),
    };
    const check = validateTab(request, tabs, categories, existing);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    void run(async () => {
      onSaved(existing ? await api.updateTab(existing.id, check.tab) : await api.addTab(check.tab));
    }, "The tab wasn't saved");
  }

  function remove() {
    if (!existing || busy) return;
    if (!window.confirm(`Delete the tab "${existing.name}"?`)) return;
    void run(async () => {
      await api.deleteTab(existing.id);
      onDeleted(existing.id);
    }, "The tab wasn't deleted");
  }

  return (
    <main className="settings-page">
      <h1>{existing ? "Edit tab" : "New tab"}</h1>
      <form className="category-form" onSubmit={save}>
        <label htmlFor="tab-name">Name</label>
        <input
          id="tab-name"
          type="text"
          value={name}
          maxLength={TAB_NAME_MAX_LENGTH}
          autoComplete="off"
          autoFocus={!existing}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />

        <fieldset>
          <legend>Show notes with</legend>
          {categories.length === 0 ? (
            <p className="hint">There are no categories yet. Add one in Settings first.</p>
          ) : (
            <>
              <p className="hint">
                Tick the tags to show. A note must have at least one ticked tag from each category you use.
              </p>
              <TagPickers
                categories={categories}
                selection={selection}
                onChange={setSelection}
                disabled={busy}
                checkLists
              />
            </>
          )}
        </fieldset>

        {error && (
          <p className="save-error" role="alert">
            {error}
          </p>
        )}

        <div className="form-buttons">
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" className="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          {existing && (
            <button type="button" className="button danger" disabled={busy} onClick={remove}>
              Delete
            </button>
          )}
        </div>
      </form>
    </main>
  );
}
