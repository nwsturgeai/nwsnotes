import { useEffect, useRef, useState, type MouseEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowDown, faArrowUp } from "@fortawesome/free-solid-svg-icons";
import { formatBytes } from "./sizes";
import {
  ALL_TAB_NAME,
  formatPhoneNumber,
  lifetimeOf,
  CATEGORIES_MAX,
  LIFETIME_ARCHIVED,
  LIFETIME_BIN,
  LIFETIME_NEW,
  NOTE_LIMIT_SHOWN_FROM,
  TABS_MAX,
  type Category,
  type Me,
  type Note,
  type NoteStats,
  type SmsLinkCode,
  type SmsStatus,
  type Tab,
  type TabPlacement,
} from "@nwsnotes/shared";
import { ApiError, api } from "./api";
import { buildTime, checkForUpdate, reloadToUpdate, updatesAvailable, useUpdateReady } from "./appUpdate";
import { reminderState, turnOffReminders, turnOnReminders, type ReminderState } from "./reminders";
import { hueColour } from "./colours";
import { ConfirmDialog } from "./ConfirmDialog";
import { pathFor, type Page } from "./route";
import { COLUMN_CHOICES, PEN_WIDTHS, usePenWidth, type ColumnsChoice } from "./stylusMode";
import { DragGrip, draggedStyle, rowsWithGap, useListDrag } from "./listDrag";
import { TagPills } from "./TagPills";

