import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ALL_TAB_NAME, noteMatchesFilters, type Category, type Me, type Note, type NotesData, type Tab } from "@nwsnotes/shared";
import { ApiError, api } from "./api";
import { useUpdateReady } from "./appUpdate";
import { CategoryEditPage } from "./CategoryEditPage";
import { ErrorPage } from "./ErrorPage";
import { Header } from "./Header";
import { useLiveUpdates } from "./live";
import { LoginPage } from "./LoginPage";
import { NotesPage } from "./NotesPage";
import {
  clearOfflineUser,
  goOffline,
  isOffline,
  markOnline,
  probe,
  rememberData,
  savedData,
  savedUser,
  setOfflineHandlers,
  setOfflineUser,
  useOfflineState,
  withPending,
} from "./offline";
import { registerReminders, turnOffReminders } from "./reminders";
import { usePage, type Page } from "./route";
import { HistoryPage } from "./HistoryPage";
import { PasswordPage } from "./PasswordPage";
import { NamePage } from "./NamePage";
import { EmailPage } from "./EmailPage";
import { UsersPage } from "./UsersPage";
import { ServerLogPage } from "./ServerLogPage";
import { SettingsPage, type SettingsSection } from "./SettingsPage";
import { tabSharedOut } from "./sharingIcons";
import { useColumns, useStylusMode, useTabCounts } from "./stylusMode";
import { TabEditPage } from "./TabEditPage";
import type { TagSelection } from "./TagPickers";

type State =
  | { screen: "loading" }
  | { screen: "login" }
  | { screen: "notes"; data: NotesData; me: Me }
  | { screen: "error"; error: unknown; when: Date };

/** The longest logging out waits for this device's reminders to be turned off. */
const LOGOUT_REMINDERS_WAIT_MS = 3000;

/** No new-note tags chosen (one object, so it stays the same between renders). */
const NO_TAGS: TagSelection = {};

