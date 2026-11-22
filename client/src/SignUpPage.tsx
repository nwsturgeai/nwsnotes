import { useState, type FormEvent } from "react";
import { LOGIN_NAME_MAX_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, isValidLoginName } from "@nwsnotes/shared";
import { api } from "./api";

interface Props {
  /** Back to the login page. */
  onLogIn: () => void;
}

/**
 * The public sign-up page (/signup), to share with family and friends: they ask for an account with
 * their email and a password they choose. The admin then confirms it on the users page, and only then
 * can they log in.
 */
export function SignUpPage({ onLogIn }: Props) {
  const [loginName, setLoginName] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);

  const ready = loginName.trim().length > 0 && password.length > 0 && again.length > 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !ready) return;
    if (!isValidLoginName(loginName.trim())) {
      setError("Please type your email address, e.g. pat@example.com.");
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
      await api.signUp({ loginName: loginName.trim(), password });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const logInLink = (text: string) => (
    <a
      href="/"
      onClick={(event) => {
        event.preventDefault();
        onLogIn();
      }}
    >
      {text}
    </a>
  );

  if (done) {
    return (
      <main className="login-page">
        <div className="login-card" role="status">
          <h1>nwsnotes</h1>
          <p>Thanks! Your account is waiting to be confirmed.</p>
          <p>You'll be able to log in with {loginName.trim()} and your password once it has been.</p>
        </div>
        <p className="login-help">{logInLink("Go to the login page")}</p>
      </main>
    );
  }

  return (
    <main className="login-page">
      <form onSubmit={submit} className="login-card" noValidate>
        <h1>nwsnotes</h1>
        <p className="hint">Ask for an account. Once it's been confirmed, you can log in.</p>
        <label htmlFor="signup-email">Email</label>
        <input
          id="signup-email"
          name="username"
          type="email"
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
        <label htmlFor="signup-password">Password</label>
        <input
          id="signup-password"
          type="password"
          value={password}
          maxLength={PASSWORD_MAX_LENGTH}
          autoComplete="new-password"
          disabled={busy}
          onChange={(event) => setPassword(event.target.value)}
        />
        <label htmlFor="signup-password-again">Password again</label>
        <input
          id="signup-password-again"
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
      <p className="login-help">{logInLink("Already have an account? Log in")}</p>
    </main>
  );
}
