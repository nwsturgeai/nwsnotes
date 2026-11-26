import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCloud, faEllipsis, faEye, faEyeSlash, faGear, faSignature, faSlash, faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";
import { ALL_TAB_NAME, type Category, type SharePermission, type Tab } from "@nwsnotes/shared";
import { reloadToUpdate } from "./appUpdate";
import { pathFor, type Page } from "./route";
import { SharingIcons, tabSharedOut } from "./sharingIcons";
import { useLeftTabsHidden } from "./stylusMode";

interface Props {
  page: Page;
  stylusMode: boolean;
  /** The tabs along the top (Left tabs are in the notes page's left strip). */
  tabs: Tab[];
  /** For the sharing icons on tabs that filter on tags you've shared. */
  categories: Category[];
  /** Whether the built-in "All" tab is along the top (rather than in the left strip). */
  allOnTop: boolean;
  /** Whether the notes page has a left strip (some tab is set to Left): the top tabs then line up with it. */
  leftStrip: boolean;
  /** With the Tab counts setting on: each tab's number of notes (by id; "all" for the All tab). */
  tabCounts?: Map<number | "all", number>;
  /** The selected tab's id, or undefined for the built-in "All" tab. */
  selectedTabId: number | undefined;
  /** Where "← Notes" goes: the notes as they were left (the tab, and any long-form note open). */
  notesPage?: Page;
  onSelectTab: (id: number | undefined) => void;
  /**
   * While a note being edited has no title (or in multi-select), the tabs and the Settings cog are
   * blocked. With a title, using them saves the note first (see NotesPage's `data-saves-edit`).
   */
  editing: boolean;
  onNavigate: (page: Page) => void;
  /** Set when a background reload of the notes failed. */
  refreshError?: string;
  onRetryRefresh: () => void;
  /** The server can't be reached: an icon says so, and Settings isn't available. */
  offline: boolean;
  /** Changes waiting to be sent, for the offline icon's tooltip. */
  pendingCount: number;
  /** A new version of the app is ready and nothing unsaved would be lost: offer "Reload". */
  showUpdateNotice: boolean;
  /** Admins only: account requests waiting to be confirmed. Above 0, a warning icon links to the users page. */
  accountsWaiting?: number;
}

/** Why the tabs and the cog can't be used while a note is being edited. */
const BLOCKED_HINT = "Finish or cancel the edit first";
export const OFFLINE_HINT = "Not available offline";

