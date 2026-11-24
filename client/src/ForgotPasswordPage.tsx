import { useState, type FormEvent } from "react";
import { FORGOT_PASSWORD_PATH, LOGIN_NAME_MAX_LENGTH, isValidLoginName } from "@nwsnotes/shared";
import { api } from "./api";

/** The forgotten-password page's address, carrying over the email typed on the login page, if any. */
export function forgotPasswordAddress(email: string): string {
  return email === "" ? FORGOT_PASSWORD_PATH : `${FORGOT_PASSWORD_PATH}#email=${encodeURIComponent(email)}`;
}

/** The email carried over from the login page (after the #, so it isn't sent to the server). */
function carriedEmail(): string {
  try {
    return new URLSearchParams(window.location.hash.slice(1)).get("email") ?? "";
  } catch {
    return "";
  }
}

/**
 * The public forgotten-password page: emails a link to choose a new password to the account with this
 * email, if there is one. It says the same either way, so it can't be used to find out who has an account.
 */
export function ForgotPasswordPage() {
  const [loginName, setLoginName] = useState(carriedEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  /** The email the link was asked for, once it has been. */
  const [sent, setSent] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || loginName.trim() === "") return;
    if (!isValidLoginName(loginName.trim())) {
      setError("Please enter your email address, e.g. pat@example.com.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await api.askForPasswordLink({ loginName: loginName.trim() });
      setSent(loginName.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      {sent !== undefined ? (
        <div className="login-card" role="status">
          <h1>nwsnotes</h1>
          <p>If {sent} has an account, we've sent it a link to choose a new password. The link works for an hour.</p>
          <p>It can take a few minutes to arrive. If it doesn't, check your junk folder, or ask the admin to reset your password.</p>
          <a href="/" className="button">
            Go to the login page
          </a>
        </div>
      ) : (
        <form onSubmit={submit} className="login-card" noValidate>
          <h1>nwsnotes</h1>
          <h2 className="sign-up-heading">Forgot your password?</h2>
          <p className="hint">Enter the email you log in with, and we'll send it a link to choose a new password.</p>
          <label htmlFor="forgot-email">Email</label>
          <input
            id="forgot-email"
            name="username"
            type="text"
            inputMode="email"
            value={loginName}
            maxLength={LOGIN_NAME_MAX_LENGTH}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            disabled={busy}
            onChange={(event) => setLoginName(event.target.value)}
          />
          <button type="submit" disabled={busy || loginName.trim() === ""}>
            {busy ? "Sending…" : "Send the link"}
          </button>
          {error && (
            <p className="save-error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
      {sent === undefined && (
        <p className="login-help">
          <a href="/">Remembered it? Log in</a>
        </p>
      )}
    </main>
  );
}
