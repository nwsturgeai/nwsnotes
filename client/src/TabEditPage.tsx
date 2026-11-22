import { useState, type FormEvent } from "react";
import {
  ALL_TAB_NAME,
  SPOKEN_NAME_MAX_LENGTH,
  TAB_NAME_MAX_LENGTH,
  validateTab,
  type Category,
  type Tab,
  type TabPlacement,
  type TabRequest,
} from "@nwsnotes/shared";
import { ApiError, api } from "./api";
import { TagPickers, type TagSelection } from "./TagPickers";

interface Props {
  /** "new" to add a tab; "all" for the built-in tab, whose only setting is where it shows. */
  id: number | "new" | "all";
  tabs: Tab[];
  /** Where the built-in "All" tab shows. */
  allTabPlacement: TabPlacement;
  onAllTabPlacementSaved: (placement: TabPlacement) => void;
  categories: Category[];
  onSaved: (tab: Tab) => void;
  onDeleted: (id: number) => void;
  /** Returns to the settings page (after saving, cancelling or deleting). */
  onClose: () => void;
  onSessionExpired: () => void;
}

/** Adding and editing a tab share this page. */
export function TabEditPage(props: Props) {
  if (props.id === "all") return <AllTabForm {...props} />;
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
  const [spokenName, setSpokenName] = useState(existing?.spokenName ?? "");
  const [selection, setSelection] = useState<TagSelection>(() =>
    Object.fromEntries((existing?.categories ?? []).map((filter) => [filter.categoryId, filter.tagIds])),
  );
  const [placement, setPlacement] = useState<TabPlacement>(existing?.placement ?? "top");
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
      ...(placement === "left" && { placement }),
      ...(spokenName.trim() !== "" && { spokenName }),
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

        <label htmlFor="tab-spoken-name">Spoken name (optional)</label>
        <input
          id="tab-spoken-name"
          type="text"
          value={spokenName}
          maxLength={SPOKEN_NAME_MAX_LENGTH}
          autoComplete="off"
          disabled={busy}
          aria-describedby="tab-spoken-name-hint"
          onChange={(event) => setSpokenName(event.target.value)}
        />
        <p className="hint" id="tab-spoken-name-hint">
          An easier name to say when sending notes by text message, e.g. "do it yourself" for "DIY".
        </p>

        <PlacementSwitch placement={placement} onChange={setPlacement} disabled={busy} />

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

/** Where a tab shows: a switch between "Top" (off) and "Left" (on). */
function PlacementSwitch({
  placement,
  onChange,
  disabled,
}: {
  placement: TabPlacement;
  onChange: (placement: TabPlacement) => void;
  disabled: boolean;
}) {
  return (
    <div className="placement-setting">
      <span className="placement-heading">Where the tab shows</span>
      <label className="switch">
        <span className="switch-label">Top</span>
        <input
          type="checkbox"
          role="switch"
          aria-label="Show on the left"
          checked={placement === "left"}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked ? "left" : "top")}
        />
        <span className="switch-track" aria-hidden="true" />
        <span className="switch-label">Left</span>
      </label>
    </div>
  );
}

/** The built-in "All" tab: its name and filters can't change, so its only setting is where it shows. */
function AllTabForm({ allTabPlacement, onAllTabPlacementSaved, onClose, onSessionExpired }: Props) {
  const [placement, setPlacement] = useState(allTabPlacement);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.setAllTabPlacement({ placement });
      onAllTabPlacementSaved(placement);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.isUnauthorized) {
        onSessionExpired();
        return;
      }
      setError(`The tab wasn't saved: ${err instanceof Error ? err.message : String(err)}`);
      setBusy(false);
    }
  }

  return (
    <main className="settings-page">
      <h1>{ALL_TAB_NAME} tab</h1>
      <p>The built-in tab that shows every note. Its name and filters can't be changed, and it can't be deleted.</p>
      <form className="category-form" onSubmit={(event) => void save(event)}>
        <PlacementSwitch placement={placement} onChange={setPlacement} disabled={busy} />
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
        </div>
      </form>
    </main>
  );
}