export function App() {
  const [state, setState] = useState<State>({ screen: "loading" });
  /** Back and Forward do nothing while a note is being edited or notes selected (set below, once that's known). */
  const historyBlocked = useRef<boolean>(false);
  /** History entries to pass over (set by the notes page: long-form notes its Cancel deleted). */
  const historySkip = useRef<(page: Page) => boolean>(undefined);
  const [page, navigate] = usePage(historyBlocked, historySkip);
  const [stylusMode, setStylusMode] = useStylusMode();
  const [columns, setColumns] = useColumns();
  const [showTabCounts, setShowTabCounts] = useTabCounts();
  const [refreshError, setRefreshError] = useState<string>();
  /**
   * The selected tab's id, or undefined for "All": the notes page's address says which ("/?tab=3"), so
   * each tab change is a history entry. On other pages (Settings) it's the tab the notes were last on.
   */
  const lastNotes = useRef<Page & { name: "notes" }>({ name: "notes" });
  if (page.name === "notes") lastNotes.current = page;
  const selectedTabId = lastNotes.current.tab;
  /** The new-note tag dropdowns' selections, for the tab they were made on; kept until the page is reloaded or the tab changes. */
  const [tagState, setTagState] = useState<{ tabId: number | undefined; selection: TagSelection }>({ tabId: undefined, selection: {} });
  const tagSelection = tagState.tabId === selectedTabId ? tagState.selection : NO_TAGS;
  const setTagSelection = useCallback((selection: TagSelection) => setTagState({ tabId: selectedTabId, selection }), [selectedTabId]);
  // Changing tab (by Back too) resets them (the tab's locked tags are applied on top).
  useEffect(() => {
    setTagState((prev) => (prev.tabId === selectedTabId ? prev : { tabId: selectedTabId, selection: {} }));
  }, [selectedTabId]);
  /**
   * The note being edited, as it was when editing started (live updates don't change an open edit).
   * While set, the tabs, the Settings cog and the other notes' edit icons are blocked.
   */
  const [editingNote, setEditingNote] = useState<Note>();
  /** Multi-select (bulk tag editing) is on: the tabs and the Settings cog are blocked, as during an edit. */
  const [bulkActive, setBulkActive] = useState(false);
  /** The notes page has unsaved work, so the "new version" notice (whose Reload would lose it) is hidden. */
  const [notesUnsaved, setNotesUnsaved] = useState(false);
  /** The note being edited has no title (or is being saved), so nothing else can be used until it's finished. */
  const [editLocked, setEditLocked] = useState(false);
  /** The tabs and cog are blocked: while an edit can't be saved by using them (see NotesPage), or in multi-select. */
  const tabsBlocked = (editingNote !== undefined && editLocked) || bulkActive;
  // While a note is being edited (whose tabs save it first) or notes are being selected, Back and Forward
  // do nothing, rather than change tab under the edit or the selection.
  historyBlocked.current = page.name === "notes" && (editingNote !== undefined || bulkActive);
  const updateReady = useUpdateReady();
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
    // Who is logged in decides which offline copy and outbox are this user's, so that comes first.
    const notesRequest = api.getNotes();
    notesRequest.catch(() => undefined);
    let me: Me | undefined;
    try {
      me = await api.me();
      await setOfflineUser(me);
      const data = await notesRequest;
      setState({ screen: "notes", data: withPending(data), me });
      markOnline();
      registerReminders();
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        setState({ screen: "login" });
        return;
      }
      // Offline: the copy saved on this device for whoever was last logged in here.
      const user = me ?? savedUser();
      let saved: NotesData | undefined;
      if (user && error instanceof ApiError && error.isNetworkError) {
        await setOfflineUser(user);
        saved = await savedData();
      }
      if (user && saved) {
        goOffline();
        setState({ screen: "notes", data: withPending(saved), me: user });
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
      setState((prev) => (prev.screen === "notes" ? { ...prev, data: withPending(prev.data) } : prev));
      // A reload is also asked for when the live-update connection comes back, so check for the server.
      void probe();
      return;
    }
    const thisRefresh = ++latestRefresh.current;
    refreshInProgress.current = true;
    try {
      // Who is logged in too, as an admin's count of account requests waiting may have changed.
      const meRequest = api.me().catch(() => undefined);
      const data = await api.getNotes();
      const me = await meRequest;
      if (thisRefresh !== latestRefresh.current) return;
      setRefreshError(undefined);
      setState((prev) => (prev.screen === "notes" ? { ...prev, data: withPending(data), me: me ?? prev.me } : prev));
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
                ...prev,
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
      // Another tab queued (or sent) changes: show them here too.
      onPendingChanged: () => setState((prev) => (prev.screen === "notes" ? { ...prev, data: withPending(prev.data) } : prev)),
      // Logged out in another tab: this one goes to the login page too.
      onLoggedOut: () => {
        navigate({ name: "notes" }, { replace: true });
        setState({ screen: "login" });
      },
    });
  }, [refreshNotes, navigate]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  useLiveUpdates(state.screen === "notes", refreshNotes);

  /** Applies a change this page just saved. */
  const applySaved = useCallback(
    (change: (data: NotesData) => NotesData) => {
      setState((prev) => (prev.screen === "notes" ? { ...prev, data: change(prev.data) } : prev));
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
          : // New categories go before the built-in ones (Shared with me, then Lifetime), which the server always sends last.
            [...data.categories.filter((c) => !c.system && !c.shared), category, ...data.categories.filter((c) => c.system || c.shared)],
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

  /** Changing tab opens it as a new page in the browser's history, so Back goes to the tab before. */
  const selectTab = useCallback(
    (id: number | undefined) => {
      // An open long-form note stays open.
      if (id !== selectedTabId) navigate({ name: "notes", tab: id, note: lastNotes.current.note }, { newEntry: true });
    },
    [selectedTabId, navigate],
  );

  const tabs = state.screen === "notes" ? state.data.tabs : [];
  /** Whether the built-in "All" tab is in the left strip (data saved offline before this existed counts as top). */
  const allOnLeft = state.screen === "notes" && state.data.allTabPlacement === "left";
  const notes = state.screen === "notes" ? state.data.notes : undefined;
  /**
   * With the Tab counts setting on: each tab's number of notes, by its own filters only (the filter row
   * and search don't change them). Bin notes count only where a tab's own filters include Bin.
   */
  const tabCounts = useMemo(() => {
    if (!showTabCounts || !notes) return undefined;
    const counts = new Map<number | "all", number>([["all", notes.filter((note) => noteMatchesFilters(note, [])).length]]);
    for (const tab of tabs) counts.set(tab.id, notes.filter((note) => noteMatchesFilters(note, tab.categories)).length);
    return counts;
  }, [showTabCounts, notes, tabs]);
  const selectedTab = tabs.find((tab) => tab.id === selectedTabId);
  // If the selected tab is deleted (here or on another page), or the address names one that isn't there, go back to "All".
  useEffect(() => {
    if (selectedTabId === undefined || state.screen !== "notes" || selectedTab) return;
    if (page.name === "notes") navigate({ name: "notes", note: page.note }, { replace: true });
    else lastNotes.current = { name: "notes", note: lastNotes.current.note };
  }, [selectedTabId, selectedTab, state.screen, page.name, navigate]);

  const logout = useCallback(async () => {
    try {
      // This device stops getting reminders (while the session still lets it tell the server). That waits
      // for the service worker, which never comes if it didn't install, so logging out doesn't wait long.
      await Promise.race([
        turnOffReminders().catch((error: unknown) => console.warn("Couldn't turn off reminders:", error)),
        new Promise((resolve) => setTimeout(resolve, LOGOUT_REMINDERS_WAIT_MS)),
      ]);
      await api.logout();
    } finally {
      // This user's offline copy (and any changes still waiting, which the settings page asked about) goes.
      await clearOfflineUser();
      navigate({ name: "notes" }, { replace: true });
      setState({ screen: "login" });
    }
  }, [navigate]);

  const sessionExpired = useCallback(() => setState({ screen: "login" }), []);
  /** A message for the settings page after coming back to it (e.g. after changing the password). */
  const [settingsNotice, setSettingsNotice] = useState<string>();
  /** The settings section to open at, after saving or cancelling a category or a tab. */
  const [settingsSection, setSettingsSection] = useState<SettingsSection>();
  useEffect(() => {
    if (page.name !== "settings" && page.name !== "password" && page.name !== "name" && page.name !== "email") setSettingsNotice(undefined);
  }, [page.name]);

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
            tabs={tabs.filter((tab) => tab.placement !== "left")}
            categories={state.data.categories}
            allOnTop={!allOnLeft}
            leftStrip={allOnLeft || tabs.some((tab) => tab.placement === "left")}
            tabCounts={tabCounts}
            selectedTabId={selectedTab?.id}
            onSelectTab={selectTab}
            editing={tabsBlocked}
            notesPage={lastNotes.current}
            onNavigate={navigate}
            refreshError={refreshError}
            onRetryRefresh={() => void refreshNotes()}
            offline={offlineState.offline}
            pendingCount={offlineState.pendingCount}
            showUpdateNotice={updateReady && !notesUnsaved}
            accountsWaiting={state.me.admin ? state.me.accountsWaiting : undefined}
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
                  navigate(lastNotes.current);
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
              allTabPlacement={state.data.allTabPlacement ?? "top"}
              stylusMode={stylusMode}
              onStylusModeChange={setStylusMode}
              columns={columns}
              onColumnsChange={setColumns}
              tabCounts={showTabCounts}
              onTabCountsChange={setShowTabCounts}
              onNavigate={navigate}
              onNotesChanged={() => void refreshNotes()}
              onCategoriesReordered={(categories) => applySaved((data) => ({ ...data, categories }))}
              onTabsReordered={(tabs) => applySaved((data) => ({ ...data, tabs }))}
              onSessionExpired={sessionExpired}
              onLogout={logout}
              me={state.me}
              pendingCount={offlineState.pendingCount}
              notice={settingsNotice}
              scrollTo={settingsSection}
              onScrolled={() => setSettingsSection(undefined)}
            />
          ) : page.name === "password" ? (
            <PasswordPage
              onChanged={() => {
                setSettingsNotice("Password changed. Your other devices have been logged out.");
                navigate({ name: "settings" });
              }}
              onClose={() => navigate({ name: "settings" })}
              onSessionExpired={sessionExpired}
            />
          ) : page.name === "name" ? (
            <NamePage
              me={state.me}
              onChanged={(me) => {
                setState((prev) => (prev.screen === "notes" ? { ...prev, me: { ...prev.me, ...me } } : prev));
                setSettingsNotice("Name changed.");
                navigate({ name: "settings" });
              }}
              onClose={() => navigate({ name: "settings" })}
              onSessionExpired={sessionExpired}
            />
          ) : page.name === "email" ? (
            <EmailPage
              me={state.me}
              onSent={(loginName) => {
                setSettingsNotice(
                  `We've sent a link to ${loginName}. Your email will change once you open it (it works for 24 hours). Until then, keep logging in with ${state.me.loginName}.`,
                );
                navigate({ name: "settings" });
              }}
              onClose={() => navigate({ name: "settings" })}
              onSessionExpired={sessionExpired}
            />
          ) : page.name === "users" && state.me.admin ? (
            <UsersPage
              me={state.me}
              onMeChanged={(me) => setState((prev) => (prev.screen === "notes" ? { ...prev, me: { ...prev.me, ...me } } : prev))}
              onClose={() => navigate({ name: "settings" })} onSessionExpired={sessionExpired} />
          ) : page.name === "serverLog" && state.me.admin ? (
            <ServerLogPage onClose={() => navigate({ name: "settings" })} onSessionExpired={sessionExpired} />
          ) : page.name === "history" ? (
            <HistoryPage onReverted={() => void refreshNotes()} onSessionExpired={sessionExpired} />
          ) : page.name === "category" ? (
            <CategoryEditPage
              id={page.id}
              categories={state.data.categories}
              notes={state.data.notes}
              tabs={tabs}
              onTabSaved={saveTab}
              onSaved={(category) => {
                saveCategory(category);
                // Deleted tags were also removed from notes and tabs on the server; reload to match.
                void refreshNotes();
              }}
              onClose={() => {
                setSettingsSection("categories");
                navigate({ name: "settings" });
              }}
              onSessionExpired={sessionExpired}
            />
          ) : page.name === "tab" ? (
            <TabEditPage
              id={page.id}
              tabs={tabs}
              allTabPlacement={state.data.allTabPlacement ?? "top"}
              onAllTabPlacementSaved={(placement) => applySaved((data) => ({ ...data, allTabPlacement: placement }))}
              categories={state.data.categories}
              onSaved={saveTab}
              onDeleted={deleteTab}
              onClose={() => {
                setSettingsSection("tabs");
                navigate({ name: "settings" });
              }}
              onSessionExpired={sessionExpired}
            />
          ) : (
            <NotesPage
              notes={state.data.notes}
              categories={state.data.categories}
              selectedTab={selectedTab}
              tabs={tabs}
              leftTabs={[
                ...(allOnLeft ? [{ id: undefined, name: ALL_TAB_NAME, count: tabCounts?.get("all") }] : []),
                ...tabs.filter((tab) => tab.placement === "left").map((tab) => ({
                  id: tab.id,
                  name: tab.name,
                  count: tabCounts?.get(tab.id),
                  sharedOut: tabSharedOut(tab, state.data.categories),
                })),
              ]}
              onSelectTab={selectTab}
              tabsBlocked={tabsBlocked}
              openNote={page.name === "notes" ? page.note : undefined}
              onOpenNoteChange={(note, options) => navigate({ name: "notes", tab: selectedTab?.id, note }, options)}
              historySkip={historySkip}
              onEditLockChange={setEditLocked}
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
              noteOrder={state.data.noteOrder ?? []}
              onNoteOrderChanged={(noteOrder) => applySaved((data) => ({ ...data, noteOrder }))}
              onBulkChange={setBulkActive}
              onUnsavedChange={setNotesUnsaved}
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
