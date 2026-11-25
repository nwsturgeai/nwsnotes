import { useEffect, useState } from "react";
import { SHARE_INVITE_NOT_WORKING, type ShareInviteLink } from "@nwsnotes/shared";
import { ApiError, api } from "./api";

type LinkState =
  | { state: "checking" }
  | { state: "ready"; link: ShareInviteLink }
  | { state: "done"; accepted: boolean; ownerName: string }
  | { state: "not-working" }
  /** The check couldn't be made (e.g. the server can't be reached). */
  | { state: "failed"; message: string };

/** "Shopping", or "Shopping" and "Home", or "Shopping", "Home" and "Work". */
function quotedList(names: string[]): string {
  const quoted = names.map((name) => `“${name}”`);
  return quoted.length <= 1 ? (quoted[0] ?? "") : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
}

/**
 * The page a sharing request's emailed link opens: someone new wants to share notes with you, and you
 * accept or turn it down. Nothing happens on opening, only on pressing a button, so an email app or
 * scanner that opens links can't answer it. As on the confirm-email page, the token is after the #, and is
 * taken from the address bar as soon as it's read.
 */
export function ShareInvitePage() {
  const [token] = useState(() => decodeURIComponent(window.location.hash.slice(1)));
  const [link, setLink] = useState<LinkState>({ state: "checking" });
  const [busy, setBusy] = useState<"accept" | "decline">();
  const [error, setError] = useState<string>();

  useEffect(() => {
    // Not left in the browser's history.
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    let current = true;
    const check = token === "" ? Promise.reject(new Error(SHARE_INVITE_NOT_WORKING)) : api.checkShareInvite(token);
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

  async function answer(accept: boolean) {
    if (busy || link.state !== "ready") return;
    setBusy(accept ? "accept" : "decline");
    setError(undefined);
    try {
      await api.answerShareInvite(token, accept);
      setLink({ state: "done", accepted: accept, ownerName: link.link.ownerName });
    } catch (err) {
      if (err instanceof ApiError && err.message === SHARE_INVITE_NOT_WORKING) setLink({ state: "not-working" });
      else setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(undefined);
  }

  return (
    <main className="login-page">
      <div className="login-card">
        <h1>nwsnotes</h1>
        {link.state === "checking" && <p role="status">Checking the link…</p>}
        {link.state === "ready" && (
          <>
            <h2 className="sign-up-heading">Notes shared with you</h2>
            <p>
              {link.link.ownerName} ({link.link.ownerLoginName}) would like to share their notes tagged {quotedList(link.link.tagNames)} with
              you.
            </p>
            <p>Are you happy to see notes shared by {link.link.ownerName}?</p>
            <div className="form-buttons">
              <button type="button" className="button primary" disabled={busy !== undefined} onClick={() => void answer(true)}>
                {busy === "accept" ? "Accepting…" : "Yes, accept"}
              </button>
              <button type="button" className="button" disabled={busy !== undefined} onClick={() => void answer(false)}>
                {busy === "decline" ? "Turning down…" : "No, turn it down"}
              </button>
            </div>
            {error && (
              <p className="save-error" role="alert">
                {error}
              </p>
            )}
          </>
        )}
        {link.state === "done" && (
          <>
            <h2 className="sign-up-heading">{link.accepted ? "Sharing accepted" : "Sharing turned down"}</h2>
            <p role="status">
              {link.accepted
                ? `You can now see the notes ${link.ownerName} has shared with you, in "Shared with me".`
                : `You won't see ${link.ownerName}'s notes. We've let them know.`}
            </p>
          </>
        )}
        {link.state === "not-working" && <p role="alert">{SHARE_INVITE_NOT_WORKING}</p>}
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
