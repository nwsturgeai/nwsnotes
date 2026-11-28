import { useCallback, useEffect, useState } from "react";

/*
 * Settings remembered on this device in local storage (each device has its own), such as stylus mode.
 * Storage can be unavailable (e.g. blocked site data); a setting then lasts until the page is reloaded.
 * Every place using a setting sees a change made in another straight away (e.g. the pen thickness,
 * chosen in the long-form editor while its canvas is drawing).
 */

/** Sent on the window when a device setting changes: its key and new stored value. */
const SETTING_CHANGED = "nwsnotes-setting-changed";

function useDeviceSetting<T>(key: string, read: (stored: string | null) => T, write: (value: T) => string): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      return read(window.localStorage.getItem(key));
    } catch {
      return read(null);
    }
  });

  useEffect(() => {
    function changed(event: Event) {
      const { key: changedKey, stored } = (event as CustomEvent<{ key: string; stored: string }>).detail;
      if (changedKey === key) setValue(read(stored));
    }
    window.addEventListener(SETTING_CHANGED, changed);
    return () => window.removeEventListener(SETTING_CHANGED, changed);
    // `read` is a fresh function each render, but always reads the same way for a key.
  }, [key]);

  const set = useCallback(
    (next: T) => {
      const stored = write(next);
      try {
        window.localStorage.setItem(key, stored);
      } catch {
        // See above.
      }
      window.dispatchEvent(new CustomEvent(SETTING_CHANGED, { detail: { key, stored } }));
    },
    [key, write],
  );

  return [value, set];
}

const onOff = (on: boolean) => (on ? "on" : "off");

/** Whether stylus mode is on. */
export function useStylusMode(): [boolean, (on: boolean) => void] {
  return useDeviceSetting("nwsnotes.stylusMode", (stored) => stored === "on", onOff);
}

/** Whether the add/edit area shows every tag as a pill (full-tag-list mode) instead of dropdowns. */
export function useFullTagList(): [boolean, (on: boolean) => void] {
  // Expanded unless this device has chosen to collapse it.
  return useDeviceSetting("nwsnotes.fullTagList", (stored) => stored !== "off", onOff);
}

/** Whether the left tab strip is hidden (by the eye button above it). One setting for every tab. */
export function useLeftTabsHidden(): [boolean, (on: boolean) => void] {
  return useDeviceSetting("nwsnotes.leftTabsHidden", (stored) => stored === "on", onOff);
}

/** Whether the filter row is collapsed to its first line (when it wraps onto more). One setting for every tab. */
export function useFilterRowCollapsed(): [boolean, (on: boolean) => void] {
  return useDeviceSetting("nwsnotes.filterRowCollapsed", (stored) => stored === "on", onOff);
}

/** The Columns setting: always one column, or as many as fit at least this wide. */
export type ColumnsChoice = "single" | "wide" | "medium" | "narrow";

/** The Columns setting's choices, in the order Settings shows them, with each one's smallest column width (px). */
export const COLUMN_CHOICES: { value: ColumnsChoice; label: string; minWidth?: number }[] = [
  { value: "single", label: "Single" },
  { value: "wide", label: "Wide", minWidth: 500 },
  { value: "medium", label: "Medium", minWidth: 400 },
  { value: "narrow", label: "Narrow", minWidth: 300 },
];

/** Numbers saved before (1 to 5 columns), as the choice in the same place. */
const OLD_COLUMNS: Record<string, ColumnsChoice> = { "1": "single", "2": "wide", "3": "medium", "4": "narrow", "5": "narrow" };

/** The Columns setting (default Medium). */
export function useColumns(): [ColumnsChoice, (choice: ColumnsChoice) => void] {
  return useDeviceSetting<ColumnsChoice>(
    "nwsnotes.columns",
    (stored) => COLUMN_CHOICES.find((choice) => choice.value === stored)?.value ?? OLD_COLUMNS[stored ?? ""] ?? "medium",
    String,
  );
}

