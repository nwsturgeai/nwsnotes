import { useState, type FormEvent } from "react";
import { DISPLAY_NAME_MAX_LENGTH, LOGIN_NAME_MAX_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, isValidLoginName } from "@nwsnotes/shared";
import { api } from "./api";

/** Where the sign-up page is: public, so it can be shared with family and friends. */
export const SIGN_UP_PATH = "/signup";

/**
 * The public sign-up page: someone asks for an account with their email, name and a password they
 * choose. The account waits until an admin confirms it on the users page; only then can they log in.
 */
export function SignUpPage() {
  const [loginName, setLoginName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  /** The name they gave, once the request has been sent. */
  const [sent, setSent] = useState<string>();

  const ready = loginName.trim() !== "" && displayName.trim() !== "" && password !== "" && again !== "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !ready) return;
    if (!isValidLoginName(loginName.trim())) {
      setError("Please enter your email address, e.g. pat@example.com.");
      return;
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(`The password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    if (password !== again) {
      setError("The passwords don't match.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await api.requestAccount({ loginName: loginName.trim(), displayName: displayName.trim(), password });
      setSent(displayName.trim());
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
          <p>Thanks, {sent}. Your request has been sent.</p>
          <p>You can log in with your email and password once your account has been confirmed.</p>
          <a href="/" className="button">
            Go to the login page
          </a>
        </div>
      ) : (
        <form onSubmit={submit} className="login-card" noValidate>
          <h1>nwsnotes</h1>
          <h2 className="sign-up-heading">Ask for an account</h2>
          <p className="hint">Once you've sent this, your account will be checked and confirmed before you can log in.</p>
          <label htmlFor="sign-up-email">Email</label>
          <input
            id="sign-up-email"
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
          <label htmlFor="sign-up-name">Your name</label>
          <input
            id="sign-up-name"
            name="name"
            type="text"
            value={displayName}
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            autoComplete="name"
            disabled={busy}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <label htmlFor="sign-up-password">Password</label>
          <input
            id="sign-up-password"
            name="password"
            type="password"
            value={password}
            maxLength={PASSWORD_MAX_LENGTH}
            autoComplete="new-password"
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
          />
          <label htmlFor="sign-up-password-again">Password again</label>
          <input
            id="sign-up-password-again"
            name="password-again"
            type="password"
            value={again}
            maxLength={PASSWORD_MAX_LENGTH}
            autoComplete="new-password"
            disabled={busy}
            onChange={(event) => setAgain(event.target.value)}
          />
          <p className="hint">At least {PASSWORD_MIN_LENGTH} characters.</p>
          <button type="submit" disabled={busy || !ready}>
            {busy ? "Sending…" : "Ask for an account"}
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
          <a href="/">Already have an account? Log in</a>
        </p>
      )}
    </main>
  );
}
