import { useState, type FormEvent } from "react";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@nwsnotes/shared";
import { ApiError, api } from "./api";

interface Props {
  /** The password was changed: back to Settings, with a message. */
  onChanged: () => void;
  onClose: () => void;
  onSessionExpired: () => void;
}

/** Changing your own password. This device stays logged in; your other devices are logged out. */
export function PasswordPage({ onChanged, onClose, onSessionExpired }: Props) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setError(`The new password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    if (newPassword !== again) {
      setError("The new passwords don't match.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await api.changePassword({ currentPassword, newPassword });
      onChanged();
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
      <h1>Change password</h1>
      <form className="category-form" onSubmit={save}>
        {/* For the browser's password manager: whose password this is. */}
        <input type="text" name="username" autoComplete="username" hidden readOnly />
        <label htmlFor="current-password">Current password</label>
        <input
          id="current-password"
          type="password"
          value={currentPassword}
          autoComplete="current-password"
          autoFocus
          disabled={busy}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
        <label htmlFor="new-password">New password</label>
        <input
          id="new-password"
          type="password"
          value={newPassword}
          maxLength={PASSWORD_MAX_LENGTH}
          autoComplete="new-password"
          disabled={busy}
          onChange={(event) => setNewPassword(event.target.value)}
        />
        <label htmlFor="new-password-again">New password again</label>
        <input
          id="new-password-again"
          type="password"
          value={again}
          maxLength={PASSWORD_MAX_LENGTH}
          autoComplete="new-password"
          disabled={busy}
          onChange={(event) => setAgain(event.target.value)}
        />
        <p className="hint">At least {PASSWORD_MIN_LENGTH} characters. Your other devices will be logged out.</p>
        {error && (
          <p className="save-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-buttons">
          <button type="submit" disabled={busy}>
            {busy ? "Changing…" : "Change password"}
          </button>
          <button type="button" className="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </main>
  );
}
