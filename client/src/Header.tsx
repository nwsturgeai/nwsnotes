import type { MouseEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCloud, faGear, faSignature, faSlash } from "@fortawesome/free-solid-svg-icons";
import { ALL_TAB_NAME, type Tab } from "@nwsnotes/shared";
import { pathFor, type Page } from "./route";

interface Props {
  page: Page;
  stylusMode: boolean;
  tabs: Tab[];
  /** The selected tab's id, or undefined for the built-in "All" tab. */
  selectedTabId: number | undefined;
  onSelectTab: (id: number | undefined) => void;
  /** While a note is being edited, the tabs and the Settings cog are blocked. */
  editing: boolean;
  onNavigate: (page: Page) => void;
  /** Set when a background reload of the notes failed. */
  refreshError?: string;
  onRetryRefresh: () => void;
  /** The server can't be reached: an icon says so, and Settings isn't available. */
  offline: boolean;
  /** Changes waiting to be sent, for the offline icon's tooltip. */
  pendingCount: number;
}

/** Why the tabs and the cog can't be used while a note is being edited. */
const BLOCKED_HINT = "Finish or cancel the edit first";
export const OFFLINE_HINT = "Not available offline";

/** The strip across the top of the app, plus a notice when the notes couldn't be reloaded. */
export function Header({
  page,
  stylusMode,
  tabs,
  selectedTabId,
  onSelectTab,
  editing,
  onNavigate,
  refreshError,
  onRetryRefresh,
  offline,
  pendingCount,
}: Props) {
  const cogBlocked = editing || offline;
  const offlineTitle =
    pendingCount === 0 ? "Offline" : `Offline: ${pendingCount} ${pendingCount === 1 ? "change" : "changes"} waiting`;
  function go(event: MouseEvent, target: Page) {
    event.preventDefault();
    onNavigate(target);
  }

  const back: { page: Page; label: string } | undefined =
    page.name === "settings"
      ? { page: { name: "notes" }, label: "← Notes" }
      : page.name === "category" || page.name === "tab"
        ? { page: { name: "settings" }, label: "← Settings" }
        : undefined;

  return (
    <>
      <header className="app-header">
        {page.name === "notes" && (
          <TabStrip tabs={tabs} selectedTabId={selectedTabId} onSelectTab={onSelectTab} editing={editing} />
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
    </>
  );
}

/**
 * The tabs, styled like a browser's: the selected one looks to be in front, joined to the note list.
 * If they don't all fit, every tab shrinks equally and long names are cut short (hover for the full name).
 */
function TabStrip({
  tabs,
  selectedTabId,
  onSelectTab,
  editing,
}: Pick<Props, "tabs" | "selectedTabId" | "onSelectTab" | "editing">) {
  const all: { id: number | undefined; name: string }[] = [{ id: undefined, name: ALL_TAB_NAME }, ...tabs];
  return (
    <div className="tab-strip" role="tablist" aria-label="Tabs">
      {all.map((tab) => {
        const selected = tab.id === selectedTabId;
        return (
          <button
            key={tab.id ?? "all"}
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
            <span className="tab-name">{tab.name}</span>
          </button>
        );
      })}
    </div>
  );
}
