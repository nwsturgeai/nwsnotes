interface Props {
  onLogout: () => void;
}

export function SettingsPage({ onLogout }: Props) {
  return (
    <main className="settings-page">
      <h1>Settings</h1>

      <section>
        <h2>Backup</h2>
        <p>Download the latest save-file from the server. It contains all your notes.</p>
        {/* A plain link: the session cookie is sent with it, and the server names the file. */}
        <a className="button" href="/api/notes/download" download>
          Download backup
        </a>
      </section>

      <section>
        <h2>Account</h2>
        <button type="button" className="button" onClick={onLogout}>
          Log out
        </button>
      </section>
    </main>
  );
}
