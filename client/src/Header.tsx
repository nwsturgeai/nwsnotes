import type { MouseEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGear, faSignature } from "@fortawesome/free-solid-svg-icons";
import { pathFor, type Page } from "./route";

interface Props {
  page: Page;
  stylusMode: boolean;
  onNavigate: (page: Page) => void;
  /** Set when a background reload of the notes failed. */
  refreshError?: string;
  onRetryRefresh: () => void;
}

/** The strip across the top of the app, plus a notice when the notes couldn't be reloaded. */
export function Header({ page, stylusMode, onNavigate, refreshError, onRetryRefresh }: Props) {
  function go(event: MouseEvent, target: Page) {
    event.preventDefault();
    onNavigate(target);
  }

  const back: { page: Page; label: string } | undefined =
    page.name === "settings"
      ? { page: { name: "notes" }, label: "← Notes" }
      : page.name === "category"
        ? { page: { name: "settings" }, label: "← Settings" }
        : undefined;

  return (
    <>
      <header className="app-header">
        {back ? (
          <a href={pathFor(back.page)} className="header-link" onClick={(event) => go(event, back.page)}>
            {back.label}
          </a>
        ) : (
          <span className="app-name">nwsnotes</span>
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
