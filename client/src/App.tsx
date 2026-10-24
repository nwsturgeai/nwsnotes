import { useCallback, useEffect, useState } from "react";
import type { Note } from "@nwsnotes/shared";
import { ApiError, api } from "./api";
import { ErrorPage } from "./ErrorPage";
import { LoginPage } from "./LoginPage";
import { NotesPage } from "./NotesPage";

type State =
  | { screen: "loading" }
  | { screen: "login" }
  | { screen: "notes"; notes: Note[] }
  | { screen: "error"; error: unknown; when: Date };

export function App() {
  const [state, setState] = useState<State>({ screen: "loading" });

  const loadNotes = useCallback(async () => {
    setState({ screen: "loading" });
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

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setState({ screen: "login" });
    }
  }, []);

  switch (state.screen) {
    case "loading":
      return <p className="loading">Loading...</p>;
    case "login":
      return <LoginPage onLoggedIn={loadNotes} />;
    case "error":
      return <ErrorPage error={state.error} when={state.when} onRetry={loadNotes} />;
    case "notes":
      return (
        <NotesPage
          notes={state.notes}
          onNoteAdded={(note) =>
            setState((prev) => (prev.screen === "notes" ? { screen: "notes", notes: [...prev.notes, note] } : prev))
          }
          onSessionExpired={() => setState({ screen: "login" })}
          onLogout={logout}
        />
      );
  }
}