/**
 * How many columns a list this wide (px) is split into: one for Single; otherwise as many as fit at
 * the choice's smallest width (at least one, with no upper limit; the app is at most 1280px wide).
 */
export function columnCount(choice: ColumnsChoice, width: number): number {
  const minWidth = COLUMN_CHOICES.find((option) => option.value === choice)?.minWidth;
  return minWidth ? Math.max(1, Math.floor(width / minWidth)) : 1;
}

/** Whether each tab shows its number of notes, e.g. "All (153)" (default off). */
export function useTabCounts(): [boolean, (on: boolean) => void] {
  return useDeviceSetting("nwsnotes.tabCounts", (stored) => stored === "on", onOff);
}

/** The pen thicknesses to choose from, in CSS pixels. */
export const PEN_WIDTHS = [1.5, 2.5, 4.5] as const;
export const DEFAULT_PEN_WIDTH = 2.5;

/** The width new strokes are drawn with on every canvas (default 2.5; an unknown saved value counts as that). */
export function usePenWidth(): [number, (width: number) => void] {
  return useDeviceSetting(
    "nwsnotes.penWidth",
    (stored) => {
      const width = Number(stored);
      return (PEN_WIDTHS as readonly number[]).includes(width) ? width : DEFAULT_PEN_WIDTH;
    },
    String,
  );
}

/** The pen's usual colour. */
export const BLACK_PEN = "#000000";

/** The other pen colours to choose from (for long-form notes' handwriting): each dark enough to read on white. */
export const PEN_COLOURS = [
  { name: "Blue", value: "#1f5fd1" },
  { name: "Red", value: "#d0312d" },
  { name: "Green", value: "#1e8a3c" },
  { name: "Purple", value: "#7b3fbf" },
  { name: "Orange", value: "#d96a00" },
  { name: "Brown", value: "#8b5a2b" },
  { name: "Teal", value: "#0f8585" },
  { name: "Pink", value: "#d63384" },
] as const;

/**
 * The colour long-form notes' handwriting is drawn in, remembered on this device (default black; an
 * unknown saved value counts as black). Regular notes' handwritten titles are always black.
 */
export function usePenColour(): [string, (colour: string) => void] {
  return useDeviceSetting(
    "nwsnotes.penColour",
    (stored) => (PEN_COLOURS.some((colour) => colour.value === stored) ? stored! : BLACK_PEN),
    String,
  );
}

/** How the Parent pop-up lists the long-form notes: in the notes' own order, or by title. */
export type ParentSort = "order" | "alphabetical";

const asStored = (sort: ParentSort) => sort;

/** The Parent pop-up's sort order (default: the notes' order), remembered on this device. */
export function useParentSort(): [ParentSort, (sort: ParentSort) => void] {
  return useDeviceSetting<ParentSort>("nwsnotes.parentSort", (stored) => (stored === "alphabetical" ? "alphabetical" : "order"), asStored);
}

/** Whether the Parent pop-up's "Filter by tag" section is open (default closed), remembered on this device. */
export function useParentTagsOpen(): [boolean, (on: boolean) => void] {
  return useDeviceSetting("nwsnotes.parentTagsOpen", (stored) => stored === "on", onOff);
}

/**
 * The tags ticked in the Parent pop-up's "Filter by tag" section (category id → tag ids; default none),
 * remembered on this device. A saved value that isn't one is treated as none; tags since deleted are ignored.
 */
export function useParentTagSelection(): [Record<number, number[]>, (selection: Record<number, number[]>) => void] {
  return useDeviceSetting<Record<number, number[]>>(
    "nwsnotes.parentTagSelection",
    (stored) => {
      try {
        const parsed: unknown = JSON.parse(stored ?? "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const selection: Record<number, number[]> = {};
        for (const [categoryId, tagIds] of Object.entries(parsed)) {
          if (Array.isArray(tagIds)) selection[Number(categoryId)] = tagIds.filter((id): id is number => typeof id === "number");
        }
        return selection;
      } catch {
        return {};
      }
    },
    (selection) => JSON.stringify(selection),
  );
}