/** The strip across the top of the app, plus notices when the notes couldn't be reloaded or a new version is ready. */
export function Header({
  page,
  stylusMode,
  tabs,
  categories,
  allOnTop,
  leftStrip,
  tabCounts,
  selectedTabId,
  onSelectTab,
  editing,
  notesPage,
  onNavigate,
  refreshError,
  onRetryRefresh,
  offline,
  pendingCount,
  showUpdateNotice,
  accountsWaiting = 0,
}: Props) {
  const cogBlocked = editing || offline;
  const [leftTabsHidden, setLeftTabsHidden] = useLeftTabsHidden();
  const offlineTitle =
    pendingCount === 0 ? "Offline" : `Offline: ${pendingCount} ${pendingCount === 1 ? "change" : "changes"} waiting`;
  const waitingTitle = `${accountsWaiting} ${accountsWaiting === 1 ? "account is" : "accounts are"} waiting to be confirmed`;
  function go(event: MouseEvent, target: Page) {
    event.preventDefault();
    onNavigate(target);
  }

  const back: { page: Page; label: string } | undefined =
    page.name === "settings"
      ? { page: notesPage ?? { name: "notes", tab: selectedTabId }, label: "← Notes" }
      : page.name === "category" || page.name === "tab" || page.name === "history" || page.name === "password" || page.name === "users" || page.name === "serverLog"
        ? { page: { name: "settings" }, label: "← Settings" }
        : undefined;

  return (
    <>
      <header className={page.name === "notes" && leftStrip ? "app-header with-left-tabs" : "app-header"}>
        {/* Above the left strip, the strip's width and half the header's height: hides or shows the strip. */}
        {page.name === "notes" && leftStrip && (
          <button
            type="button"
            className="left-tabs-toggle"
            aria-label={leftTabsHidden ? "Show left tabs" : "Hide left tabs"}
            aria-pressed={leftTabsHidden}
            title={leftTabsHidden ? "Show left tabs" : "Hide left tabs"}
            onClick={() => setLeftTabsHidden(!leftTabsHidden)}
          >
            <FontAwesomeIcon icon={leftTabsHidden ? faEye : faEyeSlash} />
          </button>
        )}
        {page.name === "notes" && (
          <TabStrip
            tabs={tabs}
            categories={categories}
            allOnTop={allOnTop}
            tabCounts={tabCounts}
            selectedTabId={selectedTabId}
            onSelectTab={onSelectTab}
            editing={editing}
          />
        )}
        {back && (
          <a href={pathFor(back.page)} className="header-link" onClick={(event) => go(event, back.page)}>
            {back.label}
          </a>
        )}
        <div className="header-icons">
          {offline && (
            // Only shows the state; it isn't a button.
            // A cloud with a slash over it: fa-cloud-slash itself isn't in the free icons.
            <span className="offline-indicator" role="img" aria-label={offlineTitle} title={offlineTitle}>
              <FontAwesomeIcon icon={faCloud} />
              <FontAwesomeIcon icon={faSlash} className="offline-slash" />
            </span>
          )}
          {accountsWaiting > 0 && (
            // Goes to the users page, where the requests are confirmed or declined. Blocked like the cog.
            <a
              href={pathFor({ name: "users" })}
              className={cogBlocked ? "accounts-waiting blocked" : "accounts-waiting"}
              data-saves-edit
              aria-label={waitingTitle}
              aria-disabled={cogBlocked || undefined}
              title={offline ? OFFLINE_HINT : editing ? BLOCKED_HINT : waitingTitle}
              onClick={(event) => (cogBlocked ? event.preventDefault() : go(event, { name: "users" }))}
            >
              <FontAwesomeIcon icon={faTriangleExclamation} />
            </a>
          )}
          {stylusMode && (
            // Only shows the mode; it isn't a button.
            <span className="stylus-indicator" role="img" aria-label="Stylus mode is on" title="Stylus mode is on">
              <FontAwesomeIcon icon={faSignature} />
            </span>
          )}
          {page.name === "notes" && (
            <a
              href="/settings"
              className={cogBlocked ? "cog blocked" : "cog"}
              data-saves-edit
              aria-label="Settings"
              aria-disabled={cogBlocked || undefined}
              title={offline ? OFFLINE_HINT : editing ? BLOCKED_HINT : "Settings"}
              onClick={(event) => (cogBlocked ? event.preventDefault() : go(event, { name: "settings" }))}
            >
              <FontAwesomeIcon icon={faGear} />
            </a>
          )}
        </div>
      </header>
      {refreshError && (
        <div className="refresh-error" role="alert">
          <span>Couldn't load the latest notes: {refreshError}</span>
          <button type="button" onClick={onRetryRefresh}>
            Try again
          </button>
        </div>
      )}
      {showUpdateNotice && (
        <div className="update-notice" role="status">
          <span>A new version is ready.</span>
          <button type="button" onClick={reloadToUpdate}>
            Reload
          </button>
        </div>
      )}
    </>
  );
}

/** The gap between tabs (0.15rem), and the "…" button's width (2.25rem). */
const TAB_GAP_PX = 2.4;
const MORE_BUTTON_PX = 36;

/**
 * A tab as the strips show it; `count` (its number of notes) only with the Tab counts setting on, and
 * `sharedOut` when it filters on tags you've shared (the most any of their recipients may do).
 */
export type TabEntry = { id: number | undefined; name: string; count?: number; sharedOut?: SharePermission };

/** A tab's name and, with tab counts on, its count: only the name is cut short, so the count always shows. */
function TabLabel({ tab }: { tab: TabEntry }) {
  return (
    <>
      <span className="tab-name-text">{tab.name}</span>
      {tab.count !== undefined && <span className="tab-count">{`\u00a0(${tab.count})`}</span>}
      {tab.sharedOut && <SharingIcons permission={tab.sharedOut} />}
    </>
  );
}

