import { useCallback, useEffect, useRef, useState } from "react";
import type { Note } from "@nwsnotes/shared";
import { ApiError, api } from "./api";
import { ErrorPage } from "./ErrorPage";
import { Header } from "./Header";
import { useLiveUpdates } from "./live";
import { LoginPage } from "./LoginPage";
import { NotesPage } from "./NotesPage";
import { usePage } from "./route";
import { SettingsPage } from "./SettingsPage";

type State =
  | { screen: "loading" }
  | { screen: "login" }
  | { screen: "notes"; notes: Note[] }
  | { screen: "error"; error: unknown; when: Date };

export function App() {
  const [state, setState] = useState<State>({ screen: "loading" });
  const [page, navigate] = usePage();
  const [refreshError, setRefreshError] = useState<string>();
  /** Numbers each background reload, so only the newest one's result is used. */
  const latestRefresh = useRef(0);
  const refreshInProgress = useRef(false);

  const loadNotes = useCallback(async () => {
    setState({ screen: "loading" });
    setRefreshError(undefined);
    try {
      const notes = await api.getNotes();
      setState({ screen: "notes", notes });
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        setState({ screen: "login" });
      } else {
        setState({ screen: "error", error, when: new Date() });
      }
    }
  }, []);

  /** Reloads the notes in the background: no "Loading...", and a failure only shows a notice. */
  const refreshNotes = useCallback(async () => {
    const thisRefresh = ++latestRefresh.current;
    refreshInProgress.current = true;
    try {
      const notes = await api.getNotes();
      if (thisRefresh !== latestRefresh.current) return;
      setRefreshError(undefined);
      setState((prev) => (prev.screen === "notes" ? { screen: "notes", notes } : prev));
    } catch (error) {
      if (thisRefresh !== latestRefresh.current) return;
      if (error instanceof ApiError && error.isUnauthorized) {
        setState({ screen: "login" });
      } else {
        setRefreshError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (thisRefresh === latestRefresh.current) refreshInProgress.current = false;
    }
  }, []);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  useLiveUpdates(state.screen === "notes", refreshNotes);

  const addNote = useCallback(
    (note: Note) => {
      setState((prev) =>
        prev.screen === "notes" && !prev.notes.some((existing) => existing.id === note.id)
          ? { screen: "notes", notes: [...prev.notes, note] }
          : prev,
      );
      // A reload that started before this note was saved would leave it out, so start a fresh one.
      if (refreshInProgress.current) void refreshNotes();
    },
    [refreshNotes],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      navigate("notes", { replace: true });
      setState({ screen: "login" });
    }
  }, [navigate]);

  switch (state.screen) {
    case "loading":
      return <p className="loading">Loading...</p>;
    case "login":
      return <LoginPage onLoggedIn={loadNotes} />;
    case "error":
      return <ErrorPage error={state.error} when={state.when} onRetry={loadNotes} />;
    case "notes":
      return (
        <div className="app">
          <Header
            page={page}
            onNavigate={navigate}
            refreshError={refreshError}
            onRetryRefresh={() => void refreshNotes()}
          />
          {page === "settings" ? (
            <SettingsPage onLogout={logout} />
          ) : (
            <NotesPage
              notes={state.notes}
              onNoteAdded={addNote}
              onSessionExpired={() => setState({ screen: "login" })}
            />
          )}
        </div>
      );
  }
}
