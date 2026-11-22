import { useCallback, useEffect, useState } from "react";
import type { HistoryChange } from "@nwsnotes/shared";
import { ApiError, api } from "./api";
import { ConfirmDialog } from "./ConfirmDialog";

interface Props {
  /** After going back: the notes, categories and tabs have changed, so reload them. */
  onReverted: () => void;
  onSessionExpired: () => void;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** "09:40" in this device's time zone. */
function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** "18 Nov", with the year when it isn't this year ("18 Nov 2025"). */
function dateOf(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() !== new Date().getFullYear() && { year: "numeric" }),
  });
}

/** A day's heading: "Today", "Yesterday", or e.g. "Mon 16 Nov". */
function dayHeading(iso: string): string {
  const date = new Date(iso);
  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${date.toLocaleDateString("en-GB", { weekday: "short" })} ${dateOf(iso)}`;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** What a change says: going back names the time gone back to, in this device's time zone. */
function describe(change: HistoryChange): string {
  if (change.revertedTo === undefined) return change.summary;
  return `Went back to ${dateOf(change.revertedTo)} ${timeOf(change.revertedTo)} (${plural(change.undone ?? 0, "change")} undone)`;
}

/** The history of changes, newest first, with a "Go back to here" button on each but the newest. */
export function HistoryPage({ onReverted, onSessionExpired }: Props) {
  const [changes, setChanges] = useState<HistoryChange[]>();
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<string>();
  /** The change to go back to, while its confirmation is open (with how many later changes it undoes). */
  const [confirming, setConfirming] = useState<{ change: HistoryChange; later: number }>();

  const failed = useCallback(
    (err: unknown, what: string) => {
      if (err instanceof ApiError && err.isUnauthorized) {
        onSessionExpired();
        return;
      }
      setError(`${what}: ${err instanceof Error ? err.message : String(err)}`);
    },
    [onSessionExpired],
  );

  const loadNewest = useCallback(async () => {
    try {
      const page = await api.history();
      setChanges(page.changes);
      setMore(page.more);
      setError(undefined);
    } catch (err) {
      failed(err, "The history couldn't be loaded");
    }
  }, [failed]);

  useEffect(() => {
    void loadNewest();
  }, [loadNewest]);

  async function loadOlder() {
    const oldest = changes?.at(-1);
    if (!oldest) return;
    setBusy(true);
    try {
      const page = await api.history(oldest.id);
      setChanges([...(changes ?? []), ...page.changes]);
      setMore(page.more);
    } catch (err) {
      failed(err, "Older changes couldn't be loaded");
    } finally {
      setBusy(false);
    }
  }

  async function goBack(change: HistoryChange) {
    setConfirming(undefined);
    setBusy(true);
    setResult(undefined);
    setError(undefined);
    try {
      const { undone } = await api.revert(change.id);
      setResult(`Gone back to ${dateOf(change.time)} ${timeOf(change.time)}: ${plural(undone, "change")} undone.`);
      onReverted();
      await loadNewest();
    } catch (err) {
      failed(err, "Nothing was changed");
    } finally {
      setBusy(false);
    }
  }

  // The changes under a heading for each day, keeping each one's place in the whole list.
  const days: { heading: string; entries: { change: HistoryChange; index: number }[] }[] = [];
  changes?.forEach((change, index) => {
    const heading = dayHeading(change.time);
    const day = days.at(-1);
    if (day?.heading === heading) day.entries.push({ change, index });
    else days.push({ heading, entries: [{ change, index }] });
  });

  return (
    <main className="settings-page history-page">
      <h1>History</h1>
      <p>Your last 500 changes from the past 30 days, newest first. Going back to a change undoes everything after it, and can itself be undone.</p>
      {result && (
        <p className="lifetime-result" role="status">
          {result}
        </p>
      )}
      {error && (
        <p className="save-error" role="alert">
          {error}
        </p>
      )}
      {changes === undefined && !error && <p>Loading…</p>}
      {changes?.length === 0 && <p>There are no changes yet.</p>}
      {days.map((day) => (
        <section key={day.heading}>
          <h2>{day.heading}</h2>
          <ul className="history-list">
            {day.entries.map(({ change, index }) => (
              <li key={change.id}>
                <time dateTime={change.time}>{timeOf(change.time)}</time>
                <span className="history-summary">{describe(change)}</span>
                {/* The newest change is how things are now, so there's nothing to go back to. */}
                {index > 0 && (
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={() => setConfirming({ change, later: index })}
                  >
                    Go back to here
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {more && (
        <button type="button" className="button" disabled={busy} onClick={() => void loadOlder()}>
          Load older changes
        </button>
      )}
      {confirming && (
        <ConfirmDialog
          message={`Go back to how everything was just after this change, at ${timeOf(confirming.change.time)} on ${dateOf(confirming.change.time)}? This undoes the ${confirming.later === 1 ? "1 later change" : `${confirming.later} later changes`}. You can undo this too.`}
          confirmLabel="Go back"
          onConfirm={() => void goBack(confirming.change)}
          onCancel={() => setConfirming(undefined)}
        />
      )}
    </main>
  );
}
