import { useEffect, useState, type FormEvent } from "react";
import { FORGOT_PASSWORD_PATH, PASSWORD_LINK_NOT_WORKING, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@nwsnotes/shared";
import { ApiError, api } from "./api";

/** Where the login page finds the email whose password was just changed here, to fill it in and say so. */
const PASSWORD_CHANGED_KEY = "nwsnotes.passwordChangedFor";

/** The login page: the email whose password was just changed with an emailed link, if any (read once). */
export function takePasswordChangedEmail(): string | undefined {
  try {
    const email = sessionStorage.getItem(PASSWORD_CHANGED_KEY) ?? undefined;
    sessionStorage.removeItem(PASSWORD_CHANGED_KEY);
    return email;
  } catch {
    return undefined;
  }
}

type LinkState =
  | { state: "checking" }
  | { state: "ready"; loginName: string }
  | { state: "not-working" }
  /** The check couldn't be made (e.g. the server can't be reached). */
  | { state: "failed"; message: string };

/**
 * The page an emailed link opens, to choose a new password. The link's token is after the #, so the
 * browser never sends it when loading the page; it's taken from the address bar as soon as it's read.
 */
export function ResetPasswordPage() {
  const [token] = useState(() => decodeURIComponent(window.location.hash.slice(1)));
  const [link, setLink] = useState<LinkState>({ state: "checking" });
  const [newPassword, setNewPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    // Not left in the browser's history.
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    let current = true;
    const check = token === "" ? Promise.reject(new Error(PASSWORD_LINK_NOT_WORKING)) : api.checkPasswordLink(token);
    check.then(
      ({ loginName }) => current && setLink({ state: "ready", loginName }),
      (err: unknown) => {
        if (!current) return;
        if (err instanceof ApiError && err.isNetworkError) setLink({ state: "failed", message: err.message });
        else setLink({ state: "not-working" });
      },
    );
    return () => {
      current = false;
    };
  }, [token]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || link.state !== "ready") return;
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
      await api.resetPasswordByLink({ token, newPassword });
      try {
        sessionStorage.setItem(PASSWORD_CHANGED_KEY, link.loginName);
      } catch {
        // No storage: the login page just won't say so.
      }
      window.location.assign("/");
    } catch (err) {
      if (err instanceof ApiError && err.message === PASSWORD_LINK_NOT_WORKING) setLink({ state: "not-working" });
      else setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      {link.state === "ready" ? (
        <form onSubmit={save} className="login-card" noValidate>
          <h1>nwsnotes</h1>
          <h2 className="sign-up-heading">Choose a new password</h2>
          <p className="hint">For {link.loginName}.</p>
          {/* For the browser's password manager: whose password this is. */}
          <input type="text" name="username" autoComplete="username" value={link.loginName} hidden readOnly />
          <label htmlFor="reset-new-password">New password</label>
          <input
            id="reset-new-password"
            type="password"
            value={newPassword}
            maxLength={PASSWORD_MAX_LENGTH}
            autoComplete="new-password"
            autoFocus
            disabled={busy}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <label htmlFor="reset-new-password-again">New password again</label>
          <input
            id="reset-new-password-again"
            type="password"
            value={again}
            maxLength={PASSWORD_MAX_LENGTH}
            autoComplete="new-password"
            disabled={busy}
            onChange={(event) => setAgain(event.target.value)}
          />
          <p className="hint">At least {PASSWORD_MIN_LENGTH} characters. Any devices logged in to your account will be logged out.</p>
          <button type="submit" disabled={busy || newPassword === "" || again === ""}>
            {busy ? "Changing…" : "Change password"}
          </button>
          {error && (
            <p className="save-error" role="alert">
              {error}
            </p>
          )}
        </form>
      ) : (
        <div className="login-card">
          <h1>nwsnotes</h1>
          {link.state === "checking" && <p role="status">Checking the link…</p>}
          {link.state === "not-working" && (
            <>
              <p role="alert">{PASSWORD_LINK_NOT_WORKING}</p>
              <a href={FORGOT_PASSWORD_PATH} className="button">
                Ask for a new link
              </a>
            </>
          )}
          {link.state === "failed" && (
            <p className="save-error" role="alert">
              {link.message}
            </p>
          )}
        </div>
      )}
      <p className="login-help">
        <a href="/">Go to the login page</a>
      </p>
    </main>
  );
}