interface Props {
  notes: Note[];
  /** All categories, including the built-in Lifetime one. */
  categories: Category[];
  tabs: Tab[];
  /** Where the built-in "All" tab shows. */
  allTabPlacement: TabPlacement;
  stylusMode: boolean;
  onStylusModeChange: (on: boolean) => void;
  columns: ColumnsChoice;
  onColumnsChange: (columns: ColumnsChoice) => void;
  tabCounts: boolean;
  onTabCountsChange: (on: boolean) => void;
  onNavigate: (page: Page) => void;
  /** Called after a Lifetime button changed notes, to reload them. */
  onNotesChanged: () => void;
  /** The categories or tabs were put in a new order (shown straight away, before it's saved). */
  onCategoriesReordered: (categories: Category[]) => void;
  onTabsReordered: (tabs: Tab[]) => void;
  onSessionExpired: () => void;
  onLogout: () => void;
  /** Who is logged in. */
  me: Me;
  /** Changes made offline and not yet sent: logging out would lose them, so it asks first. */
  pendingCount: number;
  /** A message to show at the top (e.g. after changing the password). */
  notice?: string;
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

/** `items` with the one with this id moved to `target`, its index among the others (a drop). */
function movedTo<T extends { id: number }>(items: T[], id: number, target: number): T[] | undefined {
  const moving = items.find((item) => item.id === id);
  if (!moving) return undefined;
  const others = items.filter((item) => item.id !== id);
  return [...others.slice(0, target), moving, ...others.slice(target)];
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
  allTabPlacement,
  stylusMode,
  onStylusModeChange,
  columns,
  onColumnsChange,
  tabCounts,
  onTabCountsChange,
  onNavigate,
  onNotesChanged,
  onCategoriesReordered,
  onTabsReordered,
  onSessionExpired,
  onLogout,
  me,
  pendingCount,
  notice,
}: Props) {
  const [confirmingLogout, setConfirmingLogout] = useState(false);
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

  /** Moves a user category up or down with its arrows. */
  function moveCategory(id: number, by: -1 | 1) {
    const next = moved(categories.filter((category) => !category.system), id, by);
    if (!next) return;
    focusAfterMove(`category-${id}`, by, next.findIndex((c) => c.id === id), next.length);
    void saveCategoryOrder(next);
  }

  /** The user categories in a new order (arrows or a drop): shown at once, and saved straight away (reverted if that fails). */
  async function saveCategoryOrder(next: Category[]) {
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

  /** Moves a tab up or down with its arrows. */
  function moveTab(id: number, by: -1 | 1) {
    const next = moved(tabs, id, by);
    if (!next) return;
    focusAfterMove(`tab-${id}`, by, next.findIndex((t) => t.id === id), next.length);
    void saveTabOrder(next);
  }

  /** The tabs in a new order (arrows or a drop): shown at once, and saved straight away (reverted if that fails). */
  async function saveTabOrder(next: Tab[]) {
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
  /** Dragging categories and tabs by their grips (the shared list drag); a drop is saved straight away. */
  const userCategories = categories.filter((category) => !category.system);
  const systemCategories = categories.filter((category) => category.system);
  const categoryListRef = useRef<HTMLUListElement>(null);
  const tabListRef = useRef<HTMLUListElement>(null);
  const { drag: categoryDrag, gripHandlers: categoryGrip } = useListDrag(categoryListRef, (id, target) => {
    const next = movedTo(userCategories, id, target);
    if (next) void saveCategoryOrder(next);
  });
  const { drag: tabDrag, gripHandlers: tabGrip } = useListDrag(tabListRef, (id, target) => {
    const next = movedTo(tabs, id, target);
    if (next) void saveTabOrder(next);
  });
  /** Your number of notes and their size, fetched when the page opens and whenever the notes change. */
  const [stats, setStats] = useState<NoteStats | "failed">();
  useEffect(() => {
    let current = true;
    api
      .myStats()
      .then((found) => current && setStats(found))
      .catch(() => current && setStats("failed"));
    return () => {
      current = false;
    };
  }, [notes]);
  const [busy, setBusy] = useState(false);
  /** Read by each canvas when it opens, so there's no need to pass it around. */
  const [penWidth, setPenWidth] = usePenWidth();
  /** The result of the last Lifetime button, shown under the buttons. */
  const [result, setResult] = useState<{ text: string; error?: boolean }>();

  function go(event: MouseEvent, target: Page) {
    event.preventDefault();
    onNavigate(target);
  }

  // Each Lifetime button shows how many notes it would change, e.g. "Empty Bin (4)".
  const newCount = notes.filter((note) => lifetimeOf(note) === LIFETIME_NEW).length;
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

      {/* The help pages are their own pages (not part of the app), so this is a plain link. */}
      <section>
        <h2>Help</h2>
        <p>How to use nwsnotes, from the basics to every feature.</p>
        <a className="button" href="/docs/">
          Help pages
        </a>
      </section>

      {/* How many notes you have and the space they take; nothing if it can't be found out. */}
      {stats !== "failed" && (
        <p className="note-stats">
          {stats ? (
            <>
              {/* The limit only shows once they're near it. */}
              {stats.noteCount >= stats.noteLimit * NOTE_LIMIT_SHOWN_FROM ? (
                <>
                  You have <strong>{stats.noteCount}</strong> of your{" "}
                  <strong>{plural(stats.noteLimit, "note")}</strong>
                </>
              ) : (
                <>
                  You have <strong>{plural(stats.noteCount, "note")}</strong>
                </>
              )}
              , taking up <strong>{formatBytes(stats.noteBytes)}</strong>, plus <strong>{formatBytes(stats.historyBytes)}</strong> for
              their History.
              {/* Likewise the stylus-note limit. */}
              {stats.stylusNoteCount >= stats.stylusNoteLimit * NOTE_LIMIT_SHOWN_FROM && (
                <>
                  {" "}
                  You have <strong>{stats.stylusNoteCount}</strong> of your <strong>{plural(stats.stylusNoteLimit, "stylus note")}</strong>.
                </>
              )}
            </>
          ) : (
            "You have … notes, taking up …"
          )}
        </p>
      )}
      {notice && (
        <p className="lifetime-result" role="status">
          {notice}
        </p>
      )}

      {/* Stylus mode, Columns and Tab counts side by side; all are remembered on this device only. */}
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
            {COLUMN_CHOICES.map((choice) => (
              <button
                key={choice.value}
                type="button"
                role="radio"
                aria-checked={columns === choice.value}
                className={columns === choice.value ? "column-choice chosen" : "column-choice"}
                onClick={() => onColumnsChange(choice.value)}
              >
                {choice.label}
              </button>
            ))}
          </div>
          <p>One column, or as many as fit at that width.</p>
        </div>
        <div>
          <label className="switch">
            <input type="checkbox" role="switch" checked={tabCounts} onChange={(event) => onTabCountsChange(event.target.checked)} />
            <span className="switch-track" aria-hidden="true" />
            <span className="switch-label">Tab counts</span>
          </label>
          <p>Show each tab's number of notes beside its name.</p>
        </div>
        <p className="device-note">These settings are remembered on this device only.</p>
      </section>

      {/* Only in stylus mode, which is when there's writing to do. */}
      {stylusMode && (
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
      )}

      <section>
        <h2>History</h2>
        <p>See your last 500 changes from the past 30 days, and go back to how things were after any of them.</p>
        <a className="button" href={pathFor({ name: "history" })} onClick={(event) => go(event, { name: "history" })}>
          History
        </a>
      </section>

      <section>
        <h2>Backup</h2>
        <p>Download a file with all your notes, categories, tags and tabs.</p>
        {/* A plain link: the session cookie is sent with it, and the server names the file. */}
        <a className="button" href="/api/notes/download" download>
          Download backup
        </a>
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
            Reset New ({newCount})
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
            Archived to Bin ({archivedCount})
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
            Empty Bin ({binCount})
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
          <ul className="category-list" ref={categoryListRef}>
            {[...rowsWithGap(userCategories, (c) => c.id, categoryDrag), ...systemCategories.map((item) => ({ item }))].map((row) => {
              if ("gap" in row) return <li key="drag-gap" className="drag-gap" style={{ height: row.gap }} aria-hidden />;
              const category = row.item;
              const details = (
                <>
                  <span className="category-name">{category.name}</span>
                  {category.system && <span className="category-kind">built-in</span>}
                  {category.multiSelect && <span className="category-kind">multi-select</span>}
                  <span className="category-tags">
                    {category.tags.map((tag, index) => (
                      <span key={tag.id}>
                        {index > 0 && ", "}
                        {/* A tag with a colour has a small box of it before its name. */}
                        {tag.hue !== undefined && (
                          <span className="hue-dot" style={{ background: hueColour(tag.hue, "swatch") }} aria-hidden />
                        )}
                        {tag.name}
                      </span>
                    ))}
                  </span>
                </>
              );
              const page: Page = { name: "category", id: category.id };
              const index = userCategories.findIndex((c) => c.id === category.id);
              const dragging = categoryDrag?.id === category.id;
              return (
                <li
                  key={category.id}
                  {...(!category.system && { "data-drag-id": category.id })}
                  className={dragging ? "dragging" : undefined}
                  style={dragging ? draggedStyle(categoryDrag) : undefined}
                >
                  {category.system ? (
                    <span className="drag-grip-space" aria-hidden />
                  ) : (
                    <DragGrip label={`Drag ${category.name}`} handlers={categoryGrip(category.id)} />
                  )}
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
        {userCategories.length >= CATEGORIES_MAX ? (
          <p className="hint">You have the most categories you can ({CATEGORIES_MAX}). Delete one to add another.</p>
        ) : (
          <a
            className="button"
            href={pathFor({ name: "category", id: "new" })}
            onClick={(event) => go(event, { name: "category", id: "new" })}
          >
            Add category
          </a>
        )}
      </section>

      <section>
        <h2>Tabs</h2>
        <p>A tab shows only the notes with the tags it lists. Click a tab to change or delete it.</p>
        <ul className="category-list" ref={tabListRef}>
          <li>
            {/* "All" is always the first tab, so it can't be moved. */}
            <span className="drag-grip-space" aria-hidden />
            {/* The built-in tab: its page only sets where it shows. */}
            <a href={pathFor({ name: "tab", id: "all" })} onClick={(event) => go(event, { name: "tab", id: "all" })}>
              <span className="category-name">{ALL_TAB_NAME}</span>
              {allTabPlacement === "left" && <span className="category-kind">left</span>}
              <span className="category-tags">Always shows every note</span>
            </a>
            {/* "All" is always the first tab, so it can't be moved. */}
            <span className="order-buttons" aria-hidden />
          </li>
          {rowsWithGap(tabs, (tab) => tab.id, tabDrag).map((row) => {
            if ("gap" in row) return <li key="drag-gap" className="drag-gap" style={{ height: row.gap }} aria-hidden />;
            const tab = row.item;
            const index = tabs.indexOf(tab);
            const page: Page = { name: "tab", id: tab.id };
            const dragging = tabDrag?.id === tab.id;
            return (
              <li
                key={tab.id}
                data-drag-id={tab.id}
                className={dragging ? "dragging" : undefined}
                style={dragging ? draggedStyle(tabDrag) : undefined}
              >
                <DragGrip label={`Drag ${tab.name}`} handlers={tabGrip(tab.id)} />
                <a href={pathFor(page)} onClick={(event) => go(event, page)}>
                  <span className="category-name">{tab.name}</span>
                  {tab.spokenName && <span className="spoken-name">({tab.spokenName})</span>}
                  {tab.placement === "left" && <span className="category-kind">left</span>}
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
        {tabs.length >= TABS_MAX ? (
          <p className="hint">You have the most tabs you can ({TABS_MAX}). Delete one to add another.</p>
        ) : (
          <a
            className="button"
            href={pathFor({ name: "tab", id: "new" })}
            onClick={(event) => go(event, { name: "tab", id: "new" })}
          >
            Add tab
          </a>
        )}
      </section>

      <AppVersion />

      <Reminders />

      <TextMessages notes={notes} tabs={tabs} onSessionExpired={onSessionExpired} />

      {me.admin && (
        <section>
          <h2>Users</h2>
          <p>Add people, reset their passwords, and turn accounts off and on.</p>
          <a className="button" href={pathFor({ name: "users" })} onClick={(event) => go(event, { name: "users" })}>
            Manage users
          </a>
        </section>
      )}

      <section>
        <h2>Account</h2>
        <p>
          Logged in as {me.displayName} ({me.loginName})
        </p>
        <div className="lifetime-buttons">
          <button type="button" className="button" onClick={() => onNavigate({ name: "password" })}>
            Change password
          </button>
          <button type="button" className="button" onClick={() => (pendingCount > 0 ? setConfirmingLogout(true) : onLogout())}>
            Log out
          </button>
        </div>
        {confirmingLogout && (
          <ConfirmDialog
            message={`${pendingCount} ${pendingCount === 1 ? "change hasn't" : "changes haven't"} been saved to the server yet. Log out anyway and lose them?`}
            confirmLabel="Log out"
            onConfirm={() => {
              setConfirmingLogout(false);
              onLogout();
            }}
            onCancel={() => setConfirmingLogout(false)}
          />
        )}
      </section>
    </main>
  );
}

const REMINDER_TEXT: Record<ReminderState, string> = {
  unavailable: "Reminders aren't available in development.",
  blocked: "This browser blocks notifications from this site. Allow them in the browser's site settings to get reminders.",
  on: "This device gets a notification when a note falls due.",
  off: "This device doesn't get reminders when notes fall due.",
};

/** Whether this device gets due-date reminders, with buttons to turn them on or off and to send a test. */
function Reminders() {
  const [state, setState] = useState<ReminderState>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; error?: boolean }>();

  useEffect(() => {
    let current = true;
    reminderState()
      .then((next) => current && setState(next))
      .catch(() => current && setState("off"));
    return () => {
      current = false;
    };
  }, []);

  async function run(action: () => Promise<string | void>) {
    setBusy(true);
    setResult(undefined);
    try {
      const text = await action();
      if (text) setResult({ text });
    } catch (error) {
      setResult({ text: error instanceof Error ? error.message : String(error), error: true });
    } finally {
      setBusy(false);
    }
  }

  // "unavailable" in development: the browser in other cases may still lack push support.
  const text = state === "unavailable" && !import.meta.env.DEV ? "This browser can't show reminders." : state && REMINDER_TEXT[state];

  return (
    <section>
      <h2>Reminders</h2>
      <p>{text ?? "Checking…"}</p>
      <div className="lifetime-buttons">
        {(state === "on" || state === "off") && (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => void run(async () => setState(await (state === "on" ? turnOffReminders() : turnOnReminders())))}
          >
            {state === "on" ? "Turn off" : "Turn on"}
          </button>
        )}
        {state === "on" && (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const { count } = await api.pushTest();
                return `Test reminder sent to ${plural(count, "device")}.`;
              })
            }
          >
            Send test
          </button>
        )}
      </div>
      {result && (
        <p className={result.error ? "save-error" : "lifetime-result"} role="status">
          {result.text}
        </p>
      )}
    </section>
  );
}

/**
 * Adding notes by text message: link this person's phone to their account with a code texted to the
 * nwsnotes number. Hidden when the server doesn't have text messages set up (it answers 404).
 */
function TextMessages({ notes, tabs, onSessionExpired }: { notes: Note[]; tabs: Tab[]; onSessionExpired: () => void }) {
  const [status, setStatus] = useState<SmsStatus | "off">();
  const [code, setCode] = useState<SmsLinkCode>();
  const [confirmingUnlink, setConfirmingUnlink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [devicesNotified, setDevicesNotified] = useState<boolean>();

  // Fetched when the page opens, and again whenever the notes change: a phone being linked tells this page
  // to reload (a live update), so it then shows as linked.
  useEffect(() => {
    let current = true;
    api
      .smsStatus()
      .then((found) => {
        if (!current) return;
        setStatus(found);
        if (found.linked) setCode(undefined);
      })
      .catch((err: unknown) => {
        if (!current) return;
        if (err instanceof ApiError && err.isUnauthorized) onSessionExpired();
        else if (err instanceof ApiError && err.status === 404) setStatus("off");
      });
    return () => {
      current = false;
    };
  }, [notes, onSessionExpired]);

  useEffect(() => {
    reminderState()
      .then((state) => setDevicesNotified(state === "on"))
      .catch(() => setDevicesNotified(false));
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (err) {
      if (err instanceof ApiError && err.isUnauthorized) {
        onSessionExpired();
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (status === undefined || status === "off") return null;
  const smsNumber = formatPhoneNumber(status.smsNumber);
  const exampleTab = tabs[0]?.spokenName ?? tabs[0]?.name ?? "Shopping";

  return (
    <section className="text-messages">
      <h2>Text messages</h2>
      <p>
        Add notes by texting them to {smsNumber}, e.g. by saying "Hey Google, send a text to nwsnotes: {exampleTab}, buy
        milk" in the car. Start a text with a tab's name (or its spoken name) to put the note in that tab.
      </p>
      {status.linked ? (
        <>
          <p>
            Linked to <strong>{formatPhoneNumber(status.phoneNumber)}</strong>. Save {smsNumber} in that phone's contacts as
            "nwsnotes".
          </p>
          <button type="button" className="button" disabled={busy} onClick={() => setConfirmingUnlink(true)}>
            Unlink
          </button>
        </>
      ) : code ? (
        <p className="sms-code" role="status">
          Text <strong className="sms-code-digits">{code.code}</strong> to{" "}
          <a href={`sms:${code.smsNumber}?body=${code.code}`}>{smsNumber}</a> from your phone. The code works for 15
          minutes.
        </p>
      ) : (
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => void run(async () => setCode(await api.smsLinkCode()))}
        >
          Link my phone
        </button>
      )}
      {devicesNotified === false && (
        <p className="hint">Turn on reminders on this device to be told about each note you text.</p>
      )}
      {error && (
        <p className="save-error" role="alert">
          {error}
        </p>
      )}
      {confirmingUnlink && status.linked && (
        <ConfirmDialog
          message={`Unlink ${formatPhoneNumber(status.phoneNumber)}? Texts from it will no longer add notes.`}
          confirmLabel="Unlink"
          onConfirm={() => {
            setConfirmingUnlink(false);
            void run(async () => setStatus(await api.smsUnlink()));
          }}
          onCancel={() => setConfirmingUnlink(false)}
        />
      )}
    </section>
  );
}

// E.g. "30 Oct 2026, 14:05", in this device's time zone.
const buildTimeText = buildTime.toLocaleString("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Which version is running (when it was built), and a button to check for a new one straight away. */
function AppVersion() {
  const updateReady = useUpdateReady();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ upToDate: true } | { error: string }>();

  async function check() {
    setChecking(true);
    setResult(undefined);
    try {
      // A new version shows its own line below, via useUpdateReady.
      if (!(await checkForUpdate())) setResult({ upToDate: true });
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      setChecking(false);
    }
  }

  return (
    <section>
      <h2>App version</h2>
      <p>Version: {buildTimeText}</p>
      <button type="button" className="button" disabled={!updatesAvailable || checking} onClick={() => void check()}>
        {checking ? "Checking…" : "Check for updates"}
      </button>
      {!updatesAvailable ? (
        <p className="lifetime-result">Updates aren't available in development.</p>
      ) : updateReady ? (
        <p className="lifetime-result update-ready">
          A new version is ready.
          <button type="button" className="button" onClick={reloadToUpdate}>
            Reload
          </button>
        </p>
      ) : result && "error" in result ? (
        <p className="save-error" role="alert">
          Couldn't check for updates: {result.error}
        </p>
      ) : result ? (
        <p className="lifetime-result">You have the latest version.</p>
      ) : null}
    </section>
  );
}
