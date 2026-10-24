import { useEffect, useRef } from "react";
import { LIVE_UPDATES_PATH, type LiveMessage } from "@nwsnotes/shared";

/** Identifies this page to the server, so it isn't told about its own changes. */
export const connectionId = crypto.randomUUID();

const FIRST_RETRY_MS = 1000;
const MAX_RETRY_MS = 30_000;

/**
 * While `enabled`, keeps a WebSocket open to the server and calls `onChanged` whenever
 * the notes may have changed elsewhere: when the server says so, after reconnecting
 * (a message may have been missed) and when the app comes back on screen.
 */
export function useLiveUpdates(enabled: boolean, onChanged: () => void) {
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  });

  useEffect(() => {
    if (!enabled) return;

    let socket: WebSocket | undefined;
    let retryTimer: number | undefined;
    let retryMs = FIRST_RETRY_MS;
    let attempts = 0;
    let stopped = false;

    function connect() {
      retryTimer = undefined;
      attempts += 1;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${protocol}//${window.location.host}${LIVE_UPDATES_PATH}?id=${encodeURIComponent(connectionId)}`;
      const ws = new WebSocket(url);
      socket = ws;

      ws.onopen = () => {
        retryMs = FIRST_RETRY_MS;
        // The notes were loaded just before the first attempt; after that, something may have been missed.
        if (attempts > 1) onChangedRef.current();
      };
      ws.onmessage = (event) => {
        let message: Partial<LiveMessage>;
        try {
          message = JSON.parse(String(event.data)) as Partial<LiveMessage>;
        } catch {
          return;
        }
        if (message.type === "notes-changed") onChangedRef.current();
      };
      ws.onclose = () => {
        if (socket !== ws) return;
        socket = undefined;
        if (!stopped) scheduleReconnect();
      };
    }

    function scheduleReconnect() {
      if (retryTimer !== undefined) return;
      retryTimer = window.setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
    }

    function onVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      if (socket) {
        onChangedRef.current();
      } else {
        // Reconnect now rather than waiting; reconnecting reloads the notes.
        window.clearTimeout(retryTimer);
        retryMs = FIRST_RETRY_MS;
        connect();
      }
    }

    connect();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopped = true;
      window.clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      socket?.close();
    };
  }, [enabled]);
}
