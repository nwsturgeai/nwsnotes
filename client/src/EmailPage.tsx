import { useState, type FormEvent } from "react";
import { isValidLoginName, type Me } from "@nwsnotes/shared";
import { ApiError, api } from "./api";

interface Props {
  me: Me;
  /** The link was sent to this new email: back to Settings, with a message. */
  onSent: (newLoginName: string) => void;
  onClose: () => void;
  onSessionExpired: () => void;
}

/**
 * Asking to change your own login email. A link is emailed to the new one, and the email changes only
 * once it's opened (on the confirm-email page), so a mistyped address changes nothing.
 */
export function EmailPage({ me, onSent, onClose, onSessionExpired }: Props) {
  const [loginName, setLoginName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function send(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!isValidLoginName(loginName.trim())) {
      setError("Please enter your new email address, e.g. pat@example.com.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      onSent((await api.askToChangeEmail({ loginName: loginName.trim(), currentPassword })).loginName);
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
      <h1>Change email</h1>
      <p>You log in with {me.loginName}.</p>
      <form className="category-form" onSubmit={send} noValidate>
        {/* For the browser's password manager: whose password this is. */}
        <input type="text" name="username" autoComplete="username" value={me.loginName} hidden readOnly />
        <label htmlFor="new-email">New email</label>
        <input
          id="new-email"
          type="email"
          inputMode="email"
          value={loginName}
          autoComplete="off"
          autoFocus
          disabled={busy}
          onChange={(event) => setLoginName(event.target.value)}
        />
        <label htmlFor="email-current-password">Current password</label>
        <input
          id="email-current-password"
          type="password"
          value={currentPassword}
          autoComplete="current-password"
          disabled={busy}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
        <p className="hint">
          We'll email a link to the new address. Your email changes once you open it; until then, keep logging in with {me.loginName}.
        </p>
        {error && (
          <p className="save-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-buttons">
          <button type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send the link"}
          </button>
          <button type="button" className="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </main>
  );
}
