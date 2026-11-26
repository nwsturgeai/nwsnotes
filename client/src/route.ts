import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** The website's pages, each with its own address so the back button works. */
export type Page =
  /** The notes, on a tab (undefined for "All"): each tab change is a new history entry, so Back goes to the tab before. */
  | { name: "notes"; tab?: number }
  | { name: "settings" }
  /** The history of changes, where earlier states can be gone back to. */
  | { name: "history" }
  /** Changing your own password. */
  | { name: "password" }
  /** Changing your own display name. */
  | { name: "name" }
  /** Changing your own login email (by a link emailed to the new one). */
  | { name: "email" }
  /** The admin's users page. */
  | { name: "users" }
  /** The server's recent errors (admins only). */
  | { name: "serverLog" }
  /** Adding (id "new") or editing a category. */
  | { name: "category"; id: number | "new" }
  /** Adding (id "new") or editing a tab; "all" is the built-in tab, whose only setting is where it shows. */
  | { name: "tab"; id: number | "new" | "all" };

export function pathFor(page: Page): string {
  switch (page.name) {
    case "notes":
      return page.tab === undefined ? "/" : `/?tab=${page.tab}`;
    case "settings":
      return "/settings";
    case "history":
      return "/history";
    case "password":
      return "/settings/password";
    case "name":
      return "/settings/name";
    case "email":
      return "/settings/email";
    case "users":
      return "/settings/users";
    case "serverLog":
      return "/settings/server-errors";
    case "category":
      return `/settings/categories/${page.id}`;
    case "tab":
      return `/settings/tabs/${page.id}`;
  }
}

/** The page at an address (its path and query, e.g. "/?tab=3"). */
function pageFromAddress(pathname: string, search: string): Page {
  if (pathname === "/settings") return { name: "settings" };
  if (pathname === "/history") return { name: "history" };
  if (pathname === "/settings/password") return { name: "password" };
  if (pathname === "/settings/name") return { name: "name" };
  if (pathname === "/settings/email") return { name: "email" };
  if (pathname === "/settings/users") return { name: "users" };
  if (pathname === "/settings/server-errors") return { name: "serverLog" };
  if (pathname === "/settings/tabs/all") return { name: "tab", id: "all" };
  // Category -2 is "Shared with me" (its tags' order and colours).
  const match = /^\/settings\/(categories|tabs)\/(new|-?\d+)$/.exec(pathname);
  if (match) {
    const id = match[2] === "new" ? "new" : Number(match[2]);
    return match[1] === "tabs" ? { name: "tab", id } : { name: "category", id };
  }
  const tab = new URLSearchParams(search).get("tab");
  return tab !== null && /^\d+$/.test(tab) ? { name: "notes", tab: Number(tab) } : { name: "notes" };
}

function currentPage(): Page {
  return pageFromAddress(window.location.pathname, window.location.search);
}

function currentAddress(): string {
  return window.location.pathname + window.location.search;
}

/**
 * Each history entry we add remembers the address it was opened from, and its place in the history (0
 * for the first, counting up), so going back or forward can be undone while it's blocked.
 */
interface HistoryState {
  from?: string;
  index?: number;
}

function historyState(): HistoryState {
  return (window.history.state as HistoryState | null) ?? {};
}

/**
 * The current page, and a function to go to another one. While `blocked` holds true (a note is being
 * edited, or notes are being selected, so the tabs can't be used), Back and Forward are undone: the page
 * stays as it is.
 */
export function usePage(
  blocked?: RefObject<boolean>,
): [Page, (page: Page, options?: { replace?: boolean; newEntry?: boolean }) => void] {
  const [page, setPage] = useState<Page>(currentPage);
  /** The current entry's place in the history. */
  const index = useRef(historyState().index ?? 0);
  /** Set while going back to where we were after a blocked Back or Forward. */
  const restoring = useRef(false);

  useEffect(() => {
    // The entry the page opened on gets its place, so later ones count on from it.
    window.history.replaceState({ ...historyState(), index: index.current }, "");
    const onPopState = () => {
      const now = historyState().index ?? 0;
      if (restoring.current) {
        restoring.current = false;
        index.current = now;
        return;
      }
      if (blocked?.current && now !== index.current) {
        restoring.current = true;
        window.history.go(index.current - now);
        return;
      }
      index.current = now;
      setPage(currentPage());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [blocked]);

  /** `newEntry`: always a new history entry (changing tab), never going back to the page this one came from. */
  const navigate = useCallback((next: Page, options?: { replace?: boolean; newEntry?: boolean }) => {
    const path = pathFor(next);
    if (options?.replace) {
      window.history.replaceState({ index: index.current } satisfies HistoryState, "", path);
    } else if (!options?.newEntry && historyState().from === path) {
      // Going back to the page this one was opened from: go back, as Android's back button would.
      window.history.back();
      return;
    } else if (currentAddress() !== path) {
      index.current += 1;
      window.history.pushState({ from: currentAddress(), index: index.current } satisfies HistoryState, "", path);
    }
    setPage(next);
  }, []);

  return [page, navigate];
}
