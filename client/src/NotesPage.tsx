import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircle } from "@fortawesome/free-regular-svg-icons";
import {
  faArrowDownWideShort,
  faBoxArchive,
  faChartDiagram,
  faCheck,
  faChevronDown,
  faChevronUp,
  faClock,
  faCircleCheck,
  faCirclePlus,
  faClipboardCheck,
  faDeleteLeft,
  faGripVertical,
  faHourglass,
  faListCheck,
  faMaximize,
  faPen,
  faReplyAll,
  faRotateLeft,
  faTrashCan,
  faX,
  type IconDefinition,
} from "@fortawesome/free-solid-svg-icons";
import {
  isLongForm,
  lifetimeOf,
  LIFETIME_ACTIVE,
  LIFETIME_ARCHIVED,
  LIFETIME_BIN,
  LIFETIME_NEW,
  LIFETIME_WAITING,
  noteMatchesFilters,
  orderNotes,
  validateTitle,
  validateTitleImage,
  type Category,
  type LifetimeChange,
  type Note,
  type NoteTitle,
  type Tab,
} from "@nwsnotes/shared";
import { ApiError, api } from "./api";
import { offlineApi } from "./offline";
import { ConfirmDialog } from "./ConfirmDialog";
import { useExtraFilters } from "./extraFilters";
import { LongFormEditor } from "./LongFormEditor";
import { useNoteDrag } from "./noteDrag";
import { useFullTagList } from "./stylusMode";

const LONG_FORM_TITLE_FIRST = "Set the long-form note's title first";
import { INK_SCALE, StylusPad, type StylusPadHandle } from "./StylusPad";
import {
  BulkTagPicker,
  constraintsFor,
  missingRequiredCategory,
  selectedTagIds,
  selectionToFilters,
  TagPickers,
  TagPillPicker,
  type BulkTagChanges,
  type TagSelection,
} from "./TagPickers";
import { TagPills } from "./TagPills";

interface Props {
  notes: Note[];
  /** All categories, including the built-in Lifetime one. */
  categories: Category[];
  /** The selected tab, or undefined for "All". Only matching notes are listed. */
  selectedTab: Tab | undefined;
  /** In stylus mode, new notes are written on a canvas instead of typed. */
  stylusMode: boolean;
  /** How many balanced columns the note list is split into (the Columns setting). */
  columns: number;
  /** The dropdowns' selections for new notes, kept by the app so they survive visits to settings and edits. */
  tagSelection: TagSelection;
  onTagSelectionChange: (selection: TagSelection) => void;
  /** The note being edited, if any. The app keeps this so it can block changing tab meanwhile. */
  editingNote: Note | undefined;
  onEditStart: (note: Note) => void;
  onEditEnd: () => void;
  onNoteAdded: (note: Note) => void;
  /** A note was edited, archived, reinstated or binned. */
  onNoteUpdated: (note: Note) => void;
  /** Several notes changed at once (resetting the New tags); reload them. */
  onNotesChanged: () => void;
  /** A tab's note order changed (shown straight away, before it's saved). */
  onTabUpdated: (tab: Tab) => void;
  /** Multi-select mode started or ended; the app blocks the tabs and Settings while it's on, as during an edit. */
  onBulkChange: (active: boolean) => void;
  /** Whether there's unsaved work on the page (an edit, a long-form note, a title being written), which hides "Reload". */
  onUnsavedChange: (unsaved: boolean) => void;
  /** The server can't be reached: bulk tag updates, note ordering and resetting New aren't available. */
  offline: boolean;
  /** Notes with changes still waiting to be sent; they show a clock by their date. */
  pendingIds: ReadonlySet<number>;
  /** A message from syncing offline changes, shown like the page's own notices. */
  syncNotice?: { text: string; error?: boolean; key: number };
  onSessionExpired: () => void;
}

const OFFLINE_HINT = "Not available offline";

/** A note's tags as dropdown selections: category id -> tag ids. */
function selectionFor(note: Note, categories: Category[]): TagSelection {
  return Object.fromEntries(
    categories.map((category) => [
      category.id,
      category.tags.filter((tag) => note.tagIds.includes(tag.id)).map((tag) => tag.id),
    ]),
  );
}

const NOTICE_MS = 4000;

