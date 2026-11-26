import { useCallback, useEffect, useState } from "react";
import type { TagSelection } from "./TagPickers";

/** Local-storage key for a tab's additional filters ("all" for the built-in tab). */
function storageKey(tabId: number | undefined): string {
  return `nwsnotes.extraFilters.${tabId ?? "all"}`;
}

function load(tabId: number | undefined): TagSelection {
  try {
    const stored = window.localStorage.getItem(storageKey(tabId));
    const parsed: unknown = stored ? JSON.parse(stored) : {};
    return typeof parsed === "object" && parsed !== null ? (parsed as TagSelection) : {};
  } catch {
    // Storage can be unavailable (e.g. blocked site data); the choices then last until reload.
    return {};
  }
}

/**
 * The selected tab's additional filters (the dropdown row above the note list). Each tab keeps its
 * own choices, remembered on this device, and they come back the next time the tab is opened.
 */
export function useExtraFilters(tabId: number | undefined): [TagSelection, (selection: TagSelection) => void] {
  const [state, setState] = useState(() => ({ tabId, selection: load(tabId) }));
  // Switching tab loads that tab's saved choices.
  useEffect(() => {
    if (state.tabId !== tabId) setState({ tabId, selection: load(tabId) });
  }, [tabId, state.tabId]);

  const set = useCallback(
    (selection: TagSelection) => {
      setState({ tabId, selection });
      try {
        window.localStorage.setItem(storageKey(tabId), JSON.stringify(selection));
      } catch {
        // See load().
      }
    },
    [tabId],
  );

  return [state.tabId === tabId ? state.selection : load(tabId), set];
}

/** Local-storage key for which categories a tab's add area shows as dropdowns ("all" for the built-in tab). */
function collapsedKey(tabId: number | undefined): string {
  return `nwsnotes.collapsedCategories.${tabId ?? "all"}`;
}

function loadCollapsed(tabId: number | undefined): number[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(collapsedKey(tabId)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is number => Number.isInteger(id)) : [];
  } catch {
    return [];
  }
}

/**
 * The categories the add/edit area shows as a dropdown rather than pills, for the selected tab. Every
 * category starts as pills (new ones too). Each tab keeps its own, remembered on this device.
 */
export function useCollapsedCategories(tabId: number | undefined): [number[], (categoryIds: number[]) => void] {
  const [state, setState] = useState(() => ({ tabId, collapsed: loadCollapsed(tabId) }));
  useEffect(() => {
    if (state.tabId !== tabId) setState({ tabId, collapsed: loadCollapsed(tabId) });
  }, [tabId, state.tabId]);

  const set = useCallback(
    (collapsed: number[]) => {
      setState({ tabId, collapsed });
      try {
        window.localStorage.setItem(collapsedKey(tabId), JSON.stringify(collapsed));
      } catch {
        // Storage can be unavailable; the choice then lasts until reload.
      }
    },
    [tabId],
  );

  return [state.tabId === tabId ? state.collapsed : loadCollapsed(tabId), set];
}
