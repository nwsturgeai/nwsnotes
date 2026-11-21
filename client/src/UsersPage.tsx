import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  DISPLAY_NAME_MAX_LENGTH,
  NOTE_LIMIT_MAX,
  STYLUS_NOTE_SHARE,
  stylusNoteLimitOf,
  type Me,
  type UserSummary,
} from "@nwsnotes/shared";
import { ApiError, api } from "./api";
import { ConfirmDialog } from "./ConfirmDialog";
import { formatBytes } from "./sizes";

interface Props {
  me: Me;
  /** The admin changed their own names here. */
  onMeChanged: (me: Me) => void;
  onClose: () => void;
  onSessionExpired: () => void;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
/** Everyone's notes or their sizes, added up. */
const total = (users: UserSummary[], field: "noteCount" | "noteBytes" | "historyBytes") => users.reduce((sum, user) => sum + user[field], 0);

/** E.g. "18 Nov 2026, 09:40", in this device's time zone. */
function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** A generated password, shown once in a pop-up, with a Copy button. */
function PasswordDialog({ displayName, password, onDone }: { displayName: string; password: string; onDone: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState<string>();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied("Copied.");
    } catch {
      setCopied("Couldn't copy it: select it and copy it instead.");
    }
  }

  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-label="New password"
      onCancel={(event) => {
        event.preventDefault();
        onDone();
      }}
    >
      <p>Send this password to {displayName}. It won't be shown again.</p>
      <p className="new-password" data-testid="new-password">
        {password}
      </p>
      {copied && (
        <p className="hint" role="status">
          {copied}
        </p>
      )}
      <div className="form-buttons">
        <button type="button" className="button" onClick={() => void copy()}>
          Copy
        </button>
        <button type="button" className="button primary" onClick={onDone} autoFocus>
          Done
        </button>
      </div>
    </dialog>
  );
}

/** The display name and login name boxes, for adding a user and for editing one. */
function NameFields({
  idPrefix,
  displayName,
  loginName,
  onDisplayName,
  onLoginName,
  disabled,
}: {
  idPrefix: string;
  displayName: string;
  loginName: string;
  onDisplayName: (value: string) => void;
  onLoginName: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <>
      <label htmlFor={`${idPrefix}-display-name`}>Display name</label>
      <input
        id={`${idPrefix}-display-name`}
        type="text"
        value={displayName}
        maxLength={DISPLAY_NAME_MAX_LENGTH}
        autoComplete="off"
        disabled={disabled}
        onChange={(event) => onDisplayName(event.target.value)}
      />
      <label htmlFor={`${idPrefix}-login-name`}>Login name</label>
      <input
        id={`${idPrefix}-login-name`}
        type="text"
        value={loginName}
        maxLength={32}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        disabled={disabled}
        onChange={(event) => onLoginName(event.target.value)}
      />
    </>
  );
}