export function NotesPage({
  notes,
  categories,
  selectedTab,
  stylusMode,
  columns,
  tagSelection,
  onTagSelectionChange,
  editingNote,
  onEditStart,
  onEditEnd,
  onNoteAdded,
  onNoteUpdated,
  onNotesChanged,
  onTabUpdated,
  onBulkChange,
  onUnsavedChange,
  offline,
  pendingIds,
  syncNotice,
  onSessionExpired,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const padRef = useRef<StylusPadHandle>(null);
  const [title, setTitle] = useState("");
  /** The tags chosen while editing a note (the new-note choices are kept separately and come back afterwards). */
  const [editSelection, setEditSelection] = useState<TagSelection>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  /** A short message over the bottom of the list, e.g. when a new note is hidden by the filters. */
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  /** The note whose archive / reinstate / bin button is being handled. */
  const [busyNoteId, setBusyNoteId] = useState<number>();
  /** The open long-form editor: the note being edited, or none when creating one. */
  const [longForm, setLongForm] = useState<{ note: Note | undefined; key: number; converted?: boolean }>();
  /** The open long-form note's id, once its title has been accepted; new notes become its children. */
  const [longFormId, setLongFormId] = useState<number>();
  /** Before a new long-form note's title is first accepted, regular notes can't be added. */
  const addBlocked = longForm !== undefined && longFormId === undefined;

  /** Edit-order mode: notes get grips for dragging. Not remembered; never on "All". */
  const [ordering, setOrdering] = useState(false);

  /**
   * Multi-select (list-check) mode, for bulk tag editing: the selected notes and the pills clicked so
   * far. Undefined when it's off. It never overlaps editing, a long-form note or edit-order mode.
   */
  const [bulk, setBulk] = useState<{ noteIds: number[]; changes: BulkTagChanges }>();
  const bulkActive = bulk !== undefined;
  /** Whether the new-note canvas has writing on it, so list-check can't start over an unsaved note. */
  const [padInked, setPadInked] = useState(false);

  const onBulkChangeRef = useRef(onBulkChange);
  onBulkChangeRef.current = onBulkChange;
  useEffect(() => onBulkChangeRef.current(bulkActive), [bulkActive]);
  // Leaving the page ends it, so the tabs aren't left blocked.
  useEffect(() => () => onBulkChangeRef.current(false), []);

  const unsaved = editingNote !== undefined || longForm !== undefined || bulkActive || title.trim() !== "" || padInked;
  const onUnsavedChangeRef = useRef(onUnsavedChange);
  onUnsavedChangeRef.current = onUnsavedChange;
  useEffect(() => onUnsavedChangeRef.current(unsaved), [unsaved]);
  useEffect(() => () => onUnsavedChangeRef.current(false), []);

  /** Opens the long-form editor; `converted` when the note has just become long-form (its details get the focus). */
  function openLongForm(note: Note | undefined, converted = false) {
    setOrdering(false);
    setLongForm({ note, key: Date.now(), converted });
    setLongFormId(note?.id);
  }

  /** The extra pills after a note's tags: "Long Form" on long-form notes, the parent's title on children. */
  function specialPills(note: Note): string[] {
    if (isLongForm(note)) return ["Long Form"];
    const parent = note.parentId === undefined ? undefined : notes.find((n) => n.id === note.parentId);
    // A child whose parent has been deleted shows no parent pill.
    const title = parent?.titleText;
    return title ? [title.length > 20 ? `${title.slice(0, 19)}…` : title] : [];
  }
  /** The kind of pointer that last touched the new-note controls, for browsers whose clicks don't say. */
  const lastPointerType = useRef("");
  const [extraSelection, setExtraSelection] = useExtraFilters(selectedTab?.id);
  const [fullTagList, setFullTagList] = useFullTagList();
  /** The tag choosers in the add/edit area: dropdowns, or pills in full-tag-list mode. */
  const TagChooser = fullTagList ? TagPillPicker : TagPickers;

  /**
   * The canvas is shown in stylus mode, and when editing a handwritten note whatever the mode. Neither
   * it nor the title box shows in multi-select mode.
   */
  const showCanvas = !bulkActive && (editingNote ? editingNote.titleImage !== undefined : stylusMode);
  /** Categories with a dropdown in the new-note area: not the built-in Lifetime one. */
  const userCategories = useMemo(() => categories.filter((category) => !category.system), [categories]);

  /**
   * While the canvas is showing, finger and palm taps on the new-note controls (Add/Update, Cancel,
   * Clear, the tag dropdowns and their lists) do nothing, so a hand resting on the screen while writing
   * can't press anything. Only taps are stopped: fingers can still scroll the area. Keyboard use isn't affected.
   */
  function ignoreTouchWhileWriting(event: ReactMouseEvent) {
    if (!showCanvas) return;
    const click = event.nativeEvent as Partial<PointerEvent>;
    const pointerType = "pointerType" in click ? click.pointerType : lastPointerType.current;
    if (pointerType === "touch") {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  // The tab's own filters, plus the additional filters chosen in the row above the list (for the
  // categories the tab doesn't filter on).
  const tabFilters = useMemo(() => selectedTab?.categories ?? [], [selectedTab]);
  /**
   * Single-select categories the tab itself filters on with just one tag: their pills are left off the
   * notes, since they only repeat what the tab already shows. When the filter allows several tags, the
   * pill says which one a note has, so it shows. (Multi-select ones, and the additional filters, always show.)
   */
  const filteredSingleSelect = useMemo(
    () =>
      tabFilters
        .filter((filter) => filter.tagIds.length === 1)
        .map((filter) => filter.categoryId)
        .filter((id) => categories.some((category) => category.id === id && !category.multiSelect)),
    [tabFilters, categories],
  );
  const extraCategories = useMemo(
    () => categories.filter((category) => !tabFilters.some((filter) => filter.categoryId === category.id)),
    [categories, tabFilters],
  );
  const allFilters = useMemo(
    () => [...tabFilters, ...selectionToFilters(extraCategories, extraSelection)],
    [tabFilters, extraCategories, extraSelection],
  );

  // Hidden notes aren't changed, just not listed. Bin notes are hidden unless a filter ticks Bin.
  // A tab lists its ordered notes first, then the rest in creation order; "All" is in creation order.
  const visibleNotes = useMemo(() => {
    const matching = notes.filter((note) => noteMatchesFilters(note, allFilters));
    return selectedTab ? orderNotes(matching, selectedTab.noteOrder) : matching;
  }, [notes, allFilters, selectedTab]);

  const onAll = selectedTab === undefined;
  useEffect(() => {
    if (onAll) setOrdering(false);
  }, [onAll]);

  /** The list as it was when a drag started: live updates don't change what's shown until the drop. */
  const dragList = useRef<Note[]>(undefined);
  const { drag, gripHandlers } = useNoteDrag(listRef, (noteId, target) => void dropNote(noteId, target));
  const listedNotes = drag && dragList.current ? dragList.current : visibleNotes;

  /**
   * Saves the tab's order with the note moved to `target` among the other listed notes: straight after
   * the listed note above it (or before the first one). Notes hidden by the filters keep their places,
   * and every note in the tab (Bin included) is in the saved order. Shown at once; reverted if it fails.
   */
  async function dropNote(noteId: number, target: number) {
    const tab = selectedTab;
    if (!tab) return;
    const others = (dragList.current ?? visibleNotes).filter((note) => note.id !== noteId);
    const order = orderNotes(
      notes.filter((note) => noteMatchesFilters(note, tab.categories, true)),
      tab.noteOrder,
    )
      .map((note) => note.id)
      .filter((id) => id !== noteId);
    const above = others[target - 1];
    const below = others[0];
    const anchor = above ? order.indexOf(above.id) + 1 : below ? order.indexOf(below.id) : 0;
    const at = anchor < 0 ? order.length : anchor;
    const noteOrder = [...order.slice(0, at), noteId, ...order.slice(at)];
    onTabUpdated({ ...tab, noteOrder });
    try {
      await api.setTabOrder(tab.id, { noteOrder });
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        onSessionExpired();
        return;
      }
      setNotice({ text: `The new order wasn't saved: ${error instanceof Error ? error.message : String(error)}`, error: true });
      onNotesChanged();
    }
  }
  /** What the filters require of new notes, so they always match and stay visible. */
  const constraints = useMemo(() => constraintsFor(allFilters), [allFilters]);
  /** The tags the filters fix to one value (category id -> tag id), for the long-form editor's "match the tab". */
  const tabTags = useMemo(
    () =>
      new Map(
        [...constraints].flatMap(([categoryId, tagIds]) => (tagIds.length === 1 && tagIds[0] !== undefined ? [[categoryId, tagIds[0]] as const] : [])),
      ),
    [constraints],
  );

  // Newest notes are at the bottom, so keep the list scrolled to the bottom
  // when the page opens, whenever a note is added, and when the tab changes.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [visibleNotes.length, selectedTab?.id]);

  // Notices disappear by themselves.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(undefined), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function startEdit(note: Note) {
    setOrdering(false);
    // Any new note that was being typed or written is discarded.
    setTitle(note.titleText ?? "");
    setEditSelection(selectionFor(note, userCategories));
    setSaveError(undefined);
    onEditStart(note);
    if (note.titleText !== undefined) {
      requestAnimationFrame(() => {
        const input = inputRef.current;
        input?.focus();
        input?.setSelectionRange(input.value.length, input.value.length);
      });
    }
  }

  /** Back to adding notes, with an empty title box or canvas. */
  function finishEdit() {
    setTitle("");
    setEditSelection({});
    setSaveError(undefined);
    onEditEnd();
  }

  // Escape cancels an edit (unless it's closing an open tag list).
  useEffect(() => {
    if (!editingNote) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving && !document.querySelector(".tag-dropdown-list")) finishEdit();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  // Leaving the page (e.g. with the back button) cancels an edit, so the tabs aren't left blocked.
  const onEditEndRef = useRef(onEditEnd);
  onEditEndRef.current = onEditEnd;
  useEffect(() => () => onEditEndRef.current(), []);

  /** Tapping a "New" pill asks whether to change every New note to Active. */
  const [confirmResetNew, setConfirmResetNew] = useState(false);
  const [resettingNew, setResettingNew] = useState(false);

  async function resetNew() {
    setConfirmResetNew(false);
    setResettingNew(true);
    try {
      const { count } = await api.bulkLifetime("reset-new");
      if (count > 0) onNotesChanged();
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        onSessionExpired();
        return;
      }
      setNotice({ text: `Nothing was changed: ${error instanceof Error ? error.message : String(error)}`, error: true });
    } finally {
      setResettingNew(false);
    }
  }

  /** Archive, reinstate or bin a note. If it no longer matches the filters, it leaves the list. */
  async function changeLifetime(note: Note, lifetime: LifetimeChange) {
    if (busyNoteId !== undefined) return;
    setBusyNoteId(note.id);
    try {
      onNoteUpdated(await offlineApi.setLifetime(note.id, lifetime));
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        onSessionExpired();
        return;
      }
      setNotice({ text: `The note wasn't changed: ${error instanceof Error ? error.message : String(error)}`, error: true });
    } finally {
      setBusyNoteId(undefined);
    }
  }

  /** The title to save, or undefined (with the error shown) if there isn't a valid one. */
  function newTitle(): NoteTitle | undefined {
    if (showCanvas) {
      const pad = padRef.current;
      if (!pad?.hasInk()) {
        setSaveError("Nothing has been written yet.");
        return undefined;
      }
      const check = validateTitleImage(pad.toImage());
      if (!check.ok) setSaveError(check.error);
      return check.ok ? { titleImage: check.value } : undefined;
    }
    const check = validateTitle(title);
    if (!check.ok) {
      setSaveError(check.error);
      inputRef.current?.focus();
    }
    return check.ok ? { titleText: check.title } : undefined;
  }

  /** Why the note being edited can't become a long-form note, if it can't (as one couldn't be created that way). */
  const convertHint =
    editingNote?.titleImage !== undefined
      ? "Only typed notes can become long-form notes"
      : editingNote?.parentId !== undefined
        ? "This note belongs to a long-form note, so it can't become one"
        : undefined;

  /**
   * Turns the note being edited into a long-form note: saved with its title and tags as they are now,
   * and empty details (handwritten in stylus mode, typed otherwise), then opened in the long-form
   * editor with its title accepted, ready for the details.
   */
  async function convertToLongForm() {
    if (!editingNote || saving || convertHint) return;
    const check = validateTitle(title);
    if (!check.ok) {
      setSaveError(check.error);
      return;
    }
    setSaving(true);
    setSaveError(undefined);
    try {
      const tagIds = selectedTagIds(userCategories, editSelection);
      const details = stylusMode ? { detailsImage: "" } : { detailsText: "" };
      const note = await offlineApi.updateNote(editingNote.id, { titleText: check.title, tagIds, ...details });
      onNoteUpdated(note);
      finishEdit();
      openLongForm(note, true);
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        onSessionExpired();
        return;
      }
      setSaveError(`The note wasn't converted: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSaving(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;

    const noteTitle = newTitle();
    if (!noteTitle) return;
    // The filters' rules only apply to new notes; an edited note can be given any tags.
    if (!editingNote) {
      const missing = missingRequiredCategory(userCategories, tagSelection, constraints);
      if (missing) {
        setSaveError(`Choose a ${missing.name} tag: this tab only shows notes with one.`);
        return;
      }
    }

    setSaving(true);
    setSaveError(undefined);
    try {
      if (editingNote) {
        const tagIds = selectedTagIds(userCategories, editSelection);
        onNoteUpdated(await offlineApi.updateNote(editingNote.id, { ...noteTitle, tagIds }));
        finishEdit();
      } else {
        // The dropdowns keep their selections, so the next note gets the same tags unless they're changed.
        const tagIds = selectedTagIds(userCategories, tagSelection, constraints);
        // While a long-form note is open, new notes are its children.
        const note = await offlineApi.addNote({ ...noteTitle, tagIds, ...(longFormId !== undefined && { parentId: longFormId }) });
        onNoteAdded(note);
        if (showCanvas) {
          padRef.current?.clear();
          setPadInked(false);
        } else setTitle("");
        // New notes are always New; say so if this tab's filters don't show New notes.
        if (!noteMatchesFilters(note, allFilters)) {
          setNotice({ text: "Note added, but this tab doesn't show New notes." });
        }
      }
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        onSessionExpired();
        return;
      }
      // The typed title or the writing is kept, so it can be saved again.
      setSaveError(`The note wasn't saved: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSaving(false);
      // Focus after the input is re-enabled.
      if (!showCanvas) requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  const blocked = editingNote !== undefined;

  /** Why list-check can't be turned on now, if it can't. */
  const titleEmpty = showCanvas ? !padInked : title.trim() === "";
  const listCheckHint = offline
    ? OFFLINE_HINT
    : blocked || longForm
      ? "Finish or cancel the edit first"
      : ordering
        ? "Finish ordering first"
        : !titleEmpty
          ? "Add or clear the new note first"
          : undefined;

  // Note ordering needs the server: edit-order mode ends if the connection drops.
  useEffect(() => {
    if (offline) setOrdering(false);
  }, [offline]);

  // Messages from syncing offline changes show like the page's own.
  useEffect(() => {
    if (syncNotice) setNotice({ text: syncNotice.text, error: syncNotice.error });
  }, [syncNotice]);

  /** The list-check button: on starts with nothing selected; off discards any selections and pill clicks. */
  function toggleBulk() {
    if (bulk) {
      setBulk(undefined);
      setSaveError(undefined);
    } else if (!listCheckHint) {
      setBulk({ noteIds: [], changes: new Map() });
      setSaveError(undefined);
      setPadInked(false);
    }
  }

  /** Selects or unselects a note, until a pill has been clicked. */
  function toggleBulkNote(noteId: number) {
    if (!bulk || bulk.changes.size > 0) return;
    const noteIds = bulk.noteIds.includes(noteId) ? bulk.noteIds.filter((id) => id !== noteId) : [...bulk.noteIds, noteId];
    setBulk({ ...bulk, noteIds });
  }

  /** The filter row's "All" and "None": selects exactly these notes, until a pill has been clicked. */
  function selectBulkNotes(noteIds: number[]) {
    if (!bulk || bulk.changes.size > 0) return;
    setBulk({ ...bulk, noteIds });
  }

  /** Accept: clicked pills that ended chosen are added to every selected note, the others removed. */
  async function acceptBulk() {
    if (!bulk || saving) return;
    const changes = [...bulk.changes];
    setSaving(true);
    setSaveError(undefined);
    try {
      const updated = await api.bulkTags({
        noteIds: bulk.noteIds,
        addTagIds: changes.filter(([, chosen]) => chosen).map(([id]) => id),
        removeTagIds: changes.filter(([, chosen]) => !chosen).map(([id]) => id),
      });
      for (const note of updated) onNoteUpdated(note);
      setBulk(undefined);
      setNotice({ text: `Tags updated on ${updated.length} ${updated.length === 1 ? "note" : "notes"}.` });
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        onSessionExpired();
        return;
      }
      // The selections and clicks are kept, to try again.
      setSaveError(`The tags weren't updated: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSaving(false);
    }
  }

  // Escape turns list-check off, like its button.
  useEffect(() => {
    if (!bulk) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) {
        setBulk(undefined);
        setSaveError(undefined);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  /** Messages, then the dropdowns (or every tag as a pill in full-tag-list mode). Both share the same choices. */
  const belowTitle = (
    <>
      {addBlocked && <p className="lf-add-hint">{LONG_FORM_TITLE_FIRST}</p>}
      {saveError && (
        <p className="save-error" role="alert">
          {saveError}
        </p>
      )}
      {bulk ? (
        <BulkTagPicker
          categories={userCategories}
          notes={notes.filter((note) => bulk.noteIds.includes(note.id))}
          changes={bulk.changes}
          onChange={(changes) => setBulk({ ...bulk, changes })}
          disabled={saving}
        />
      ) : editingNote ? (
        <TagChooser categories={userCategories} selection={editSelection} onChange={setEditSelection} disabled={saving} />
      ) : (
        <TagChooser
          categories={userCategories}
          selection={tagSelection}
          onChange={onTagSelectionChange}
          disabled={saving}
          constraints={constraints}
          tabName={selectedTab?.name}
        />
      )}
    </>
  );

  /**
   * The list's items: the notes, and while dragging a gap where the dragged note would go. The dragged
   * note itself stays among its original neighbours (so it isn't re-created mid-drag), drawn following
   * the pointer and taking no room.
   */
  const rows: ({ note: Note } | { gap: number })[] = listedNotes.map((note) => ({ note }));
  if (drag) {
    const start = listedNotes.findIndex((note) => note.id === drag.noteId);
    const dragged = rows[start];
    if (dragged) {
      rows.splice(start, 1);
      rows.splice(drag.target, 0, { gap: drag.height });
      rows.splice(drag.target <= start ? start + 1 : start, 0, dragged);
    }
  }
  const editBlocked = blocked || longForm !== undefined || bulkActive;
  /** The tabs-like controls (filter row, expand/collapse) are held still during an edit or multi-select. */
  const rowBlocked = blocked || bulkActive;
  const rowHint = bulkActive ? "Finish selecting notes first" : "Finish or cancel the edit first";

  return (
    <div className={fullTagList ? "notes-page full-tag-list" : "notes-page"}>
      {/* A tab that filters on every category has no dropdowns, but still needs the edit-order button. */}
      {(extraCategories.length > 0 || selectedTab || bulk) && (
        <div className="filter-row" aria-label="More filters for this tab">
          {bulk ? (
            // Multi-select: the filters stay as they are (hidden), and these select every listed note, or none.
            <div className="bulk-select-all" role="group" aria-label="Select notes">
              <button
                type="button"
                className="small-button"
                title={bulk.changes.size > 0 ? "Selection is fixed once a tag has been clicked" : "Select every note in the list"}
                disabled={bulk.changes.size > 0}
                onClick={() => selectBulkNotes(visibleNotes.map((note) => note.id))}
              >
                All
              </button>
              <button
                type="button"
                className="small-button"
                title={bulk.changes.size > 0 ? "Selection is fixed once a tag has been clicked" : "Unselect every note"}
                disabled={bulk.changes.size > 0}
                onClick={() => selectBulkNotes([])}
              >
                None
              </button>
            </div>
          ) : (
            <>
              {extraCategories.length > 0 && (
                <TagPickers
                  categories={extraCategories}
                  selection={extraSelection}
                  onChange={setExtraSelection}
                  disabled={rowBlocked}
                  checkLists
                />
              )}
              <IconButton
                icon={faReplyAll}
                label={rowBlocked ? rowHint : "Reset filters"}
                disabled={rowBlocked}
                onClick={() => setExtraSelection({})}
              />
            </>
          )}
          {selectedTab && (
            <div className="filter-row-end">
              <IconButton
                icon={ordering ? faClipboardCheck : faArrowDownWideShort}
                label={ordering ? "Finish ordering" : offline ? OFFLINE_HINT : editBlocked ? rowHint : "Edit order"}
                disabled={!ordering && (editBlocked || offline)}
                onClick={() => setOrdering(!ordering)}
              />
            </div>
          )}
        </div>
      )}

      <div className="note-list" ref={listRef}>
        {visibleNotes.length === 0 ? (
          <p className="empty">
            {allFilters.length > 0 ? "No notes in this tab yet." : "No notes yet. Add your first one below."}
          </p>
        ) : (
          // Notes run top to bottom down each column, then on to the next column to the right.
          <ul style={{ columnCount: columns }}>
            {rows.map((row) => {
              if ("gap" in row) return <li key="drag-gap" className="drag-gap" style={{ height: row.gap }} aria-hidden />;
              const note = row.note;
              const dragging = note.id === drag?.noteId;
              const selected = bulk?.noteIds.includes(note.id) ?? false;
              const lifetime = lifetimeOf(note);
              const classes = [
                dragging && "dragging",
                note.id === editingNote?.id && "editing",
                lifetime === LIFETIME_WAITING && "waiting",
                lifetime === LIFETIME_ARCHIVED && "archived",
                lifetime === LIFETIME_BIN && "binned",
                selected && "selected",
                bulk && (bulk.changes.size > 0 ? "selection-locked" : "selectable"),
              ].filter(Boolean);
              const busy = blocked || busyNoteId !== undefined || bulkActive;
              const hint = bulkActive
                ? "Not while selecting notes"
                : blocked
                  ? "Finish or cancel the current edit first"
                  : undefined;
              return (
                <li
                  key={note.id}
                  data-note-id={note.id}
                  className={classes.join(" ") || undefined}
                  style={dragging ? { top: drag.top, left: drag.left, width: drag.width, height: drag.height } : undefined}
                  // Multi-select: tapping anywhere on the row toggles it (the greyed buttons do nothing).
                  onClick={bulk ? () => toggleBulkNote(note.id) : undefined}
                  aria-selected={bulk ? selected : undefined}
                >
                  {bulk && (
                    <span className="note-select" aria-hidden>
                      <FontAwesomeIcon icon={selected ? faCircleCheck : faCircle} />
                    </span>
                  )}
                  {ordering && (
                    <span
                      className="note-grip"
                      title="Drag to reorder"
                      {...gripHandlers(note.id)}
                      onPointerDown={(event) => {
                        // What's shown stays as it is until the drop, whatever live updates arrive.
                        if (!drag) dragList.current = visibleNotes;
                        gripHandlers(note.id).onPointerDown(event);
                      }}
                    >
                      <FontAwesomeIcon icon={faGripVertical} />
                    </span>
                  )}
                  <div className="note-body">
                    {note.titleImage !== undefined ? <HandwrittenTitle image={note.titleImage} /> : note.titleText}
                    <TagPills
                      tagIds={note.tagIds}
                      categories={categories}
                      extra={specialPills(note)}
                      hideCategoryIds={filteredSingleSelect}
                      // In multi-select the New pill is plain, so tapping it selects the note like the rest of the row.
                      // Offline it's plain too: resetting the New tags needs the server.
                      onNewClick={bulk || offline ? undefined : () => setConfirmResetNew(true)}
                      newClickDisabled={resettingNew}
                    />
                  </div>
                  {/* Right-aligned; they don't need to line up between notes. The creation date sits below. */}
                  <div className="note-side">
                  <div className="note-actions">
                    <IconButton
                      icon={faPen}
                      label={note.id === editingNote?.id ? "Editing this note" : (hint ?? "Edit note")}
                      disabled={busy || saving}
                      onClick={() => (isLongForm(note) ? openLongForm(note) : startEdit(note))}
                    />
                    {/* New and Active notes can be put on hold; anything else can be reinstated to Active. */}
                    {lifetime === LIFETIME_NEW || lifetime === LIFETIME_ACTIVE ? (
                      <IconButton
                        icon={faHourglass}
                        label={hint ?? "Waiting"}
                        disabled={busy}
                        onClick={() => void changeLifetime(note, "Waiting")}
                      />
                    ) : (
                      <IconButton
                        icon={faRotateLeft}
                        label={hint ?? "Reinstate"}
                        disabled={busy}
                        onClick={() => void changeLifetime(note, "Active")}
                      />
                    )}
                    {/* Anything not yet Archived or in the Bin can be archived; Archived notes can be binned. */}
                    {lifetime === LIFETIME_ARCHIVED ? (
                      <IconButton
                        icon={faTrashCan}
                        label={hint ?? "Move to bin"}
                        disabled={busy}
                        onClick={() => void changeLifetime(note, "Bin")}
                      />
                    ) : (
                      lifetime !== LIFETIME_BIN && (
                        <IconButton
                          icon={faBoxArchive}
                          label={hint ?? "Archive"}
                          disabled={busy}
                          onClick={() => void changeLifetime(note, "Archived")}
                        />
                      )
                    )}
                  </div>
                  <time className="note-date" dateTime={note.createdDateTime} title={`Created ${new Date(note.createdDateTime).toLocaleString()}`}>
                    {pendingIds.has(note.id) && (
                      <FontAwesomeIcon icon={faClock} className="note-pending" title="Waiting to be saved (offline)" />
                    )}
                    {formatCreated(note.createdDateTime)}
                  </time>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {confirmResetNew && (
        <ConfirmDialog
          message="Do you want to reset the New tags?"
          confirmLabel="Yes"
          cancelLabel="No"
          danger={false}
          onConfirm={() => void resetNew()}
          onCancel={() => setConfirmResetNew(false)}
        />
      )}

      {notice && (
        <div className={notice.error ? "toast error" : "toast"} role="status">
          {notice.text}
        </div>
      )}

      {longForm && (
        <LongFormEditor
          // A fresh editor for each note opened.
          key={longForm.key}
          note={longForm.note}
          startInDetails={longForm.converted}
          tabTags={tabTags}
          tabName={selectedTab?.name}
          categories={userCategories}
          stylusMode={stylusMode}
          bottom={fullTagList ? 250 : 150}
          onSaved={(note, created) => {
            if (created) {
              onNoteAdded(note);
            } else {
              onNoteUpdated(note);
            }
            setLongFormId(note.id);
          }}
          onFinish={(deleted) => {
            setLongForm(undefined);
            setLongFormId(undefined);
            if (deleted) onNotesChanged();
          }}
          offline={offline}
          onSessionExpired={onSessionExpired}
        />
      )}

      {/* The full-tag-list toggle sits over the divider between the list and the add/edit area. */}
      <div className="area-divider">
        <button
          type="button"
          className="area-toggle"
          aria-pressed={fullTagList}
          aria-label={fullTagList ? "Show tag dropdowns" : "Show all tags"}
          title={fullTagList ? "Show tag dropdowns" : "Show all tags"}
          // Not while a long-form note is open, so the editor's space doesn't change under it,
          // nor in multi-select, which needs the pills.
          disabled={longForm !== undefined || bulkActive}
          onClick={() => setFullTagList(!fullTagList)}
        >
          <FontAwesomeIcon icon={fullTagList ? faChevronDown : faChevronUp} />
        </button>
      </div>

      <div className={["new-note", editingNote && "editing", fullTagList && "full"].filter(Boolean).join(" ")}>
        <form
          onSubmit={submit}
          onPointerDownCapture={(event) => {
            lastPointerType.current = event.pointerType;
          }}
          onClickCapture={ignoreTouchWhileWriting}
        >
          {/* No "New note" heading; the text box is labelled for screen readers instead. */}
          <div className="new-note-row">
            {/* The dropdowns or pills sit under the title, using the space beside the buttons. */}
            <div className="new-note-main">
            {bulk ? null : showCanvas ? (
              <StylusPad
                // A fresh pad for each note edited (loaded with its image), and an empty one for new notes.
                key={editingNote ? `edit-${editingNote.id}` : "new"}
                ref={padRef}
                disabled={saving || addBlocked}
                initialImage={editingNote?.titleImage}
                onInk={() => {
                  setSaveError(undefined);
                  setPadInked(true);
                }}
              />
            ) : (
              <input
                id="new-note-title"
                ref={inputRef}
                type="text"
                aria-label={editingNote ? "Note title" : "New note"}
                value={title}
                placeholder="Type a note title and press Enter"
                autoComplete="off"
                autoFocus
                // Read-only (not disabled) while saving: disabling it would take the focus away, and it
                // should keep the focus so the next note can be typed straight away.
                readOnly={saving}
                disabled={addBlocked}
                onChange={(event) => setTitle(event.target.value)}
              />
            )}
            {belowTitle}
            </div>
            {/* Icon-only buttons; Clear sits under Add, leaving more width for handwriting. */}
            <div className="new-note-buttons">
              {/* Multi-select: Accept appears (above list-check) once a pill has been clicked. */}
              {bulk && bulk.changes.size > 0 && (
                <button
                  type="button"
                  className="icon-button primary"
                  aria-label="Accept bulk tag updates"
                  title={offline ? OFFLINE_HINT : "Accept bulk tag updates"}
                  // Bulk updates need the server; the selections wait for the connection.
                  disabled={saving || offline}
                  onClick={() => void acceptBulk()}
                >
                  <FontAwesomeIcon icon={faCheck} />
                </button>
              )}
              {!bulk && (
                <button
                  type="submit"
                  className="icon-button primary"
                  aria-label={editingNote ? "Update" : "Add"}
                  title={editingNote ? "Update" : addBlocked ? LONG_FORM_TITLE_FIRST : "Add"}
                  disabled={saving || addBlocked}
                >
                  <FontAwesomeIcon icon={editingNote ? faCircleCheck : faCirclePlus} />
                </button>
              )}
              {editingNote && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Cancel"
                  title="Cancel"
                  disabled={saving}
                  onClick={finishEdit}
                >
                  <FontAwesomeIcon icon={faX} />
                </button>
              )}
              {showCanvas && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Clear"
                  title="Clear"
                  disabled={saving}
                  onClick={() => {
                    padRef.current?.clear();
                    setPadInked(false);
                    setSaveError(undefined);
                  }}
                >
                  <FontAwesomeIcon icon={faDeleteLeft} />
                </button>
              )}
              {/* In the expanded (250px) area: start a long-form note. */}
              {fullTagList && !editingNote && !longForm && !bulk && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Create long-form note"
                  title="Create long-form note"
                  disabled={saving}
                  onClick={() => openLongForm(undefined)}
                >
                  <FontAwesomeIcon icon={faChartDiagram} />
                </button>
              )}
              {/* In the expanded area while editing: turn the note into a long-form note. */}
              {fullTagList && editingNote && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Convert to long-form note"
                  title={convertHint ?? "Convert to long-form note"}
                  disabled={saving || convertHint !== undefined}
                  onClick={() => void convertToLongForm()}
                >
                  <FontAwesomeIcon icon={faMaximize} />
                </button>
              )}
              {/* In the expanded area: multi-select notes to change their tags together. Inverted while on. Not while editing. */}
              {fullTagList && !editingNote && (
                <button
                  type="button"
                  className={bulk ? "icon-button primary" : "icon-button"}
                  aria-label={bulk ? "Stop selecting notes" : "Select notes to change their tags"}
                  aria-pressed={bulkActive}
                  title={bulk ? "Stop selecting notes (no changes)" : (listCheckHint ?? "Select notes to change their tags")}
                  disabled={saving || (!bulk && listCheckHint !== undefined)}
                  onClick={toggleBulk}
                >
                  <FontAwesomeIcon icon={faListCheck} />
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

/** A small icon-only button (16px icon in a 24px tap area) for the note list and the filter row. */
function IconButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: IconDefinition;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="note-button" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      <FontAwesomeIcon icon={icon} />
    </button>
  );
}

/** A handwritten note's image, shown at the size it was written. */
function HandwrittenTitle({ image }: { image: string }) {
  const size = pngSize(image);
  return (
    <img
      className="note-image"
      src={image}
      alt="Handwritten note"
      // Sizing it before it loads keeps the list from jumping (and scrolled to the bottom).
      width={size ? size.width / INK_SCALE : undefined}
      height={size ? size.height / INK_SCALE : undefined}
    />
  );
}

/** Reads a PNG data URL's pixel size from its header (bytes 16-23), or undefined if it can't. */
function pngSize(dataUrl: string): { width: number; height: number } | undefined {
  try {
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1, dataUrl.indexOf(",") + 1 + 32);
    const bytes = atob(base64);
    const read = (at: number) =>
      ((bytes.charCodeAt(at) << 24) | (bytes.charCodeAt(at + 1) << 16) | (bytes.charCodeAt(at + 2) << 8) | bytes.charCodeAt(at + 3)) >>> 0;
    return { width: read(16), height: read(20) };
  } catch {
    return undefined;
  }
}

/** A note's creation time in the device's local time, as "dd/MM HH:mm" (e.g. "26/10 14:05"). */
function formatCreated(iso: string): string {
  const date = new Date(iso);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(date.getDate())}/${two(date.getMonth() + 1)} ${two(date.getHours())}:${two(date.getMinutes())}`;
}
