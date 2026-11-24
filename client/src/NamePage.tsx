import { useState, type FormEvent } from "react";
import { DISPLAY_NAME_MAX_LENGTH, type Me } from "@nwsnotes/shared";
import { ApiError, api } from "./api";

interface Props {
  me: Me;
  /** The name was changed: back to Settings, with a message. */
  onChanged: (me: Me) => void;
  onClose: () => void;
  onSessionExpired: () => void;
}

/** Changing your own display name, which people you share with see too. */
export function NamePage({ me, onChanged, onClose, onSessionExpired }: Props) {
  const [displayName, setDisplayName] = useState(me.displayName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (displayName.trim() === "") {
      setError("Please enter your name.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      onChanged(await api.changeName({ displayName: displayName.trim() }));
    } catch (err) {
      if (err instanceof ApiError && err.isUnauthorized) {
        onSessionExpired();
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <main className="settings-page">
      <h1>Change name</h1>
      <form className="category-form" onSubmit={save}>
        <label htmlFor="display-name">Your name</label>
        <input
          id="display-name"
          type="text"
          value={displayName}
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          autoComplete="name"
          autoFocus
          disabled={busy}
          onChange={(event) => setDisplayName(event.target.value)}
        />
        <p className="hint">Shown in Settings, and to anyone you share tags with.</p>
        {error && (
          <p className="save-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-buttons">
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save name"}
          </button>
          <button type="button" className="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </main>
  );
}
