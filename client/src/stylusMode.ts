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
  return useDeviceSetting("nwsnotes.fullTagList", (stored) => stored === "on", onOff);
}

export const MAX_COLUMNS = 4;

/** How many columns the note list is split into (1 to 4, default 1). A higher saved value (5 was allowed) counts as 4. */
export function useColumns(): [number, (columns: number) => void] {
  return useDeviceSetting(
    "nwsnotes.columns",
    (stored) => {
      const columns = Number(stored);
      return Number.isInteger(columns) && columns >= 1 ? Math.min(columns, MAX_COLUMNS) : 1;
    },
    String,
  );
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
