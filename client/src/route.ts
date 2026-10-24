import { useCallback, useEffect, useState } from "react";

/** The website's pages, each with its own address so the back button works. */
export type Page = "notes" | "settings";

const PATHS: Record<Page, string> = { notes: "/", settings: "/settings" };

function pageFromPath(pathname: string): Page {
  return pathname === PATHS.settings ? "settings" : "notes";
}

/** History entries we add when opening settings, so "← Notes" can go back instead of adding another entry. */
interface HistoryState {
  fromNotes?: boolean;
}

/** The current page, and a function to go to another one. */
export function usePage(): [Page, (page: Page, options?: { replace?: boolean }) => void] {
  const [page, setPage] = useState<Page>(() => pageFromPath(window.location.pathname));

  useEffect(() => {
    const onPopState = () => setPage(pageFromPath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((next: Page, options?: { replace?: boolean }) => {
    const state = window.history.state as HistoryState | null;
    if (options?.replace) {
      window.history.replaceState(null, "", PATHS[next]);
    } else if (next === "notes" && state?.fromNotes) {
      // Settings was opened from the notes page: go back, as Android's back button would.
      window.history.back();
      return;
    } else if (window.location.pathname !== PATHS[next]) {
      const newState: HistoryState = { fromNotes: next === "settings" };
      window.history.pushState(newState, "", PATHS[next]);
    }
    setPage(next);
  }, []);

  return [page, navigate];
}
