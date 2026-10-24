import type { MouseEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGear, faSignature } from "@fortawesome/free-solid-svg-icons";
import { ALL_TAB_NAME, type Tab } from "@nwsnotes/shared";
import { pathFor, type Page } from "./route";

interface Props {
  page: Page;
  stylusMode: boolean;
  tabs: Tab[];
  /** The selected tab's id, or undefined for the built-in "All" tab. */
  selectedTabId: number | undefined;
  onSelectTab: (id: number | undefined) => void;
  onNavigate: (page: Page) => void;
  /** Set when a background reload of the notes failed. */
  refreshError?: string;
  onRetryRefresh: () => void;
}

/** The strip across the top of the app, plus a notice when the notes couldn't be reloaded. */
export function Header({
  page,
  stylusMode,
  tabs,
  selectedTabId,
  onSelectTab,
  onNavigate,
  refreshError,
  onRetryRefresh,
}: Props) {
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
          <TabStrip tabs={tabs} selectedTabId={selectedTabId} onSelectTab={onSelectTab} />
        )}
        {back && (
          <a href={pathFor(back.page)} className="header-link" onClick={(event) => go(event, back.page)}>
            {back.label}
          </a>
        )}
        <div className="header-icons">
          {stylusMode && (
            // Only shows the mode; it isn't a button.
            <span className="stylus-indicator" role="img" aria-label="Stylus mode is on" title="Stylus mode is on">
              <FontAwesomeIcon icon={faSignature} />
            </span>
          )}
          {page.name === "notes" && (
            <a
              href="/settings"
              className="cog"
              aria-label="Settings"
              title="Settings"
              onClick={(event) => go(event, { name: "settings" })}
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
function TabStrip({ tabs, selectedTabId, onSelectTab }: Pick<Props, "tabs" | "selectedTabId" | "onSelectTab">) {
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
            title={tab.name}
            onClick={() => onSelectTab(tab.id)}
          >
            <span className="tab-name">{tab.name}</span>
          </button>
        );
      })}
    </div>
  );
}
