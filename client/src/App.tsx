import { useCallback, useEffect, useRef, useState } from "react";
import type { Category, Note, NotesData, Tab } from "@nwsnotes/shared";
import { ApiError, api } from "./api";
import { CategoryEditPage } from "./CategoryEditPage";
import { ErrorPage } from "./ErrorPage";
import { Header } from "./Header";
import { useLiveUpdates } from "./live";
import { LoginPage } from "./LoginPage";
import { NotesPage } from "./NotesPage";
import {
  goOffline,
  initOffline,
  isOffline,
  markOnline,
  probe,
  rememberData,
  savedData,
  setOfflineHandlers,
  useOfflineState,
  withPending,
} from "./offline";
import { usePage } from "./route";
import { SettingsPage } from "./SettingsPage";
import { useColumns, useStylusMode } from "./stylusMode";
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
  const [columns, setColumns] = useColumns();
  const [refreshError, setRefreshError] = useState<string>();
  /** The new-note tag dropdowns' selections; kept until the page is reloaded or the tab changes. */
  const [tagSelection, setTagSelection] = useState<TagSelection>({});
  /** The selected tab's id, or undefined for "All" (selected when the page opens). */
  const [selectedTabId, setSelectedTabId] = useState<number>();
  /**
   * The note being edited, as it was when editing started (live updates don't change an open edit).
   * While set, the tabs, the Settings cog and the other notes' edit icons are blocked.
   */
  const [editingNote, setEditingNote] = useState<Note>();
  /** Multi-select (bulk tag editing) is on: the tabs and the Settings cog are blocked, as during an edit. */
  const [bulkActive, setBulkActive] = useState(false);
  /** Numbers each background reload, so only the newest one's result is used. */
  const latestRefresh = useRef(0);
  const refreshInProgress = useRef(false);

  const offlineState = useOfflineState();
  /** A short message for the notes page after a sync ("3 offline changes saved"). */
  const [syncNotice, setSyncNotice] = useState<{ text: string; error?: boolean; key: number }>();

  /**
   * Loads everything at startup (and after logging in). If the server can't be reached, the app
   * opens offline from the copy saved on this device; only without one is the error page shown.
   * Changes still waiting to be sent are always laid over what's loaded.
   */
  const loadNotes = useCallback(async () => {
    setState({ screen: "loading" });
    setRefreshError(undefined);
    await initOffline();
    try {
      const data = await api.getNotes();
      setState({ screen: "notes", data: withPending(data) });
      markOnline();
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        setState({ screen: "login" });
        return;
      }
      const saved = error instanceof ApiError && error.isNetworkError ? await savedData() : undefined;
      if (saved) {
        goOffline();
        setState({ screen: "notes", data: withPending(saved) });
      } else {
        setState({ screen: "error", error, when: new Date() });
      }
    }
  }, []);

  /**
   * Reloads notes and categories in the background: no "Loading...", and a failure only shows a notice.
   * Offline there's nothing to reload, so it just lays the waiting changes over what's shown.
   */
  const refreshNotes = useCallback(async () => {
    if (isOffline()) {
      setState((prev) => (prev.screen === "notes" ? { screen: "notes", data: withPending(prev.data) } : prev));
      // A reload is also asked for when the live-update connection comes back, so check for the server.
      void probe();
      return;
    }
    const thisRefresh = ++latestRefresh.current;
    refreshInProgress.current = true;
    try {
      const data = await api.getNotes();
      if (thisRefresh !== latestRefresh.current) return;
      setRefreshError(undefined);
      setState((prev) => (prev.screen === "notes" ? { screen: "notes", data: withPending(data) } : prev));
      markOnline();
    } catch (error) {
      if (thisRefresh !== latestRefresh.current) return;
      if (error instanceof ApiError && error.isUnauthorized) {
        setState({ screen: "login" });
      } else if (error instanceof ApiError && error.isNetworkError) {
        // Not an error to report: the offline icon shows it, and the app checks for the server.
        goOffline();
      } else {
        setRefreshError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (thisRefresh === latestRefresh.current) refreshInProgress.current = false;
    }
  }, []);

  // What's shown is saved on this device, for opening the app offline.
  useEffect(() => {
    if (state.screen === "notes") rememberData(state.data);
  }, [state]);

  // Going offline clears any "couldn't load" notice: the offline icon says it instead.
  useEffect(() => {
    if (offlineState.offline) setRefreshError(undefined);
  }, [offlineState.offline]);

  // What syncing the offline changes does to what's shown.
  useEffect(() => {
    setOfflineHandlers({
      onSynced: (saved, lost) => {
        const savedText = saved > 0 ? `${saved} offline ${saved === 1 ? "change" : "changes"} saved.` : "";
        const lostText = lost.length > 0 ? ` The change to ${lost.join(", ")} couldn't be saved and was dropped.` : "";
        setSyncNotice({ text: (savedText + lostText).trim(), error: lost.length > 0, key: Date.now() });
        void refreshNotes();
      },
      onRemapped: (tempId, note) =>
        setState((prev) =>
          prev.screen === "notes"
            ? {
                screen: "notes",
                data: {
                  ...prev.data,
                  notes: prev.data.notes.map((n) =>
                    n.id === tempId ? note : n.parentId === tempId ? { ...n, parentId: note.id } : n,
                  ),
                },
              }
            : prev,
        ),
      onSessionExpired: () => setState({ screen: "login" }),
    });
  }, [refreshNotes]);

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
          : // New categories go before the built-in Lifetime one, which the server always sends last.
            [...data.categories.filter((c) => !c.system), category, ...data.categories.filter((c) => c.system)],
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

  const updateNote = useCallback(
    (note: Note) => applySaved((data) => ({ ...data, notes: data.notes.map((n) => (n.id === note.id ? note : n)) })),
    [applySaved],
  );

  const endEdit = useCallback(() => setEditingNote(undefined), []);

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
            editing={editingNote !== undefined || bulkActive}
            onNavigate={navigate}
            refreshError={refreshError}
            onRetryRefresh={() => void refreshNotes()}
            offline={offlineState.offline}
            pendingCount={offlineState.pendingCount}
          />
          {offlineState.offline && page.name !== "notes" ? (
            // Settings (and category and tab editing) need the server.
            <main className="settings-page">
              <h1>Settings</h1>
              <p>Settings aren't available offline. They'll be back once there's a connection.</p>
              <a
                href="/"
                className="button"
                onClick={(event) => {
                  event.preventDefault();
                  navigate({ name: "notes" });
                }}
              >
                ← Notes
              </a>
            </main>
          ) : page.name === "settings" ? (
            <SettingsPage
              notes={state.data.notes}
              categories={state.data.categories}
              tabs={tabs}
              stylusMode={stylusMode}
              onStylusModeChange={setStylusMode}
              columns={columns}
              onColumnsChange={setColumns}
              onNavigate={navigate}
              onNotesChanged={() => void refreshNotes()}
              onSessionExpired={sessionExpired}
              onLogout={logout}
            />
          ) : page.name === "category" ? (
            <CategoryEditPage
              id={page.id}
              categories={state.data.categories}
              notes={state.data.notes}
              onSaved={(category) => {
                saveCategory(category);
                // Deleted tags were also removed from notes and tabs on the server; reload to match.
                void refreshNotes();
              }}
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
              columns={columns}
              tagSelection={tagSelection}
              onTagSelectionChange={setTagSelection}
              editingNote={editingNote}
              onEditStart={setEditingNote}
              onEditEnd={endEdit}
              onNoteAdded={addNote}
              onNoteUpdated={updateNote}
              onNotesChanged={() => void refreshNotes()}
              onTabUpdated={saveTab}
              onBulkChange={setBulkActive}
              offline={offlineState.offline}
              pendingIds={offlineState.pendingIds}
              syncNotice={syncNotice}
              onSessionExpired={sessionExpired}
            />
          )}
        </div>
      );
  }
}
