import { useState, type MouseEvent } from "react";
import {
  ALL_TAB_NAME,
  lifetimeOf,
  LIFETIME_ARCHIVED,
  LIFETIME_BIN,
  type Category,
  type Note,
  type Tab,
} from "@nwsnotes/shared";
import { ApiError, api } from "./api";
import { ConfirmDialog } from "./ConfirmDialog";
import { pathFor, type Page } from "./route";
import { MAX_COLUMNS } from "./stylusMode";
import { TagPills } from "./TagPills";

interface Props {
  notes: Note[];
  /** All categories, including the built-in Lifetime one. */
  categories: Category[];
  tabs: Tab[];
  stylusMode: boolean;
  onStylusModeChange: (on: boolean) => void;
  columns: number;
  onColumnsChange: (columns: number) => void;
  onNavigate: (page: Page) => void;
  /** Called after a Lifetime button changed notes, to reload them. */
  onNotesChanged: () => void;
  onSessionExpired: () => void;
  onLogout: () => void;
}

type BulkAction = "reset-new" | "archived-to-bin" | "empty-bin";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function SettingsPage({
  notes,
  categories,
  tabs,
  stylusMode,
  onStylusModeChange,
  columns,
  onColumnsChange,
  onNavigate,
  onNotesChanged,
  onSessionExpired,
  onLogout,
}: Props) {
  const [confirming, setConfirming] = useState<{ action: BulkAction; message: string; label: string }>();
  const [busy, setBusy] = useState(false);
  /** The result of the last Lifetime button, shown under the buttons. */
  const [result, setResult] = useState<{ text: string; error?: boolean }>();

  function go(event: MouseEvent, target: Page) {
    event.preventDefault();
    onNavigate(target);
  }

  const archivedCount = notes.filter((note) => lifetimeOf(note) === LIFETIME_ARCHIVED).length;
  const binCount = notes.filter((note) => lifetimeOf(note) === LIFETIME_BIN).length;

  async function run(action: BulkAction, done: (count: number) => string) {
    setConfirming(undefined);
    setBusy(true);
    setResult(undefined);
    try {
      const { count } = await api.bulkLifetime(action);
      setResult({ text: done(count) });
      if (count > 0) onNotesChanged();
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        onSessionExpired();
        return;
      }
      setResult({ text: `Nothing was changed: ${error instanceof Error ? error.message : String(error)}`, error: true });
    } finally {
      setBusy(false);
    }
  }

  /** "Archived to Bin" and "Empty Bin" ask first, giving the count; with nothing to do, they just say so. */
  function confirmFirst(action: BulkAction, count: number, nothing: string, message: string, label: string) {
    setResult(undefined);
    if (count === 0) setResult({ text: nothing });
    else setConfirming({ action, message, label });
  }

  const doneMessages: Record<BulkAction, (count: number) => string> = {
    "reset-new": (count) => (count === 0 ? "There are no New notes." : `${plural(count, "note")} changed to Active.`),
    "archived-to-bin": (count) => `${plural(count, "note")} moved to the bin.`,
    "empty-bin": (count) => `${plural(count, "note")} permanently deleted.`,
  };

  return (
    <main className="settings-page">
      <h1>Settings</h1>

      {/* Stylus mode and Columns side by side; both are remembered on this device only. */}
      <section className="device-settings">
        <div>
          <label className="switch">
            <input
              type="checkbox"
              role="switch"
              checked={stylusMode}
              onChange={(event) => onStylusModeChange(event.target.checked)}
            />
            <span className="switch-track" aria-hidden="true" />
            <span className="switch-label">Stylus mode</span>
          </label>
          <p>Write new notes with a stylus instead of typing them.</p>
        </div>
        <div>
          <div className="columns-setting" role="radiogroup" aria-labelledby="columns-label">
            <span id="columns-label" className="switch-label">
              Columns
            </span>
            {Array.from({ length: MAX_COLUMNS }, (_, index) => index + 1).map((count) => (
              <button
                key={count}
                type="button"
                role="radio"
                aria-checked={columns === count}
                className={columns === count ? "column-choice chosen" : "column-choice"}
                onClick={() => onColumnsChange(count)}
              >
                {count}
              </button>
            ))}
          </div>
          <p>How many columns the notes are shown in.</p>
        </div>
        <p className="device-note">These settings are remembered on this device only.</p>
      </section>

      <section>
        <h2>Lifetime</h2>
        <p>Every note is New, Active, Archived or in the Bin.</p>
        <div className="lifetime-buttons">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => void run("reset-new", doneMessages["reset-new"])}
          >
            Reset New
          </button>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() =>
              confirmFirst(
                "archived-to-bin",
                archivedCount,
                "There are no archived notes.",
                `Move ${plural(archivedCount, "archived note")} to the bin?`,
                "Move to bin",
              )
            }
          >
            Archived to Bin
          </button>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() =>
              confirmFirst(
                "empty-bin",
                binCount,
                "The bin is empty.",
                `Permanently delete ${plural(binCount, "note")} in the bin?`,
                "Delete",
              )
            }
          >
            Empty Bin
          </button>
        </div>
        {result && (
          <p className={result.error ? "save-error" : "lifetime-result"} role="status">
            {result.text}
          </p>
        )}
        {confirming && (
          <ConfirmDialog
            message={confirming.message}
            confirmLabel={confirming.label}
            onConfirm={() => void run(confirming.action, doneMessages[confirming.action])}
            onCancel={() => setConfirming(undefined)}
          />
        )}
      </section>

      <section>
        <h2>Categories</h2>
        <p>Tags are arranged into categories. Click a category to rename it or its tags, or to add tags.</p>
        {categories.length > 0 && (
          <ul className="category-list">
            {categories.map((category) => {
              const details = (
                <>
                  <span className="category-name">{category.name}</span>
                  {category.system && <span className="category-kind">built-in</span>}
                  {category.multiSelect && <span className="category-kind">multi-select</span>}
                  <span className="category-tags">{category.tags.map((tag) => tag.name).join(", ")}</span>
                </>
              );
              const page: Page = { name: "category", id: category.id };
              return (
                <li key={category.id}>
                  {/* The built-in Lifetime category can't be edited, so it isn't a link. */}
                  {category.system ? (
                    <span className="tab-entry">{details}</span>
                  ) : (
                    <a href={pathFor(page)} onClick={(event) => go(event, page)}>
                      {details}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <a
          className="button"
          href={pathFor({ name: "category", id: "new" })}
          onClick={(event) => go(event, { name: "category", id: "new" })}
        >
          Add category
        </a>
      </section>

      <section>
        <h2>Tabs</h2>
        <p>A tab shows only the notes with the tags it lists. Click a tab to change or delete it.</p>
        <ul className="category-list">
          <li>
            {/* The built-in tab can't be edited, so it isn't a link. */}
            <span className="tab-entry">
              <span className="category-name">{ALL_TAB_NAME}</span>
              <span className="category-tags">Always shows every note</span>
            </span>
          </li>
          {tabs.map((tab) => {
            const page: Page = { name: "tab", id: tab.id };
            return (
              <li key={tab.id}>
                <a href={pathFor(page)} onClick={(event) => go(event, page)}>
                  <span className="category-name">{tab.name}</span>
                  <div className="category-tags">
                    <TagPills
                      tagIds={tab.categories.flatMap((filter) => filter.tagIds)}
                      categories={categories}
                      allLifetime
                    />
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
        <a
          className="button"
          href={pathFor({ name: "tab", id: "new" })}
          onClick={(event) => go(event, { name: "tab", id: "new" })}
        >
          Add tab
        </a>
      </section>

      <section>
        <h2>Backup</h2>
        <p>Download the latest save-file from the server. It contains all your notes, categories, tags and tabs.</p>
        {/* A plain link: the session cookie is sent with it, and the server names the file. */}
        <a className="button" href="/api/notes/download" download>
          Download backup
        </a>
      </section>

      <section>
        <h2>Account</h2>
        <button type="button" className="button" onClick={onLogout}>
          Log out
        </button>
      </section>
    </main>
  );
}
