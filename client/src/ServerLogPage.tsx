import { useCallback, useEffect, useState, type MouseEvent } from "react";
import type { ServerLogEntry } from "@nwsnotes/shared";
import { ApiError, api } from "./api";
import { ConfirmDialog } from "./ConfirmDialog";
import { pathFor, type Page } from "./route";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** E.g. "24 Nov 2026, 09:40:12", in this device's time zone. */
function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** How many times errors (or warnings) were seen, counting repeats. */
function times(entries: ServerLogEntry[], level: ServerLogEntry["level"]): number {
  return entries.filter((entry) => entry.level === level).reduce((sum, entry) => sum + entry.count, 0);
}

/** The server's errors, loaded once; undefined while loading. */
function useServerLog(onSessionExpired: () => void) {
  const [entries, setEntries] = useState<ServerLogEntry[]>();
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    try {
      setEntries(await api.serverLog());
      setError(undefined);
    } catch (err) {
      if (err instanceof ApiError && err.isUnauthorized) onSessionExpired();
      else setError(`The server's errors couldn't be loaded: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [onSessionExpired]);
  useEffect(() => {
    void load();
  }, [load]);
  return { entries, setEntries, error, setError, load };
}

/** Settings' "Server errors" section (admins only): whether anything has gone wrong lately, and a link to the details. */
export function ServerLogSection({ onNavigate, onSessionExpired }: { onNavigate: (page: Page) => void; onSessionExpired: () => void }) {
  const { entries, error } = useServerLog(onSessionExpired);
  const target: Page = { name: "serverLog" };
  const go = (event: MouseEvent) => {
    event.preventDefault();
    onNavigate(target);
  };
  const errors = entries && times(entries, "error");
  const warnings = entries && times(entries, "warning");
  return (
    <section>
      <h2>Server errors</h2>
      {error ? (
        <p className="save-error" role="alert">
          {error}
        </p>
      ) : entries === undefined ? (
        <p>Loading…</p>
      ) : entries.length === 0 ? (
        <p data-testid="server-log-summary">No errors or warnings on the server in the last 30 days.</p>
      ) : (
        <p data-testid="server-log-summary" className={errors ? "server-log-has-errors" : undefined}>
          {plural(errors!, "error")} and {plural(warnings!, "warning")} on the server in the last 30 days. The latest was at{" "}
          {when(entries[0]!.lastDateTime)}.
        </p>
      )}
      <a className="button" href={pathFor(target)} onClick={go}>
        View server errors
      </a>
    </section>
  );
}

/** One entry: when, how serious, what it said, where, and (opened) all of it. */
function EntryRow({ entry }: { entry: ServerLogEntry }) {
  return (
    <li data-testid="server-log-entry">
      <div className="user-names">
        <span className={entry.level === "error" ? "user-label off" : "user-label"}>{entry.level === "error" ? "Error" : "Warning"}</span>
        <span className="server-log-time">{when(entry.lastDateTime)}</span>
        {entry.count > 1 && (
          <span className="user-login">
            {entry.count} times, first at {when(entry.firstDateTime)}
          </span>
        )}
      </div>
      <p className="server-log-message">{entry.message}</p>
      {entry.request && (
        <p className="user-details">
          While answering {entry.request}
          {entry.userId !== undefined && ` for user ${entry.userId}`}
        </p>
      )}
      {entry.details && (
        <details>
          <summary>Details</summary>
          <pre className="server-log-details">{entry.details}</pre>
        </details>
      )}
    </li>
  );
}

/** The admin's "Server errors" page: what went wrong on the server lately, the most recent first. */
export function ServerLogPage({ onClose, onSessionExpired }: { onClose: () => void; onSessionExpired: () => void }) {
  const { entries, setEntries, error, setError, load } = useServerLog(onSessionExpired);
  const [busy, setBusy] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);

  async function refresh() {
    setBusy(true);
    await load();
    setBusy(false);
  }

  async function clear() {
    setConfirmingClear(false);
    setBusy(true);
    try {
      await api.clearServerLog();
      setEntries([]);
      setError(undefined);
    } catch (err) {
      if (err instanceof ApiError && err.isUnauthorized) onSessionExpired();
      else setError(`The server's errors couldn't be cleared: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="settings-page server-log-page">
      <h1>Server errors</h1>
      <p>
        Errors and warnings the server has written to its log in the last 30 days (at most the latest 100), the most recent first. The same
        one again within an hour is counted rather than listed again.
      </p>
      {error && (
        <p className="save-error" role="alert">
          {error}
        </p>
      )}
      {entries === undefined && !error && <p>Loading…</p>}
      {entries?.length === 0 && <p>No errors or warnings on the server in the last 30 days.</p>}
      {entries && entries.length > 0 && (
        <ul className="user-list" aria-label="Server errors">
          {entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
      <div className="form-buttons">
        <button type="button" className="button" disabled={busy} onClick={() => void refresh()}>
          Refresh
        </button>
        {entries && entries.length > 0 && (
          <button type="button" className="button" disabled={busy} onClick={() => setConfirmingClear(true)}>
            Clear all
          </button>
        )}
        <button type="button" className="button" onClick={onClose}>
          Done
        </button>
      </div>
      {confirmingClear && (
        <ConfirmDialog
          message="Clear every error and warning from this list? The server's own log on the VM keeps them."
          confirmLabel="Clear all"
          onConfirm={() => void clear()}
          onCancel={() => setConfirmingClear(false)}
        />
      )}
    </main>
  );
}
