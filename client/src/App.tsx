import { useCallback, useEffect, useRef, useState } from "react";
import type { Category, Note, NotesData, Tab } from "@nwsnotes/shared";
import { ApiError, api } from "./api";
import { CategoryEditPage } from "./CategoryEditPage";
import { ErrorPage } from "./ErrorPage";
import { Header } from "./Header";
import { useLiveUpdates } from "./live";
import { LoginPage } from "./LoginPage";
import { NotesPage } from "./NotesPage";
import { usePage } from "./route";
import { SettingsPage } from "./SettingsPage";
import { useStylusMode } from "./stylusMode";
import { TabEditPage } from "./TabEditPage";
import type { TagSelection } from "./TagPickers";

type State =
  | { screen: "loading" }
  | { screen: "login" }
  | { screen: "notes"; data: NotesData }
  | { screen: "error"; error: unknown; when: Date };

export function App() {
  const [state, setState] = useState<State>({ screen: "loading" });
  const [page, navigate] = usePage();
  const [stylusMode, setStylusMode] = useStylusMode();
  const [refreshError, setRefreshError] = useState<string>();
  /** The new-note tag dropdowns' selections; kept until the page is reloaded or the tab changes. */
  const [tagSelection, setTagSelection] = useState<TagSelection>({});
  /** The selected tab's id, or undefined for "All" (selected when the page opens). */
  const [selectedTabId, setSelectedTabId] = useState<number>();
  /** Numbers each background reload, so only the newest one's result is used. */
  const latestRefresh = useRef(0);
  const refreshInProgress = useRef(false);

  const loadNotes = useCallback(async () => {
    setState({ screen: "loading" });
    setRefreshError(undefined);
    try {
      const data = await api.getNotes();
      setState({ screen: "notes", data });
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        setState({ screen: "login" });
      } else {
        setState({ screen: "error", error, when: new Date() });
      }
    }
  }, []);

  /** Reloads notes and categories in the background: no "Loading...", and a failure only shows a notice. */
  const refreshNotes = useCallback(async () => {
    const thisRefresh = ++latestRefresh.current;
    refreshInProgress.current = true;
    try {
      const data = await api.getNotes();
      if (thisRefresh !== latestRefresh.current) return;
      setRefreshError(undefined);
      setState((prev) => (prev.screen === "notes" ? { screen: "notes", data } : prev));
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

  /** Applies a change this page just saved. */
  const applySaved = useCallback(
    (change: (data: NotesData) => NotesData) => {
      setState((prev) => (prev.screen === "notes" ? { screen: "notes", data: change(prev.data) } : prev));
      // A reload that started before this change was saved would leave it out, so start a fresh one.
      if (refreshInProgress.current) void refreshNotes();
    },
    [refreshNotes],
  );

  const addNote = useCallback(
    (note: Note) =>
      applySaved((data) =>
        data.notes.some((existing) => existing.id === note.id) ? data : { ...data, notes: [...data.notes, note] },
      ),
    [applySaved],
  );

  const saveCategory = useCallback(
    (category: Category) =>
      applySaved((data) => ({
        ...data,
        categories: data.categories.some((c) => c.id === category.id)
          ? data.categories.map((c) => (c.id === category.id ? category : c))
          : [...data.categories, category],
      })),
    [applySaved],
  );

  const saveTab = useCallback(
    (tab: Tab) =>
      applySaved((data) => ({
        ...data,
        tabs: data.tabs.some((t) => t.id === tab.id) ? data.tabs.map((t) => (t.id === tab.id ? tab : t)) : [...data.tabs, tab],
      })),
    [applySaved],
  );

  const deleteTab = useCallback(
    (id: number) => applySaved((data) => ({ ...data, tabs: data.tabs.filter((t) => t.id !== id) })),
    [applySaved],
  );

  /** Changing tab resets the new-note dropdowns (the tab's locked tags are applied on top). */
  const selectTab = useCallback((id: number | undefined) => {
    setSelectedTabId(id);
    setTagSelection({});
  }, []);

  const tabs = state.screen === "notes" ? state.data.tabs : [];
  const selectedTab = tabs.find((tab) => tab.id === selectedTabId);
  // If the selected tab is deleted (here or on another page), go back to "All".
  useEffect(() => {
    if (selectedTabId !== undefined && state.screen === "notes" && !selectedTab) selectTab(undefined);
  }, [selectedTabId, selectedTab, state.screen, selectTab]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      navigate({ name: "notes" }, { replace: true });
      setState({ screen: "login" });
    }
  }, [navigate]);

  const sessionExpired = useCallback(() => setState({ screen: "login" }), []);

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
            stylusMode={stylusMode}
            tabs={tabs}
            selectedTabId={selectedTab?.id}
            onSelectTab={selectTab}
            onNavigate={navigate}
            refreshError={refreshError}
            onRetryRefresh={() => void refreshNotes()}
          />
          {page.name === "settings" ? (
            <SettingsPage
              categories={state.data.categories}
              tabs={tabs}
              stylusMode={stylusMode}
              onStylusModeChange={setStylusMode}
              onNavigate={navigate}
              onLogout={logout}
            />
          ) : page.name === "category" ? (
            <CategoryEditPage
              id={page.id}
              categories={state.data.categories}
              onSaved={saveCategory}
              onClose={() => navigate({ name: "settings" })}
              onSessionExpired={sessionExpired}
            />
          ) : page.name === "tab" ? (
            <TabEditPage
              id={page.id}
              tabs={tabs}
              categories={state.data.categories}
              onSaved={saveTab}
              onDeleted={deleteTab}
              onClose={() => navigate({ name: "settings" })}
              onSessionExpired={sessionExpired}
            />
          ) : (
            <NotesPage
              notes={state.data.notes}
              categories={state.data.categories}
              selectedTab={selectedTab}
              stylusMode={stylusMode}
              tagSelection={tagSelection}
              onTagSelectionChange={setTagSelection}
              onNoteAdded={addNote}
              onSessionExpired={sessionExpired}
            />
          )}
        </div>
      );
  }
}
