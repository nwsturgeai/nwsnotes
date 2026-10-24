import { useCallback, useState } from "react";

const STORAGE_KEY = "nwsnotes.stylusMode";

function readSetting(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    // Storage can be unavailable (e.g. blocked site data); the setting then lasts until reload.
    return false;
  }
}

/** Whether stylus mode is on. Remembered on this device in local storage. */
export function useStylusMode(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(readSetting);

  const set = useCallback((value: boolean) => {
    setOn(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value ? "on" : "off");
    } catch {
      // See readSetting.
    }
  }, []);

  return [on, set];
}
