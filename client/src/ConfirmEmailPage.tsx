import { useEffect, useState } from "react";
import { EMAIL_LINK_NOT_WORKING, type EmailChangeLink } from "@nwsnotes/shared";
import { ApiError, api } from "./api";

type LinkState =
  | { state: "checking" }
  | { state: "ready"; link: EmailChangeLink }
  | { state: "done"; loginName: string }
  | { state: "not-working" }
  /** The check couldn't be made (e.g. the server can't be reached). */
  | { state: "failed"; message: string };

/**
 * The page an email-change link opens, to confirm the new login email. The change is made only when
 * "Confirm" is pressed, not on opening, so an email app or scanner that opens links can't make it. The
 * token is after the #, so the browser never sends it when loading the page; it's taken from the address
 * bar as soon as it's read.
 */
export function ConfirmEmailPage() {
  const [token] = useState(() => decodeURIComponent(window.location.hash.slice(1)));
  const [link, setLink] = useState<LinkState>({ state: "checking" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    // Not left in the browser's history.
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    let current = true;
    const check = token === "" ? Promise.reject(new Error(EMAIL_LINK_NOT_WORKING)) : api.checkEmailLink(token);
    check.then(
      (answer) => current && setLink({ state: "ready", link: answer }),
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

  async function confirm() {
    if (busy || link.state !== "ready") return;
    setBusy(true);
    setError(undefined);
    try {
      const { loginName } = await api.confirmEmailChange(token);
      setLink({ state: "done", loginName });
    } catch (err) {
      if (err instanceof ApiError && err.message === EMAIL_LINK_NOT_WORKING) setLink({ state: "not-working" });
      else setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-card">
        <h1>nwsnotes</h1>
        {link.state === "checking" && <p role="status">Checking the link…</p>}
        {link.state === "ready" && (
          <>
            <h2 className="sign-up-heading">Confirm your new email</h2>
            <p>
              Change the email you log in with from {link.link.loginName} to {link.link.newLoginName}?
            </p>
            <button type="button" disabled={busy} onClick={() => void confirm()}>
              {busy ? "Changing…" : "Confirm"}
            </button>
            {error && (
              <p className="save-error" role="alert">
                {error}
              </p>
            )}
          </>
        )}
        {link.state === "done" && (
          <>
            <h2 className="sign-up-heading">Email changed</h2>
            <p role="status">You now log in with {link.loginName}. You're still logged in on your devices.</p>
          </>
        )}
        {link.state === "not-working" && <p role="alert">{EMAIL_LINK_NOT_WORKING}</p>}
        {link.state === "failed" && (
          <p className="save-error" role="alert">
            {link.message}
          </p>
        )}
      </div>
      <p className="login-help">
        <a href="/">Go to nwsnotes</a>
      </p>
    </main>
  );
}
