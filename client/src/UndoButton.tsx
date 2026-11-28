import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRotateLeft, faArrowRotateRight } from "@fortawesome/free-solid-svg-icons";
import { api, ApiError } from "./api";
import { clearUndo, setUndoOffer, useUndoOffer } from "./undo";

/** How long the message after an Undo or Redo (or why it couldn't be done) stays. */
const MESSAGE_MS = 5000;
const ERROR_MESSAGE_MS = 10_000;

/** Why the button can't be used while a note is being edited. */
const BLOCKED_HINT = "Finish or cancel the edit first";

/**
 * The notes page's Undo button, in the top-left corner (see Specs/undo.md), and the message after it's
 * used. Shows only while there's something to undo (or redo) from the last 5 minutes.
 */
export function useUndoButton({ blocked, onUndone, onSessionExpired }: { blocked: boolean; onUndone: () => void; onSessionExpired: () => void }) {
  const offer = useUndoOffer();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean }>();

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(undefined), message.error ? ERROR_MESSAGE_MS : MESSAGE_MS);
    return () => window.clearTimeout(timer);
  }, [message]);

  async function run() {
    if (!offer || busy || blocked) return;
    setBusy(true);
    try {
      const { changes } = await api.undo(offer.changes.map((change) => change.id));
      setUndoOffer({ mode: offer.mode === "undo" ? "redo" : "undo", changes, label: offer.label });
      setMessage({ text: `${offer.mode === "undo" ? "Undone" : "Redone"}: ${offer.label}`, error: false });
      onUndone();
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        onSessionExpired();
        return;
      }
      // Refused (changed since, no longer allowed, gone from the History): there's nothing more to offer.
      // Couldn't reach the server: the offer stays, to try again.
      if (!(error instanceof ApiError && error.isNetworkError)) clearUndo();
      const verb = offer.mode === "undo" ? "undo" : "redo";
      setMessage({ text: `Couldn't ${verb} ${offer.label}: ${error instanceof Error ? error.message : String(error)}`, error: true });
    } finally {
      setBusy(false);
    }
  }

  const label = offer ? `${offer.mode === "undo" ? "Undo" : "Redo"}: ${offer.label}` : "";
  const button = offer && (
    <button
      type="button"
      className={blocked ? "undo-button blocked" : "undo-button"}
      aria-label={label}
      aria-disabled={blocked || busy || undefined}
      title={blocked ? BLOCKED_HINT : label}
      onClick={() => void run()}
    >
      <FontAwesomeIcon icon={offer.mode === "undo" ? faArrowRotateLeft : faArrowRotateRight} />
    </button>
  );
  const notice = message && (
    <div className={message.error ? "undo-notice error" : "undo-notice"} role={message.error ? "alert" : "status"}>
      <span>{message.text}</span>
      <button type="button" onClick={() => setMessage(undefined)}>
        OK
      </button>
    </div>
  );
  return { button, notice };
}