/** A tab's name with its count, e.g. "All (153)", for menus. */
function tabText(tab: TabEntry): string {
  return tab.count === undefined ? tab.name : `${tab.name} (${tab.count})`;
}

/**
 * The tabs set to "Left": a narrow strip down the left of the filter row and note list, the names
 * reading from bottom to top (turned 90 degrees to the left). It scrolls when they don't all fit.
 */
export function LeftTabStrip({
  tabs,
  selectedTabId,
  onSelectTab,
  editing,
}: {
  tabs: TabEntry[];
  selectedTabId: number | undefined;
  onSelectTab: (id: number | undefined) => void;
  editing: boolean;
}) {
  return (
    <div className="left-tabs" role="tablist" aria-label="Left tabs" aria-orientation="vertical" data-saves-edit>
      {tabs.map((tab) => {
        const selected = tab.id === selectedTabId;
        return (
          <button
            key={tab.id ?? "all"}
            type="button"
            role="tab"
            className={selected ? "left-tab selected" : "left-tab"}
            aria-selected={selected}
            aria-disabled={(editing && !selected) || undefined}
            title={editing && !selected ? `${tab.name}: ${BLOCKED_HINT.toLowerCase()}` : tab.name}
            onClick={() => {
              if (!editing) onSelectTab(tab.id);
            }}
          >
            <span className="left-tab-name">
              <TabLabel tab={tab} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A key for a tab, for its measured width. */
function tabKey(tab: TabEntry): string {
  return String(tab.id ?? "all");
}

/**
 * Which tabs fit in `width`, each at its own width (`widths`, as measured). If they don't all fit, the
 * first ones that fit (leaving room for the "…" button) are shown and the rest are listed in its menu,
 * in their usual order. The selected tab is always shown: if it would be hidden, it takes the place of
 * as many of the last shown tabs as it needs.
 */
function splitTabs(
  all: TabEntry[],
  selectedId: number | undefined,
  width: number,
  widths: Map<string, number>,
): { shown: TabEntry[]; hidden: TabEntry[] } {
  const widthOf = (tab: TabEntry) => widths.get(tabKey(tab)) ?? 0;
  const span = (tabs: TabEntry[]) => tabs.reduce((sum, tab) => sum + widthOf(tab), 0) + Math.max(0, tabs.length - 1) * TAB_GAP_PX;
  if (span(all) <= width) return { shown: all, hidden: [] };
  const room = width - MORE_BUTTON_PX - TAB_GAP_PX;
  const shown: TabEntry[] = [];
  for (const tab of all) {
    if (span([...shown, tab]) > room) break;
    shown.push(tab);
  }
  const selected = all.find((tab) => tab.id === selectedId);
  if (selected && !shown.includes(selected)) {
    while (shown.length > 0 && span([...shown, selected]) > room) shown.pop();
    shown.push(selected);
  }
  // At least one tab, even if it has to be cut short.
  const first = all[0];
  if (shown.length === 0 && first) shown.push(first);
  return { shown, hidden: all.filter((tab) => !shown.includes(tab)) };
}

/**
 * The tabs, styled like a browser's: the selected one looks to be in front, joined to the note list.
 * Each tab is as wide as its name (up to a limit, beyond which the name is cut short: hover for the
 * full name). Tabs that don't fit move into a "…" menu at the end of the strip.
 *
 * To know how wide each tab is, the strip first shows every tab at its own width and measures them
 * (before anything is drawn), then shows only the ones that fit. It measures again when the tabs, their
 * counts or the selected tab (shown in bold) change, and once the fonts have loaded.
 */
function TabStrip({
  tabs,
  categories,
  allOnTop,
  tabCounts,
  selectedTabId,
  onSelectTab,
  editing,
}: Pick<Props, "tabs" | "categories" | "allOnTop" | "tabCounts" | "selectedTabId" | "onSelectTab" | "editing">) {
  const all: TabEntry[] = [
    ...(allOnTop ? [{ id: undefined, name: ALL_TAB_NAME, count: tabCounts?.get("all") }] : []),
    ...tabs.map((tab) => ({ id: tab.id, name: tab.name, count: tabCounts?.get(tab.id), sharedOut: tabSharedOut(tab, categories) })),
  ];
  const stripRef = useRef<HTMLDivElement>(null);
  /** The strip's width: the room the header leaves it (it doesn't depend on the tabs inside). */
  const [width, setWidth] = useState(Number.POSITIVE_INFINITY);
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const measure = () => setWidth(strip.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    return () => observer.disconnect();
  }, []);

  /** What the tabs' widths depend on: when it changes, they're measured again. */
  const measureKey = JSON.stringify([selectedTabId ?? null, all.map((tab) => [tab.id ?? null, tab.name, tab.count ?? null, tab.sharedOut ?? null])]);
  const [measured, setMeasured] = useState<{ key: string; widths: Map<string, number> }>();
  const measuring = measured?.key !== measureKey;
  useLayoutEffect(() => {
    if (!measuring || !stripRef.current) return;
    const widths = new Map<string, number>();
    for (const element of stripRef.current.querySelectorAll<HTMLElement>("[data-tab-key]")) {
      widths.set(element.dataset.tabKey!, element.getBoundingClientRect().width);
    }
    setMeasured({ key: measureKey, widths });
  }, [measuring, measureKey]);
  // Names are measured in the fallback font if the web font hasn't loaded yet: measure again once it has.
  useEffect(() => {
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (!cancelled) setMeasured(undefined);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const { shown, hidden } = measuring ? { shown: all, hidden: [] } : splitTabs(all, selectedTabId, width, measured.widths);
  const stripClass = ["tab-strip", measuring && "measuring"].filter(Boolean).join(" ");

  return (
    <div className={stripClass} role="tablist" aria-label="Tabs" ref={stripRef} data-saves-edit>
      {shown.map((tab) => {
        const selected = tab.id === selectedTabId;
        return (
          <button
            key={tabKey(tab)}
            data-tab-key={tabKey(tab)}
            type="button"
            role="tab"
            className={selected ? "tab selected" : "tab"}
            aria-selected={selected}
            aria-disabled={(editing && !selected) || undefined}
            title={editing && !selected ? `${tab.name}: ${BLOCKED_HINT.toLowerCase()}` : tab.name}
            onClick={() => {
              if (!editing) onSelectTab(tab.id);
            }}
          >
            <span className="tab-name">
              <TabLabel tab={tab} />
            </span>
          </button>
        );
      })}
      {hidden.length > 0 && (
        <MoreTabs
          tabs={hidden}
          editing={editing}
          onSelect={(id) => {
            if (!editing) onSelectTab(id);
          }}
        />
      )}
    </div>
  );
}

/**
 * The "…" button at the end of the tab strip, and its menu of the tabs that don't fit. Choosing one
 * selects it, so it moves into the strip (taking the last place there).
 */
function MoreTabs({ tabs, editing, onSelect }: { tabs: TabEntry[]; editing: boolean; onSelect: (id: number | undefined) => void }) {
  /** Where the open menu sits, on the window (below the button, lined up with its right edge). */
  const [position, setPosition] = useState<{ top: number; right: number }>();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const label = `${tabs.length} more ${tabs.length === 1 ? "tab" : "tabs"}`;

  function toggle() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (position || !rect || editing) {
      setPosition(undefined);
      return;
    }
    setPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  }

  // Close when clicking elsewhere, pressing Escape or resizing.
  useEffect(() => {
    if (!position) return;
    const close = () => setPosition(undefined);
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
    };
  }, [position]);

  return (
    <div className="tab-more" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="tab tab-more-button"
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={position !== undefined}
        aria-disabled={editing || undefined}
        title={editing ? `${label}: ${BLOCKED_HINT.toLowerCase()}` : label}
        onClick={toggle}
      >
        <FontAwesomeIcon icon={faEllipsis} />
      </button>
      {position && (
        <div className="tag-dropdown-list tab-more-list" role="menu" aria-label={label} style={{ top: position.top, right: position.right }}>
          {tabs.map((tab) => (
            <button
              key={tab.id ?? "all"}
              type="button"
              role="menuitem"
              className="tag-option"
              onClick={() => {
                setPosition(undefined);
                onSelect(tab.id);
              }}
            >
              {tabText(tab)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
