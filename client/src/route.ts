import { useCallback, useEffect, useState } from "react";

/** The website's pages, each with its own address so the back button works. */
export type Page =
  | { name: "notes" }
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
      return "/";
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

function pageFromPath(pathname: string): Page {
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
  return { name: "notes" };
}

/** Each history entry we add remembers the address it was opened from. */
interface HistoryState {
  from?: string;
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
    const path = pathFor(next);
    const state = window.history.state as HistoryState | null;
    if (options?.replace) {
      window.history.replaceState(null, "", path);
    } else if (state?.from === path) {
      // Going back to the page this one was opened from: go back, as Android's back button would.
      window.history.back();
      return;
    } else if (window.location.pathname !== path) {
      const newState: HistoryState = { from: window.location.pathname };
      window.history.pushState(newState, "", path);
    }
    setPage(next);
  }, []);

  return [page, navigate];
}
