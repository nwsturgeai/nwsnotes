import { useState, type FormEvent } from "react";
import { api } from "./api";

interface Props {
  onLoggedIn: () => void;
}

export function LoginPage({ onLoggedIn }: Props) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || password.length === 0) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.login({ password });
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
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          autoComplete="current-password"
          autoFocus
          disabled={busy}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button type="submit" disabled={busy || password.length === 0}>
          {busy ? "Logging in…" : "Log in"}
        </button>
        {error && (
          <p className="save-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}
