import { useCallback, useState } from "react";

/*
 * Settings remembered on this device in local storage (each device has its own), such as stylus mode.
 * Storage can be unavailable (e.g. blocked site data); a setting then lasts until the page is reloaded.
 */

function useDeviceSetting<T>(key: string, read: (stored: string | null) => T, write: (value: T) => string): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      return read(window.localStorage.getItem(key));
    } catch {
      return read(null);
    }
  });

  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, write(next));
      } catch {
        // See above.
      }
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

export const MAX_COLUMNS = 5;

/** How many columns the note list is split into (1 to 5, default 1). */
export function useColumns(): [number, (columns: number) => void] {
  return useDeviceSetting(
    "nwsnotes.columns",
    (stored) => {
      const columns = Number(stored);
      return Number.isInteger(columns) && columns >= 1 && columns <= MAX_COLUMNS ? columns : 1;
    },
    String,
  );
}
