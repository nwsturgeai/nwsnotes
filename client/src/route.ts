import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** The website's pages, each with its own address so the back button works. */
export type Page =
  /**
   * The notes, on a tab (undefined for "All"), with the long-form note open in the editor, if any ("new"
   * for one whose title hasn't been accepted yet). Each tab change, and each long-form note opened, is a
   * new history entry, so Back goes to the tab, or out of the note, before.
   */
  | { name: "notes"; tab?: number; note?: number | "new" }
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
    case "notes": {
      const query = [page.tab !== undefined && `tab=${page.tab}`, page.note !== undefined && `note=${page.note}`].filter(Boolean);
      return query.length > 0 ? `/?${query.join("&")}` : "/";
    }
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
  const params = new URLSearchParams(search);
  const tab = params.get("tab");
  const note = params.get("note");
  return {
    name: "notes",
    ...(tab !== null && /^\d+$/.test(tab) && { tab: Number(tab) }),
    ...(note === "new" ? { note: "new" as const } : note !== null && /^-?\d+$/.test(note) && { note: Number(note) }),
  };
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
 * stays as it is. Entries `skip` says are gone (a long-form note deleted by its Cancel) are passed over,
 * Back or Forward going on to the next; at the end of the history, the note is left out instead.
 */
export function usePage(
  blocked?: RefObject<boolean>,
  skip?: RefObject<((page: Page) => boolean) | undefined>,
): [Page, (page: Page, options?: { replace?: boolean; newEntry?: boolean }) => void] {
  const [page, setPage] = useState<Page>(currentPage);
  /** The current entry's place in the history. */
  const index = useRef(historyState().index ?? 0);
  /** Set while going back to where we were after a blocked Back or Forward. */
  const restoring = useRef(false);
  /** While passing over a gone entry: in case there's nothing beyond it, which the browser doesn't say. */
  const skipTimer = useRef<number>(undefined);

  useEffect(() => {
    // The entry the page opened on gets its place, so later ones count on from it.
    window.history.replaceState({ ...historyState(), index: index.current }, "");
    const onPopState = () => {
      window.clearTimeout(skipTimer.current);
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
      const next = currentPage();
      if (skip?.current?.(next)) {
        const step = now < index.current ? -1 : 1;
        index.current = now;
        // Nothing beyond it (the browser doesn't say, so no move soon): back to where we were, as if Back or
        // Forward did nothing.
        skipTimer.current = window.setTimeout(() => {
          restoring.current = true;
          window.history.go(-step);
        }, 500);
        window.history.go(step);
        return;
      }
      index.current = now;
      setPage(next);
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.clearTimeout(skipTimer.current);
    };
  }, [blocked, skip]);

  /** `newEntry`: always a new history entry (changing tab, opening a note), never going back to the page this one came from. */
  const navigate = useCallback((next: Page, options?: { replace?: boolean; newEntry?: boolean }) => {
    const path = pathFor(next);
    if (options?.replace) {
      // Still remembering where it was opened from.
      window.history.replaceState({ ...historyState(), index: index.current } satisfies HistoryState, "", path);
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