/** The admin's users page: every user, adding one, and editing, resetting and turning off the others. */
export function UsersPage({ me, onMeChanged, onClose, onSessionExpired }: Props) {
  const [users, setUsers] = useState<UserSummary[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newLoginName, setNewLoginName] = useState("");
  /** A password to show once. */
  const [shown, setShown] = useState<{ displayName: string; password: string }>();
  /** The user being edited; the note limit as typed in its box. */
  const [editing, setEditing] = useState<{ id: number; displayName: string; loginName: string; noteLimit: string }>();
  const [confirming, setConfirming] = useState<{ user: UserSummary; action: "reset" | "turn-off" }>();

  const failed = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.isUnauthorized) {
        onSessionExpired();
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    },
    [onSessionExpired],
  );

  /** The whole database's size; undefined while loading, or if it couldn't be found out. */
  const [databaseBytes, setDatabaseBytes] = useState<number>();

  const load = useCallback(async () => {
    // Fetched alongside the list; if it fails, the line is just left out.
    void api.databaseSize().then(({ bytes }) => setDatabaseBytes(bytes), () => setDatabaseBytes(undefined));
    try {
      setUsers(await api.users());
    } catch (err) {
      failed(err);
    }
  }, [failed]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  }

  const replace = (user: UserSummary) => setUsers((list) => list?.map((u) => (u.id === user.id ? user : u)));

  function add(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    void run(async () => {
      const { user, password } = await api.addUser({ displayName: newDisplayName, loginName: newLoginName });
      setUsers((list) => [...(list ?? []), user]);
      setNewDisplayName("");
      setNewLoginName("");
      setShown({ displayName: user.displayName, password });
    });
  }

  function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (busy || !editing) return;
    void run(async () => {
      const user = await api.updateUser(editing.id, {
        displayName: editing.displayName,
        loginName: editing.loginName,
        noteLimit: Number(editing.noteLimit),
      });
      replace(user);
      if (user.id === me.id) onMeChanged({ id: user.id, loginName: user.loginName, displayName: user.displayName, admin: user.admin });
      setEditing(undefined);
    });
  }

  function confirmed() {
    if (!confirming) return;
    const { user, action } = confirming;
    setConfirming(undefined);
    void run(async () => {
      if (action === "reset") {
        const { password } = await api.resetPassword(user.id);
        setShown({ displayName: user.displayName, password });
      } else {
        replace(await api.updateUser(user.id, { disabled: true }));
      }
    });
  }

  return (
    <main className="settings-page users-page">
      <h1>Users</h1>
      <p>Each person has their own notebook. Nobody, the admin included, can see anyone else's notes.</p>
      {error && (
        <p className="save-error" role="alert">
          {error}
        </p>
      )}
      {users === undefined && !error && <p>Loading…</p>}
      {users && (
        <>
          <p className="note-stats">
            All users: <strong>{plural(total(users, "noteCount"), "note")}</strong>,{" "}
            <strong>{formatBytes(total(users, "noteBytes") + total(users, "historyBytes"))}</strong> with their History.
          </p>
          {databaseBytes !== undefined && (
            <p className="note-stats database-size">
              The whole database takes up <strong>{formatBytes(databaseBytes)}</strong> of its 500 MB, including indexes and
              its own overhead.
            </p>
          )}
        </>
      )}
      {users && (
        <ul className="user-list" aria-label="Users">
          {users.map((user) => (
            <li key={user.id}>
              {editing?.id === user.id ? (
                <form className="category-form" onSubmit={saveEdit}>
                  <NameFields
                    idPrefix={`edit-${user.id}`}
                    displayName={editing.displayName}
                    loginName={editing.loginName}
                    onDisplayName={(displayName) => setEditing({ ...editing, displayName })}
                    onLoginName={(loginName) => setEditing({ ...editing, loginName })}
                    disabled={busy}
                  />
                  <label htmlFor={`edit-${user.id}-note-limit`}>Note limit</label>
                  <input
                    id={`edit-${user.id}-note-limit`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={NOTE_LIMIT_MAX}
                    step={1}
                    required
                    value={editing.noteLimit}
                    disabled={busy}
                    onChange={(event) => setEditing({ ...editing, noteLimit: event.target.value })}
                  />
                  <p className="hint">
                    {STYLUS_NOTE_SHARE * 100}% of them can be stylus notes
                    {Number.isInteger(Number(editing.noteLimit)) && Number(editing.noteLimit) >= 1
                      ? `: ${plural(stylusNoteLimitOf(Number(editing.noteLimit)), "stylus note")}.`
                      : "."}
                  </p>
                  <div className="form-buttons">
                    <button type="submit" disabled={busy}>
                      Save
                    </button>
                    <button type="button" className="button" disabled={busy} onClick={() => setEditing(undefined)}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="user-names">
                    <strong>{user.displayName}</strong> <span className="user-login">{user.loginName}</span>
                    {user.admin && <span className="user-label">Admin</span>}
                    {user.disabled && <span className="user-label off">Turned off</span>}
                  </div>
                  <p className="user-details">
                    Created {when(user.createdDateTime)} · Last logged in {user.lastLoginDateTime ? when(user.lastLoginDateTime) : "Never"} ·{" "}
                    {user.noteCount} of {plural(user.noteLimit, "note")} · {user.stylusNoteCount} of{" "}
                    {plural(user.stylusNoteLimit, "stylus note")} · {formatBytes(user.noteBytes)} ·{" "}
                    {formatBytes(user.historyBytes)} History
                  </p>
                  <div className="lifetime-buttons">
                    <button
                      type="button"
                      className="button"
                      disabled={busy}
                      onClick={() =>
                        setEditing({ id: user.id, displayName: user.displayName, loginName: user.loginName, noteLimit: String(user.noteLimit) })
                      }
                    >
                      Edit
                    </button>
                    {user.id !== me.id && (
                      <>
                        <button type="button" className="button" disabled={busy} onClick={() => setConfirming({ user, action: "reset" })}>
                          Reset password
                        </button>
                        {user.disabled ? (
                          <button
                            type="button"
                            className="button"
                            disabled={busy}
                            onClick={() => void run(async () => replace(await api.updateUser(user.id, { disabled: false })))}
                          >
                            Turn on
                          </button>
                        ) : (
                          <button type="button" className="button" disabled={busy} onClick={() => setConfirming({ user, action: "turn-off" })}>
                            Turn off
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <section>
        <h2>Add user</h2>
        <form className="category-form" onSubmit={add}>
          <NameFields
            idPrefix="new"
            displayName={newDisplayName}
            loginName={newLoginName}
            onDisplayName={setNewDisplayName}
            onLoginName={setNewLoginName}
            disabled={busy}
          />
          <p className="hint">A password is made for them, and shown once, for you to send them.</p>
          <div className="form-buttons">
            <button type="submit" disabled={busy || newDisplayName.trim() === "" || newLoginName.trim() === ""}>
              Add
            </button>
            <button type="button" className="button" onClick={onClose}>
              Done
            </button>
          </div>
        </form>
      </section>

      {confirming && (
        <ConfirmDialog
          message={
            confirming.action === "reset"
              ? `Reset ${confirming.user.displayName}'s password? They'll be logged out everywhere.`
              : `Turn off ${confirming.user.displayName}'s account? They'll be logged out everywhere and can't log in until it's turned on again.`
          }
          confirmLabel={confirming.action === "reset" ? "Reset password" : "Turn off"}
          onConfirm={confirmed}
          onCancel={() => setConfirming(undefined)}
        />
      )}
      {shown && <PasswordDialog displayName={shown.displayName} password={shown.password} onDone={() => setShown(undefined)} />}
    </main>
  );
}
