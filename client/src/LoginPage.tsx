import { useState, type FormEvent } from "react";
import { api } from "./api";
import { remindAfterLogin } from "./reminders";
import { SIGN_UP_PATH } from "./SignUpPage";

interface Props {
  onLoggedIn: () => void;
}

export function LoginPage({ onLoggedIn }: Props) {
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const ready = loginName.trim().length > 0 && password.length > 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.login({ loginName: loginName.trim(), password });
      // Asked now, while the tap on "Log in" still lets the page ask for permission.
      remindAfterLogin();
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <form onSubmit={submit} className="login-card">
        <h1>nwsnotes</h1>
        <label htmlFor="login-name">Email</label>
        {/* Not type="email": accounts made before login names had to be emails still log in with their old names. */}
        <input
          id="login-name"
          name="username"
          type="text"
          inputMode="email"
          value={loginName}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          disabled={busy}
          onChange={(event) => setLoginName(event.target.value)}
        />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          value={password}
          autoComplete="current-password"
          disabled={busy}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button type="submit" disabled={busy || !ready}>
          {busy ? "Logging in…" : "Log in"}
        </button>
        {error && (
          <p className="save-error" role="alert">
            {error}
          </p>
        )}
      </form>
      {/* The help pages are public, so they can be read before logging in. */}
      <p className="login-help">
        <a href={SIGN_UP_PATH}>No account yet? Ask for one</a>
      </p>
      <p className="login-help">
        <a href="/docs/">New here? Read the introduction</a>
      </p>
    </main>
  );
}
