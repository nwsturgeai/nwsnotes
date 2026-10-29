import { useRef, useState, type MouseEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowDown, faArrowUp } from "@fortawesome/free-solid-svg-icons";
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
import { MAX_COLUMNS, PEN_WIDTHS, usePenWidth } from "./stylusMode";
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
  /** The categories or tabs were put in a new order (shown straight away, before it's saved). */
  onCategoriesReordered: (categories: Category[]) => void;
  onTabsReordered: (tabs: Tab[]) => void;
  onSessionExpired: () => void;
  onLogout: () => void;
}

/** Up and down buttons, in the space at the right of a category's or tab's row. */
function OrderButtons({
  name,
  first,
  last,
  onMove,
  focusRef,
}: {
  name: string;
  first: boolean;
  last: boolean;
  onMove: (by: -1 | 1) => void;
  focusRef: (direction: "up" | "down") => (button: HTMLButtonElement | null) => void;
}) {
  return (
    <span className="order-buttons">
      <button
        type="button"
        className="note-button"
        ref={focusRef("up")}
        aria-label={`Move up ${name}`}
        title="Move up"
        disabled={first}
        onClick={() => onMove(-1)}
      >
        <FontAwesomeIcon icon={faArrowUp} />
      </button>
      <button
        type="button"
        className="note-button"
        ref={focusRef("down")}
        aria-label={`Move down ${name}`}
        title="Move down"
        disabled={last}
        onClick={() => onMove(1)}
      >
        <FontAwesomeIcon icon={faArrowDown} />
      </button>
    </span>
  );
}

/** `items` with the one with this id swapped with its neighbour above (-1) or below (+1). */
function moved<T extends { id: number }>(items: T[], id: number, by: -1 | 1): T[] | undefined {
  const from = items.findIndex((item) => item.id === id);
  const moving = items[from];
  const other = items[from + by];
  if (!moving || !other) return undefined;
  const next = [...items];
  next[from] = other;
  next[from + by] = moving;
  return next;
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
  onCategoriesReordered,
  onTabsReordered,
  onSessionExpired,
  onLogout,
}: Props) {
  const [confirming, setConfirming] = useState<{ action: BulkAction; message: string; label: string }>();
  /** A failed reorder, shown under that section's list. */
  const [orderError, setOrderError] = useState<{ section: "categories" | "tabs"; text: string }>();

  /** The arrow to focus after a move, so pressing it again keeps moving the same row. */
  const focusArrow = useRef<string>(undefined);
  function focusRef(key: string) {
    return (direction: "up" | "down") => (button: HTMLButtonElement | null) => {
      if (button && focusArrow.current === `${key}-${direction}`) {
        focusArrow.current = undefined;
        button.focus();
      }
    };
  }
  /** After a move, the same arrow keeps the focus; at the top or bottom that one is greyed out, so the other does. */
  function focusAfterMove(key: string, by: -1 | 1, index: number, count: number) {
    const atEdge = by < 0 ? index === 0 : index === count - 1;
    focusArrow.current = `${key}-${(by < 0) !== atEdge ? "up" : "down"}`;
  }

  /** Moves a user category up or down: shown at once, and saved straight away (reverted if that fails). */
  async function moveCategory(id: number, by: -1 | 1) {
    const userCategories = categories.filter((category) => !category.system);
    const next = moved(userCategories, id, by);
    if (!next) return;
    focusAfterMove(`category-${id}`, by, next.findIndex((c) => c.id === id), next.length);
    setOrderError(undefined);
    onCategoriesReordered([...next, ...categories.filter((category) => category.system)]);
    try {
      await api.reorderCategories(next.map((category) => category.id));
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        onSessionExpired();
        return;
      }
      setOrderError({ section: "categories", text: `The new order wasn't saved: ${error instanceof Error ? error.message : String(error)}` });
      onNotesChanged();
    }
  }

  /** Moves a tab up or down: shown at once, and saved straight away (reverted if that fails). */
  async function moveTab(id: number, by: -1 | 1) {
    const next = moved(tabs, id, by);
    if (!next) return;
    focusAfterMove(`tab-${id}`, by, next.findIndex((t) => t.id === id), next.length);
    setOrderError(undefined);
    onTabsReordered(next);
    try {
      await api.reorderTabs(next.map((tab) => tab.id));
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        onSessionExpired();
        return;
      }
      setOrderError({ section: "tabs", text: `The new order wasn't saved: ${error instanceof Error ? error.message : String(error)}` });
      onNotesChanged();
    }
  }
  const [busy, setBusy] = useState(false);
  /** Read by each canvas when it opens, so there's no need to pass it around. */
  const [penWidth, setPenWidth] = usePenWidth();
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
        <h2 id="pen-label">Pen</h2>
        <div className="pen-widths" role="radiogroup" aria-labelledby="pen-label">
          {PEN_WIDTHS.map((width) => (
            <button
              key={width}
              type="button"
              role="radio"
              aria-checked={penWidth === width}
              aria-label={`Pen thickness ${width}px`}
              className={penWidth === width ? "pen-width chosen" : "pen-width"}
              onClick={() => setPenWidth(width)}
            >
              {/* A sample line at this thickness. */}
              <span className="pen-sample" style={{ height: width }} />
              <span className="pen-size">{width}px</span>
            </button>
          ))}
        </div>
        <p>The thickness of lines drawn with the stylus. Remembered on this device only.</p>
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
              const userCategories = categories.filter((c) => !c.system);
              const index = userCategories.findIndex((c) => c.id === category.id);
              return (
                <li key={category.id}>
                  {/* The built-in Lifetime category can't be edited or moved (it's always last), so it isn't a link. */}
                  {category.system ? (
                    <span className="tab-entry">{details}</span>
                  ) : (
                    <a href={pathFor(page)} onClick={(event) => go(event, page)}>
                      {details}
                    </a>
                  )}
                  {category.system ? (
                    <span className="order-buttons" aria-hidden />
                  ) : (
                    <OrderButtons
                      name={category.name}
                      first={index === 0}
                      last={index === userCategories.length - 1}
                      onMove={(by) => void moveCategory(category.id, by)}
                      focusRef={focusRef(`category-${category.id}`)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {orderError?.section === "categories" && (
          <p className="save-error" role="alert">
            {orderError.text}
          </p>
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
            {/* "All" is always the first tab, so it can't be moved. */}
            <span className="order-buttons" aria-hidden />
          </li>
          {tabs.map((tab, index) => {
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
                <OrderButtons
                  name={tab.name}
                  first={index === 0}
                  last={index === tabs.length - 1}
                  onMove={(by) => void moveTab(tab.id, by)}
                  focusRef={focusRef(`tab-${tab.id}`)}
                />
              </li>
            );
          })}
        </ul>
        {orderError?.section === "tabs" && (
          <p className="save-error" role="alert">
            {orderError.text}
          </p>
        )}
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
