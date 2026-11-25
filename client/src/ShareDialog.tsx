import { useEffect, useRef, useState, type FormEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { SHARE_PERMISSIONS, SHARE_PERMISSION_NAMES, isValidLoginName, type SharePermission, type SharePerson } from "@nwsnotes/shared";
import { ApiError, api } from "./api";

interface Props {
  tagId: number;
  tagName: string;
  onClose: () => void;
  onSessionExpired: () => void;
}

/** Someone in the list: a person already shared with, or one being added (who may not have a name yet). */
interface Row {
  loginName: string;
  displayName?: string;
  permission: SharePermission;
  /** Asked by email, and hasn't accepted yet. */
  pending?: boolean;
}

/** "Choose someone" in the people list: typing an email address instead. */
const SOMEONE_ELSE = "";

/**
 * The app's own pop-up for sharing one of your tags: who it's shared with, and what each person may do
 * with its notes. People you're already linked with by sharing can be picked; anyone else is added by
 * their exact email address. Saving replaces the whole list.
 */
export function ShareDialog({ tagId, tagName, onClose, onSessionExpired }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [rows, setRows] = useState<Row[]>();
  const [people, setPeople] = useState<SharePerson[]>([]);
  const [choice, setChoice] = useState(SOMEONE_ELSE);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.tagShares(tagId), api.sharePeople()])
      .then(([shares, known]) => {
        if (cancelled) return;
        setRows(
          shares.map((share) => ({
            loginName: share.loginName,
            displayName: share.displayName,
            permission: share.permission,
            ...(share.pending && { pending: true }),
          })),
        );
        setPeople(known);
        // Someone already linked by sharing is the likeliest choice; otherwise the email box shows.
        const first = known.find((person) => !shares.some((share) => share.loginName === person.loginName));
        if (first) setChoice(first.loginName);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.isUnauthorized) {
          onSessionExpired();
          return;
        }
        setError(`Who it's shared with couldn't be loaded: ${err instanceof Error ? err.message : String(err)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [tagId, onSessionExpired]);

  const inList = (loginName: string) => rows?.some((row) => row.loginName.toLowerCase() === loginName.toLowerCase()) ?? false;
  const choosable = people.filter((person) => !inList(person.loginName));
  // With nobody left to pick, the email box is all there is.
  const typing = choice === SOMEONE_ELSE || !choosable.some((person) => person.loginName === choice);

  function add(event: FormEvent) {
    event.preventDefault();
    const person = typing ? undefined : choosable.find((p) => p.loginName === choice);
    const loginName = person?.loginName ?? email.trim();
    if (!isValidLoginName(loginName)) {
      setError("Type the email address they log in with, e.g. pat@example.com.");
      return;
    }
    if (inList(loginName)) {
      setError(`${person?.displayName ?? loginName} is already in the list.`);
      return;
    }
    setError(undefined);
    setRows((current) => [...(current ?? []), { loginName, displayName: person?.displayName, permission: "read" }]);
    setEmail("");
    setChoice(SOMEONE_ELSE);
  }

  async function save() {
    if (!rows || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await api.setTagShares(tagId, { shares: rows.map(({ loginName, permission }) => ({ loginName, permission })) });
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.isUnauthorized) {
        onSessionExpired();
        return;
      }
      setError(`The sharing wasn't saved: ${err instanceof Error ? err.message : String(err)}`);
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className="confirm-dialog share-dialog"
      aria-label={`Share ${tagName}`}
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
    >
      <p className="due-date-title">Share “{tagName}”</p>
      <p className="hint">
        The people you share it with see your notes with this tag, but not your other tags. Notes they add with it are yours, and count
        towards your note limit. Someone you haven't shared with before, and who hasn't shared with you, is emailed to ask if they're happy
        to see your notes: it's shared with them once they accept.
      </p>
      {rows === undefined ? (
        !error && <p>Loading…</p>
      ) : (
        <>
          {rows.length === 0 ? (
            <p className="share-none">It isn't shared with anyone.</p>
          ) : (
            <ul className="share-list">
              {rows.map((row) => (
                <li key={row.loginName}>
                  <span className="share-person">
                    <span>{row.displayName ?? row.loginName}</span>
                    {row.displayName !== undefined && <span className="share-email">{row.loginName}</span>}
                    {row.pending && <span className="share-waiting">Waiting for them to accept</span>}
                  </span>
                  <select
                    aria-label={`What ${row.displayName ?? row.loginName} may do`}
                    value={row.permission}
                    disabled={saving}
                    onChange={(event) =>
                      setRows((current) =>
                        current?.map((r) => (r.loginName === row.loginName ? { ...r, permission: event.target.value as SharePermission } : r)),
                      )
                    }
                  >
                    {SHARE_PERMISSIONS.map((permission) => (
                      <option key={permission} value={permission}>
                        {SHARE_PERMISSION_NAMES[permission]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="note-button"
                    aria-label={`Stop sharing with ${row.displayName ?? row.loginName}`}
                    title="Stop sharing"
                    disabled={saving}
                    onClick={() => setRows((current) => current?.filter((r) => r.loginName !== row.loginName))}
                  >
                    <FontAwesomeIcon icon={faXmark} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form className="share-add" onSubmit={add}>
            {choosable.length > 0 && (
              <select aria-label="Person to share with" value={typing ? SOMEONE_ELSE : choice} disabled={saving} onChange={(event) => setChoice(event.target.value)}>
                {choosable.map((person) => (
                  <option key={person.loginName} value={person.loginName}>
                    {person.displayName} ({person.loginName})
                  </option>
                ))}
                <option value={SOMEONE_ELSE}>Someone else…</option>
              </select>
            )}
            {typing && (
              <input
                type="email"
                aria-label="Their email address"
                placeholder="Their email address"
                autoComplete="off"
                value={email}
                disabled={saving}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
            <button type="submit" className="button" disabled={saving}>
              Add
            </button>
          </form>
        </>
      )}
      {error && (
        <p className="save-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-buttons">
        <button type="button" className="button primary" disabled={rows === undefined || saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" className="button" disabled={saving} onClick={onClose}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
