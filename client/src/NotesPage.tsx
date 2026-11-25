import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faAlarmClock, faCircle, faEye, faFileLines } from "@fortawesome/free-regular-svg-icons";
import {
  faAnglesDown,
  faAnglesUp,
  faArrowDownWideShort,
  faBoxArchive,
  faCheck,
  faChevronDown,
  faChevronUp,
  faClock,
  faCircleCheck,
  faCirclePlus,
  faCircleUp,
  faDeleteLeft,
  faGripVertical,
  faHourglass,
  faListCheck,
  faMagnifyingGlass,
  faMaximize,
  faPen,
  faReplyAll,
  faRotateLeft,
  faTrashCan,
  faX,
  type IconDefinition,
} from "@fortawesome/free-solid-svg-icons";
import { faFinishOrdering } from "./icons";
import {
  allows,
  isLifetimeTag,
  isLongForm,
  lifetimeOf,
  LIFETIME_ACTIVE,
  LIFETIME_ARCHIVED,
  LIFETIME_BIN,
  LIFETIME_NEW,
  LIFETIME_WAITING,
  noteMatchesFilters,
  orderNotes,
  tagLabel,
  validateTitle,
  validateTitleImage,
  withoutMarkers,
  type Category,
  type LifetimeChange,
  type Note,
  type NoteTitle,
  type Tab,
  NOTE_CHANGED_ELSEWHERE,
} from "@nwsnotes/shared";
import { ApiError, api } from "./api";
import { isWaiting, offlineApi } from "./offline";
import { noteBackground, noteHue } from "./colours";
import { ConfirmDialog } from "./ConfirmDialog";
import { DueDateDialog } from "./DueDateDialog";
import { FormattedText } from "./FormattedText";
import { useExtraFilters } from "./extraFilters";
import { PROPERTIES_CATEGORY, PROPERTIES_CATEGORY_ID, noteMatchesProperties, validProperties } from "./propertyFilters";
import { LongFormEditor } from "./LongFormEditor";
import { LeftTabStrip, type TabEntry } from "./Header";
import { useLongPress } from "./longPress";
import { useNoteDrag } from "./noteDrag";
import { columnCount, useFilterRowCollapsed, useFullTagList, useLeftTabsHidden, type ColumnsChoice } from "./stylusMode";

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
  hasNoTagIn,
  noneCategories,
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
  /** The tabs set to "Left" ("All" first if it is), shown in a strip left of the filter row and list. */
  leftTabs: TabEntry[];
  onSelectTab: (id: number | undefined) => void;
  /** While a note is being edited or notes are being selected, the tabs can't be changed. */
  tabsBlocked: boolean;
  /** In stylus mode, new notes are written on a canvas instead of typed. */
  stylusMode: boolean;
  /** The Columns setting: one column, or as many balanced ones as fit at its width. */
  columns: ColumnsChoice;
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
  /** The shared order of the notes, for every tab ("All" included). */
  noteOrder: number[];
  /** The note order changed (shown straight away, before it's saved). */
  onNoteOrderChanged: (noteOrder: number[]) => void;
  /** Multi-select mode started or ended; the app blocks the tabs and Settings while it's on, as during an edit. */
  onBulkChange: (active: boolean) => void;
  /** Whether there's unsaved work on the page (an edit, a long-form note, a title being written), which hides "Reload". */
  onUnsavedChange: (unsaved: boolean) => void;
  /** Whether the note being edited can't be saved by using another control (no title, or saving). */
  onEditLockChange: (locked: boolean) => void;
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
/** Holding Add this long adds the note at the top of the tab. */

export function NotesPage({
  notes,
  categories,
  selectedTab,
  leftTabs,
  onSelectTab,
  tabsBlocked,
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
  noteOrder,
  onNoteOrderChanged,
  onBulkChange,
  onUnsavedChange,
  onEditLockChange,
  offline,
  pendingIds,
  syncNotice,
  onSessionExpired,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  /** The note list's width, for how many columns fit (worked out again whenever it changes). */
  const [listWidth, setListWidth] = useState(0);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const observer = new ResizeObserver(() => {
      setListWidth(list.clientWidth);
      setListHeight(list.clientHeight);
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, []);
  /** The note list's visible height: with several columns, each is filled to this before the next one starts. */
  const [listHeight, setListHeight] = useState(0);
  const columnTotal = columnCount(columns, listWidth);
  const columnsRef = useRef<HTMLUListElement>(null);
  /**
   * With several columns, the first is filled down to the bottom of the list before notes go on into the next.
   * Once every column is full, they're balanced instead and the list scrolls up and down as before.
   */
  const fitColumns = useCallback(() => {
    const ul = columnsRef.current;
    const list = listRef.current;
    if (!ul || !list) return;
    if (columnTotal <= 1) {
      ul.style.height = "";
      ul.style.columnFill = "";
    } else {
      ul.style.columnFill = "auto";
      ul.style.height = `${list.clientHeight}px`;
      // More notes than the columns hold at that height spill out to the side: balance them instead.
      if (ul.scrollWidth > ul.clientWidth + 1) {
        ul.style.height = "";
        ul.style.columnFill = "balance";
      }
    }
    // The browser only draws the line between columns where there are notes on both sides, so when the columns
    // to the right are empty, the notes in the last column with any get a line down their own right-hand edge.
    // (The note being dragged floats above the list, so it isn't in a column.)
    const rows = [...ul.children].filter((li) => !li.classList.contains("dragging"));
    const lefts = rows.map((li) => Math.round(li.getBoundingClientRect().left));
    const lastLeft = Math.max(...lefts);
    const emptyColumns = columnTotal > 1 && new Set(lefts).size < columnTotal;
    for (const li of ul.children) li.toggleAttribute("data-last-column", false);
    rows.forEach((li, i) => li.toggleAttribute("data-last-column", emptyColumns && lefts[i] === lastLeft));
  }, [columnTotal]);
  useLayoutEffect(fitColumns);
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

  /** The new-note dropdowns as they were when the long-form editor opened (and on which tab), to put back when it closes. */
  const selectionBeforeLongForm = useRef<{ tabId: number | undefined; selection: TagSelection }>(undefined);

  /** Opens the long-form editor; `converted` when the note has just become long-form (its details get the focus). */
  function openLongForm(note: Note | undefined, converted = false) {
    setOrdering(false);
    setLongForm({ note, key: Date.now(), converted });
    setLongFormId(note?.id);
    // Child notes can have any tags: the dropdowns start on the tab's tags, then are no longer locked.
    selectionBeforeLongForm.current = { tabId: selectedTab?.id, selection: tagSelection };
    const chosen = selectedTagIds(userCategories, tagSelection, constraints);
    onTagSelectionChange(
      Object.fromEntries(userCategories.map((category) => [category.id, category.tags.filter((tag) => chosen.includes(tag.id)).map((tag) => tag.id)])),
    );
  }

  function closeLongForm() {
    setLongForm(undefined);
    setLongFormId(undefined);
    const before = selectionBeforeLongForm.current;
    selectionBeforeLongForm.current = undefined;
    onTagSelectionChange(before && before.tabId === selectedTab?.id ? before.selection : {});
  }

  /** The extra pills after a note's tags: "Long Form" on long-form notes, the parent's title on children. */
  function specialPills(note: Note): string[] {
    if (isLongForm(note)) return ["Long Form"];
    const parent = note.parentId === undefined ? undefined : notes.find((n) => n.id === note.parentId);
    // A child whose parent has been deleted shows no parent pill.
    const title = parent?.titleText === undefined ? undefined : withoutMarkers(parent.titleText);
    return title ? [title.length > 20 ? `${title.slice(0, 19)}…` : title] : [];
  }
  /** The kind of pointer that last touched the new-note controls, for browsers whose clicks don't say. */
  const lastPointerType = useRef("");
  const [extraSelection, setExtraSelection] = useExtraFilters(selectedTab?.id);
  /** The left strip is hidden by the eye button above it (in the header). */
  const [leftTabsHidden] = useLeftTabsHidden();
  const [fullTagListSetting, setFullTagList] = useFullTagList();
  /**
   * While a long-form note with handwritten details is open, the area is collapsed (more room for the
   * canvas) and can't be expanded; the remembered setting isn't changed, so it comes back afterwards.
   */
  const handwrittenLongForm = longForm !== undefined && (longForm.note ? longForm.note.detailsImage !== undefined : stylusMode);
  /** Whether the add/edit area is expanded (full-tag-list mode) just now. */
  const fullTagList = fullTagListSetting && !handwrittenLongForm;
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
   * Tags the tab itself filters on alone in their category: their pills are left off the notes, since
   * every note on the tab has them. When the filter allows several tags, the pill says which one a note
   * has, so it shows. Other tags of the category (in a multi-select one) still show, as do the additional
   * filters' tags.
   */
  const filteredAloneTagIds = useMemo(
    () => tabFilters.filter((filter) => filter.tagIds.length === 1).map((filter) => filter.tagIds[0]!),
    [tabFilters],
  );
  const extraCategories = useMemo(
    () => categories.filter((category) => !tabFilters.some((filter) => filter.categoryId === category.id)),
    [categories, tabFilters],
  );
  const allFilters = useMemo(
    () => [...tabFilters, ...selectionToFilters(extraCategories, extraSelection)],
    [tabFilters, extraCategories, extraSelection],
  );
  /** The filter row's dropdowns with "(None)" ticked: listed notes have none of their tags. */
  const noneFilters = useMemo(() => noneCategories(extraCategories, extraSelection), [extraCategories, extraSelection]);

  // Hidden notes aren't changed, just not listed. Bin notes are hidden unless a filter ticks Bin.
  // Every tab ("All" included) lists the notes in the shared order, then any unordered ones in creation order.
  /** Search: on while the box is shown; its text narrows the list further. Kept across tabs, not remembered. */
  const [searchOn, setSearchOn] = useState(false);
  const [searchText, setSearchText] = useState("");
  const searchWords = useMemo(() => searchText.toLowerCase().split(/\s+/).filter(Boolean), [searchText]);

  /** The time due dates are compared with, updated each minute so they turn bold, then red, by themselves
   * (and the Properties filter's due-date rules follow along). */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  /** The filter row's ticked "Properties" rules (kept with the row's tag choices, under a made-up category id). */
  const properties = useMemo(() => validProperties(extraSelection[PROPERTIES_CATEGORY_ID]), [extraSelection]);

  const visibleNotes = useMemo(() => {
    const matching = notes.filter(
      (note) =>
        noteMatchesFilters(note, allFilters) &&
        hasNoTagIn(note, noneFilters) &&
        noteMatchesProperties(note, properties, now) &&
        matchesSearch(note, searchWords),
    );
    return orderNotes(matching, noteOrder);
  }, [notes, allFilters, noneFilters, properties, now, searchWords, noteOrder]);

  /** The filter row's ticked tags, as filters (the reset button only shows while there are some). */
  const extraFilters = useMemo(() => selectionToFilters(extraCategories, extraSelection), [extraCategories, extraSelection]);

  /** Whether the row narrows the list at all: a tag, "(None)" or property ticked (the reset button shows, and the row is yellow). */
  const rowFiltering = extraFilters.length > 0 || noneFilters.length > 0 || properties.length > 0;

  /**
   * The filter row's note counts: for each tag, the notes listed if it were the only tag ticked in its
   * dropdown, with every other filter (the tab, the other dropdowns, Properties, the search) as it is.
   * "(None)" counts the notes listed if it were ticked instead. Properties' counts work the same way,
   * with its own ticks left out.
   */
  const filterCounts = useMemo(() => {
    const searched = notes.filter((note) => matchesSearch(note, searchWords));
    const withProperties = searched.filter((note) => noteMatchesProperties(note, properties, now));
    const byTag = new Map<number, number>();
    const byNone = new Map<number, number>();
    for (const category of extraCategories) {
      const others = [...tabFilters, ...extraFilters.filter((filter) => filter.categoryId !== category.id)];
      const otherNones = noneFilters.filter((none) => none.id !== category.id);
      const rest = withProperties.filter((note) => hasNoTagIn(note, otherNones));
      for (const tag of category.tags) {
        // The tag's filter goes with the others, not after them: ticking Bin is what lets Bin notes through.
        const filters = [...others, { categoryId: category.id, tagIds: [tag.id] }];
        byTag.set(tag.id, rest.filter((note) => noteMatchesFilters(note, filters)).length);
      }
      if (!category.system) {
        byNone.set(category.id, rest.filter((note) => noteMatchesFilters(note, others) && hasNoTagIn(note, [category])).length);
      }
    }
    // Properties' rules aren't tags, so they have their own map (their ids would clash with tag ids).
    const byProperty = new Map<number, number>();
    const tagged = searched.filter((note) => noteMatchesFilters(note, allFilters) && hasNoTagIn(note, noneFilters));
    for (const rule of PROPERTIES_CATEGORY.tags) {
      byProperty.set(rule.id, tagged.filter((note) => noteMatchesProperties(note, [rule.id], now)).length);
    }
    return { byTag, byNone, byProperty, total: visibleNotes.length };
  }, [notes, searchWords, properties, now, extraCategories, tabFilters, extraFilters, noneFilters, allFilters, visibleNotes.length]);

  function toggleSearch() {
    setSearchOn(!searchOn);
    setSearchText("");
  }

  /** The list as it was when a drag started: live updates don't change what's shown until the drop. */
  const dragList = useRef<Note[]>(undefined);
  const { drag, gripHandlers } = useNoteDrag(listRef, (noteId, target) => void dropNote(noteId, target));
  const listedNotes = drag && dragList.current ? dragList.current : visibleNotes;

  /** Every note's id in the shared order (unordered notes after, oldest first), without `leaving`. */
  function fullOrderWithout(leaving: number): number[] {
    return orderNotes(notes, noteOrder)
      .map((note) => note.id)
      .filter((id) => id !== leaving);
  }

  /**
   * Saves the shared order with the note moved to `target` among the other listed notes: straight after
   * the listed note above it (or before the first one). Notes this tab or its filters don't show keep
   * their places, and every note is in the saved order. Shown at once; reverted if it fails.
   */
  async function dropNote(noteId: number, target: number) {
    const others = (dragList.current ?? visibleNotes).filter((note) => note.id !== noteId);
    const order = fullOrderWithout(noteId);
    const above = others[target - 1];
    const below = others[0];
    const anchor = above ? order.indexOf(above.id) + 1 : below ? order.indexOf(below.id) : 0;
    const at = anchor < 0 ? order.length : anchor;
    const next = [...order.slice(0, at), noteId, ...order.slice(at)];
    onNoteOrderChanged(next);
    try {
      await api.setNoteOrder({ noteOrder: next });
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        onSessionExpired();
        return;
      }
      setNotice({ text: `The new order wasn't saved: ${error instanceof Error ? error.message : String(error)}`, error: true });
      onNotesChanged();
    }
  }
  /** Edit-order mode's buttons: moves a note to the top or the bottom of the listed notes, and saves the order. */
  function moveToEnd(noteId: number, end: "top" | "bottom") {
    // Not a drag, so the order is worked out from the list as it is now.
    dragList.current = undefined;
    void dropNote(noteId, end === "top" ? 0 : visibleNotes.length - 1);
  }

  /** What the filters require of new notes, so they always match and stay visible. */
  const constraints = useMemo(() => constraintsFor(allFilters), [allFilters]);
  /** While a long-form note is open, its child notes can have any tags, so nothing is locked. */
  const newNoteConstraints = useMemo(() => (longForm ? new Map<number, number[]>() : constraints), [longForm, constraints]);
  /** The tags the filters fix to one value (category id -> tag id), for the long-form editor's "match the tab". */
  const tabTags = useMemo(
    () =>
      new Map(
        [...constraints].flatMap(([categoryId, tagIds]) => (tagIds.length === 1 && tagIds[0] !== undefined ? [[categoryId, tagIds[0]] as const] : [])),
      ),
    [constraints],
  );

  /** The next note added goes at the top of the tab: set by Ctrl+Enter or a long press on Add. */
  const addAtTop = useRef(false);
  /** A note was just added at the top, so the list scrolls to the top instead of the bottom. */
  const scrollToTop = useRef(false);

  /** What the list last showed (the tab, its filter row and the search) and how many notes. */
  const listShown = useRef<{ key: string; length: number }>(undefined);

  // Newest notes are at the bottom, so the list jumps to the bottom when the page opens, when a note
  // is added (here or elsewhere), and when the tab, the filter row or the search changes. When a note
  // just leaves the list (archived, moved to the bin, or changed elsewhere), it stays where it is: the
  // browser keeps the notes in view from moving (scroll anchoring).
  useLayoutEffect(() => {
    const key = JSON.stringify([selectedTab?.id ?? null, allFilters, noneFilters.map((none) => none.id), properties, searchWords]);
    const before = listShown.current;
    listShown.current = { key, length: visibleNotes.length };
    const jump = !before || before.key !== key || visibleNotes.length > before.length;
    const list = listRef.current;
    if (list && jump) list.scrollTop = scrollToTop.current ? 0 : list.scrollHeight;
    scrollToTop.current = false;
  }, [visibleNotes.length, selectedTab?.id, allFilters, noneFilters, properties, searchWords]);

  /**
   * Puts a just-added note at the top of the tab: straight before the first note the tab lists (or at the
   * very front if it lists none), shown at once, then the shared order is saved in the background.
   */
  function addToTopOfTab(note: Note) {
    const order = fullOrderWithout(note.id);
    const first = visibleNotes.find((listed) => listed.id !== note.id);
    const at = first ? Math.max(0, order.indexOf(first.id)) : 0;
    const next = [...order.slice(0, at), note.id, ...order.slice(at)];
    scrollToTop.current = true;
    onNoteOrderChanged(next);
    api.setNoteOrder({ noteOrder: next }).catch((error: unknown) => {
      if (error instanceof ApiError && error.isUnauthorized) {
        onSessionExpired();
        return;
      }
      setNotice({ text: `The note was added at the bottom: ${error instanceof Error ? error.message : String(error)}`, error: true });
      onNotesChanged();
    });
  }

  /** A long press on Add puts the note at the top: only for new notes, online (on any tab, "All" included). */
  const canAddAtTop = !editingNote && !offline;
  const addButtonRef = useRef<HTMLButtonElement>(null);
  /** Add's long press: letting go after holding it for a second adds the note at the top. */
  const addHold = useLongPress(
    canAddAtTop,
    () => {
      const button = addButtonRef.current;
      if (!button?.form) return;
      addAtTop.current = true;
      button.form.requestSubmit(button);
    },
    showCanvas,
  );

  // Notices disappear by themselves.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(undefined), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  /** The due date of the note being added or edited (ISO), saved with it when Add or Update is tapped. */
  const [dueDate, setDueDate] = useState<string>();
  const [choosingDueDate, setChoosingDueDate] = useState(false);

  /**
   * The note being edited as the server last had it when the edit started (its lastModifiedDateTime):
   * saving is refused if it has changed since, e.g. in another tab. Undefined: saving replaces whatever is
   * there (the note has offline changes waiting, or "save again" after a refusal).
   */
  const editBase = useRef<string>(undefined);
  useEffect(() => {
    editBase.current = editingNote && !isWaiting(editingNote.id) ? editingNote.lastModifiedDateTime : undefined;
  }, [editingNote]);

  /** A save of the note being edited failed: says why. Saving again after it changed elsewhere replaces that change. */
  function editFailed(error: unknown, what: string) {
    if (error instanceof ApiError && error.isNoteChanged) {
      editBase.current = undefined;
      setSaveError(`${NOTE_CHANGED_ELSEWHERE} Save again to replace that change with yours, or cancel to keep it.`);
    } else {
      setSaveError(`${what}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function startEdit(note: Note) {
    setOrdering(false);
    // Any new note that was being typed or written is discarded.
    setTitle(note.titleText ?? "");
    setDueDate(note.dueDateTime);
    setEditSelection(selectionFor(note, userCategories));
    setSaveError(undefined);
    // A handwritten note's writing is loaded into the canvas, so it starts with ink.
    setPadInked(note.titleImage !== undefined);
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
    setDueDate(undefined);
    setEditSelection({});
    setSaveError(undefined);
    setPadInked(false);
    onEditEnd();
  }

  // Escape cancels an edit (unless it's closing an open tag list or the due-date pop-up).
  useEffect(() => {
    if (!editingNote) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving && !document.querySelector(".tag-dropdown-list, dialog[open]")) finishEdit();
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

  /** Edit-order mode's lifetime buttons: the listed notes that are Waiting, and those that are Archived. */
  const listedWaiting = visibleNotes.filter((note) => lifetimeOf(note) === LIFETIME_WAITING).map((note) => note.id);
  const listedArchived = visibleNotes.filter((note) => lifetimeOf(note) === LIFETIME_ARCHIVED).map((note) => note.id);
  const [listLifetimeBusy, setListLifetimeBusy] = useState(false);

  /** Moves the listed Waiting notes to Archived, or the listed Archived ones to the Bin, in one save. */
  async function changeListedLifetimes(action: "waiting-to-archived" | "archived-to-bin", noteIds: number[]) {
    if (listLifetimeBusy || noteIds.length === 0) return;
    setListLifetimeBusy(true);
    try {
      const { count } = await api.bulkLifetime(action, noteIds);
      if (count > 0) onNotesChanged();
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        onSessionExpired();
        return;
      }
      setNotice({ text: `Nothing was changed: ${error instanceof Error ? error.message : String(error)}`, error: true });
    } finally {
      setListLifetimeBusy(false);
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
  /** Long-form notes can't have a due date, so converting one removes it. */
  const convertTitle = convertHint ?? (dueDate ? "Convert to long-form note (removes its due date)" : "Convert to long-form note");

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
      const note = await offlineApi.updateNote(editingNote.id, { titleText: check.title, tagIds, ...details }, editBase.current);
      onNoteUpdated(note);
      finishEdit();
      openLongForm(note, true);
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        onSessionExpired();
        return;
      }
      editFailed(error, "The note wasn't converted");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Saves the note being edited, as Update does, and goes back to adding notes. Returns whether it was
   * saved: if not, the edit stays open with the error shown.
   */
  async function saveEdit(): Promise<boolean> {
    if (!editingNote || saving) return false;
    const noteTitle = newTitle();
    if (!noteTitle) return false;
    setSaving(true);
    setSaveError(undefined);
    try {
      const tagIds = selectedTagIds(userCategories, editSelection);
      onNoteUpdated(
        await offlineApi.updateNote(editingNote.id, { ...noteTitle, tagIds, ...(dueDate && { dueDateTime: dueDate }) }, editBase.current),
      );
      finishEdit();
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        onSessionExpired();
        return false;
      }
      // The typed title or the writing is kept, so it can be saved again.
      editFailed(error, "The note wasn't saved");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const atTop = addAtTop.current;
    addAtTop.current = false;
    if (saving) return;
    if (editingNote) {
      await saveEdit();
      // Focus after the input is re-enabled (to type the next note, or to fix this one).
      if (!showCanvas) requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }

    const noteTitle = newTitle();
    if (!noteTitle) return;
    // The filters' rules only apply to new notes; an edited note can be given any tags.
    {
      const missing = missingRequiredCategory(userCategories, tagSelection, newNoteConstraints);
      if (missing) {
        setSaveError(`Choose a ${missing.name} tag: this tab only shows notes with one.`);
        return;
      }
      const sharedProblem = sharedNoteProblem(selectedTagIds(userCategories, tagSelection, newNoteConstraints), userCategories, dueDate);
      if (sharedProblem) {
        setSaveError(sharedProblem);
        return;
      }
    }

    setSaving(true);
    setSaveError(undefined);
    try {
      {
        // The dropdowns keep their selections, so the next note gets the same tags unless they're changed.
        const tagIds = selectedTagIds(userCategories, tagSelection, newNoteConstraints);
        // While a long-form note is open, new notes are its children.
        const note = await offlineApi.addNote({
          ...noteTitle,
          tagIds,
          ...(longFormId !== undefined && { parentId: longFormId }),
          ...(dueDate && { dueDateTime: dueDate }),
        });
        // The due date doesn't carry over to the next note (unlike the tags).
        setDueDate(undefined);
        // A note added offline (a temporary id) can't be ordered yet.
        if (atTop && note.id > 0) addToTopOfTab(note);
        onNoteAdded(note);
        if (showCanvas) {
          padRef.current?.clear();
          setPadInked(false);
        } else setTitle("");
        // A child note can have any tags; other new notes match the tab, but are always New.
        if (!noteMatchesFilters(note, allFilters)) {
          setNotice({
            text: longForm
              ? "Note added, but it doesn't match this tab, so it isn't shown here."
              : "Note added, but this tab doesn't show New notes.",
          });
        } else if (!hasNoTagIn(note, noneFilters)) {
          setNotice({ text: "Note added, but it has a tag that a \"(None)\" filter hides." });
        } else if (!noteMatchesProperties(note, properties, Date.now())) {
          setNotice({ text: "Note added, but it doesn't match the Properties filter." });
        } else if (!matchesSearch(note, searchWords)) {
          setNotice({ text: "Note added, but it doesn't match the search." });
        } else if (atTop && note.id < 0) {
          setNotice({ text: "Added at the bottom: adding at the top isn't available offline." });
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

  /** Why list-check can't be turned on now, if it can't. */
  const titleEmpty = showCanvas ? !padInked : title.trim() === "";
  /**
   * While a note is being edited, the tabs, cog, filter row, edit-order button and other notes' buttons
   * save it first (as Update does) and then do what they do. Only when it has no title (typed, or written
   * on the canvas), or while it's being saved, are they blocked instead.
   */
  const blocked = editingNote !== undefined && (titleEmpty || saving);
  const onEditLockChangeRef = useRef(onEditLockChange);
  onEditLockChangeRef.current = onEditLockChange;
  useEffect(() => onEditLockChangeRef.current(blocked), [blocked]);
  useEffect(() => () => onEditLockChangeRef.current(false), []);

  // Using one of those controls (marked `data-saves-edit`, here and in the header) during an edit: the
  // click is held back, the note saved, and then the click is made again, once the page has caught up.
  const saveEditRef = useRef(saveEdit);
  saveEditRef.current = saveEdit;
  /** Set while the held-back click is made again, so it isn't held back a second time. */
  const replayingClick = useRef(false);
  const editOpen = editingNote !== undefined;
  useEffect(() => {
    if (!editOpen) return;
    const onClick = (event: MouseEvent) => {
      if (replayingClick.current || !(event.target instanceof Element)) return;
      const control = event.target.closest<HTMLElement>("button, a, input, label, [role='tab']");
      if (!control || !control.closest("[data-saves-edit]")) return;
      event.preventDefault();
      event.stopPropagation();
      void saveEditRef.current().then((saved) => {
        if (!saved) return;
        requestAnimationFrame(() => {
          if (!control.isConnected) return;
          replayingClick.current = true;
          try {
            control.click();
          } finally {
            replayingClick.current = false;
          }
        });
      });
    };
    // On the document, before the page's own handlers.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [editOpen]);

  const listCheckHint = offline
    ? OFFLINE_HINT
    : editingNote || longForm
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
  /** Turns multi-select on (a long press starts with every listed note selected) or off. */
  function toggleBulk(selectAll = false) {
    if (bulk) {
      setBulk(undefined);
      setSaveError(undefined);
    } else if (!listCheckHint) {
      // Notes shared with you can't have their tags changed, so they're never selected.
      setBulk({ noteIds: selectAll ? visibleNotes.filter((note) => !note.shared).map((note) => note.id) : [], changes: new Map() });
      setSaveError(undefined);
      setPadInked(false);
    }
  }

  /** Multi-select's long press: holding the button for a second turns it on with every listed note selected. */
  const bulkHold = useLongPress(!bulk && listCheckHint === undefined && !saving, () => toggleBulk(true), showCanvas);

  /** Selects or unselects a note, until a pill has been clicked. */
  function toggleBulkNote(noteId: number) {
    if (!bulk || bulk.changes.size > 0 || notes.find((note) => note.id === noteId)?.shared) return;
    const noteIds = bulk.noteIds.includes(noteId) ? bulk.noteIds.filter((id) => id !== noteId) : [...bulk.noteIds, noteId];
    setBulk({ ...bulk, noteIds });
  }

  /** The filter row's "All" and "None": selects exactly these notes, until a pill has been clicked. */
  function selectBulkNotes(noteIds: number[]) {
    if (!bulk || bulk.changes.size > 0) return;
    const shared = new Set(notes.filter((note) => note.shared).map((note) => note.id));
    setBulk({ ...bulk, noteIds: noteIds.filter((id) => !shared.has(id)) });
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
          // Tags shared with you can't be added to your own notes.
          categories={userCategories.filter((category) => !category.shared)}
          notes={notes.filter((note) => bulk.noteIds.includes(note.id))}
          changes={bulk.changes}
          onChange={(changes) => setBulk({ ...bulk, changes })}
          disabled={saving}
          showSharing
        />
      ) : editingNote ? (
        // A note shared with you keeps its tags: only its owner changes them.
        <TagChooser
          categories={userCategories}
          selection={editSelection}
          onChange={setEditSelection}
          disabled={saving || editingNote.shared !== undefined}
          showSharing
        />
      ) : (
        <TagChooser
          categories={userCategories}
          selection={tagSelection}
          onChange={onTagSelectionChange}
          disabled={saving}
          constraints={newNoteConstraints}
          tabName={selectedTab?.name}
          showSharing
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

  // Collapsing the filter row: when its dropdowns and buttons wrap onto more than one line, a chevron
  // shrinks it to the first line, and back. The choice is one for every tab, remembered on this device.
  const [rowCollapsedSetting, setRowCollapsed] = useFilterRowCollapsed();
  const rowMainRef = useRef<HTMLDivElement>(null);
  /** The height of the row's first line (px) when it wraps onto more, otherwise undefined. */
  const [firstLineHeight, setFirstLineHeight] = useState<number>();
  const rowCollapsed = rowCollapsedSetting && firstLineHeight !== undefined;
  useLayoutEffect(() => {
    const main = rowMainRef.current;
    if (!main) return;
    function measure() {
      if (!main) return;
      // The row's items: the dropdowns' own wrapper has no box ("display: contents"), so its children are items.
      const items = [...main.children].flatMap((child) =>
        getComputedStyle(child).display === "contents" ? [...child.children] : [child],
      ) as HTMLElement[];
      const first = items[0]?.getBoundingClientRect();
      if (!first) return setFirstLineHeight(undefined);
      // Items are centred on their line, so one on a later line starts below the bottom of the very first.
      const rects = items.map((item) => item.getBoundingClientRect());
      const below = rects.map((rect) => rect.top >= first.bottom);
      const top = main.getBoundingClientRect().top;
      const lineBottom = Math.max(...rects.filter((_, index) => !below[index]).map((rect) => rect.bottom));
      const wraps = below.some(Boolean);
      setFirstLineHeight(wraps ? Math.ceil(lineBottom - top) : undefined);
      // While collapsed, what's hidden can't be reached with Tab either.
      items.forEach((item, index) => (item.inert = rowCollapsedSetting && wraps && below[index]!));
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(main);
    return () => observer.disconnect();
  });

  return (
    <div className={fullTagList ? "notes-page full-tag-list" : "notes-page"}>
      {/* Always shown: even a tab that filters on every category has the search and edit-order buttons. */}
      {/* The left tab strip (if any tabs are set to "Left") beside the filter row and the list. */}
      <div className="notes-body">
        {leftTabs.length > 0 && !leftTabsHidden && (
          <LeftTabStrip tabs={leftTabs} selectedTabId={selectedTab?.id} onSelectTab={onSelectTab} editing={tabsBlocked} />
        )}
        <div className="notes-main">
          {/* Yellow while any of its dropdowns has something ticked, or a search is typed, so it's clear the tab's list is narrowed. */}
          <div
            className={rowFiltering || searchWords.length > 0 ? "filter-row filtered" : "filter-row"}
            aria-label="More filters for this tab"
          >
            {/* The dropdowns, reset and search wrap together like words; edit-order stays top-right. */}
            <div
              className={rowCollapsed ? "filter-row-main collapsed" : "filter-row-main"}
              data-saves-edit
              ref={rowMainRef}
              style={rowCollapsed ? { maxHeight: firstLineHeight } : undefined}
            >
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
            ) : ordering ? (
              // Edit-order mode: in place of the dropdowns and search, buttons that change the listed notes' Lifetime.
              <div className="list-lifetime" role="group" aria-label="Lifetime of the listed notes">
                {listedWaiting.length > 0 && (
                  <button
                    type="button"
                    className="small-button"
                    title="Archive every Waiting note in this list"
                    disabled={listLifetimeBusy || drag !== undefined}
                    onClick={() => void changeListedLifetimes("waiting-to-archived", listedWaiting)}
                  >
                    Waiting → Archive ({listedWaiting.length})
                  </button>
                )}
                {listedArchived.length > 0 && (
                  <button
                    type="button"
                    className="small-button"
                    title="Move every Archived note in this list to the bin"
                    disabled={listLifetimeBusy || drag !== undefined}
                    onClick={() => void changeListedLifetimes("archived-to-bin", listedArchived)}
                  >
                    Archived → Bin ({listedArchived.length})
                  </button>
                )}
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
                    counts={filterCounts}
                    selectAll
                    showSharing
                    noneOption
                  />
                )}
                {/* Rules about the notes themselves (long-form, due dates), after the category dropdowns. */}
                <TagPickers
                  categories={[PROPERTIES_CATEGORY]}
                  selection={{ [PROPERTIES_CATEGORY_ID]: properties }}
                  onChange={(selection) => setExtraSelection({ ...extraSelection, [PROPERTIES_CATEGORY_ID]: selection[PROPERTIES_CATEGORY_ID] ?? [] })}
                  disabled={rowBlocked}
                  checkLists
                  counts={{ byTag: filterCounts.byProperty, total: filterCounts.total }}
                />
                {/* Only while a tag or property is ticked; otherwise it takes no space. */}
                {rowFiltering && (
                  <IconButton
                    icon={faReplyAll}
                    label={rowBlocked ? rowHint : "Reset filters"}
                    disabled={rowBlocked}
                    onClick={() => setExtraSelection({})}
                  />
                )}
                <IconButton
                  icon={faMagnifyingGlass}
                  label={rowBlocked ? rowHint : searchOn ? "Close search" : "Search"}
                  disabled={rowBlocked}
                  pressed={searchOn}
                  onClick={toggleSearch}
                />
                {searchOn && (
                  <input
                    className="filter-search"
                    type="search"
                    aria-label="Search notes"
                    placeholder="Search titles and long-form text"
                    autoComplete="off"
                    autoFocus
                    value={searchText}
                    disabled={rowBlocked}
                    onChange={(event) => setSearchText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        toggleSearch();
                      }
                    }}
                  />
                )}
              </>
            )}
            </div>
            <div className="filter-row-end">
              {/* Only while the row takes more than one line (or would, when collapsed). */}
              {firstLineHeight !== undefined && (
                <IconButton
                  icon={rowCollapsed ? faChevronDown : faChevronUp}
                  label={rowCollapsed ? "Show all filters" : "Collapse filters to one row"}
                  disabled={false}
                  onClick={() => setRowCollapsed(!rowCollapsed)}
                />
              )}
              <IconButton
                icon={ordering ? faFinishOrdering : faArrowDownWideShort}
                wide={ordering}
                primary={ordering}
                label={ordering ? "Finish ordering" : offline ? OFFLINE_HINT : editBlocked ? rowHint : "Edit order"}
                savesEdit
                disabled={!ordering && (editBlocked || offline)}
                onClick={() => setOrdering(!ordering)}
              />
            </div>
          </div>

          <div className="note-list" ref={listRef}>
            {visibleNotes.length === 0 ? (
              <p className="empty">
                {searchWords.length > 0
                  ? "No notes match the search."
                  : properties.length > 0
                    ? "No notes match the Properties filter."
                    : allFilters.length > 0 || noneFilters.length > 0
                      ? "No notes in this tab yet."
                      : "No notes yet. Add your first one below."}
              </p>
            ) : (
              // Notes run top to bottom down each column, then on to the next column to the right.
              // A handwritten note's picture loading can change how much fits, so the columns are worked out again.
              <ul ref={columnsRef} style={{ columnCount: columnTotal }} onLoadCapture={fitColumns}>
                {rows.map((row) => {
                  if ("gap" in row) return <li key="drag-gap" className="drag-gap" style={{ height: row.gap }} aria-hidden />;
                  const note = row.note;
                  const dragging = note.id === drag?.noteId;
                  const selected = bulk?.noteIds.includes(note.id) ?? false;
                  const lifetime = lifetimeOf(note);
                  // A tag's colour tints the row, shaded by its Lifetime (never Bin notes). While a coloured note is
                  // being edited it shows the edit highlight instead, whatever its Lifetime.
                  const editing = note.id === editingNote?.id;
                  const coloured = lifetime !== LIFETIME_BIN && noteHue(note, categories) !== undefined;
                  const hue = coloured && !editing ? noteHue(note, categories) : undefined;
                  const classes = [
                    dragging && "dragging",
                    editing && "editing",
                    hue !== undefined && "tinted",
                    !coloured && lifetime === LIFETIME_WAITING && "waiting",
                    !coloured && lifetime === LIFETIME_ARCHIVED && "archived",
                    lifetime === LIFETIME_BIN && "binned",
                    selected && "selected",
                    bulk && (bulk.changes.size > 0 || note.shared ? "selection-locked" : "selectable"),
                  ].filter(Boolean);
                  const busy = blocked || busyNoteId !== undefined || bulkActive;
                  // A note shared with you: its buttons follow what its owner lets you do.
                  const canEdit = !note.shared || allows(note.shared.permission, "edit");
                  const canBin = !note.shared || allows(note.shared.permission, "delete");
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
                      style={{
                        ...(hue !== undefined && { background: noteBackground(note, hue) }),
                        ...(dragging && { top: drag.top, left: drag.left, width: drag.width, height: drag.height }),
                      }}
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
                        {note.titleImage !== undefined ? <HandwrittenTitle image={note.titleImage} /> : <FormattedText text={note.titleText ?? ""} />}
                        <TagPills
                          tagIds={note.tagIds}
                          categories={categories}
                          extra={specialPills(note)}
                          hideTagIds={filteredAloneTagIds}
                          showSharing
                          // In multi-select the New pill is plain, so tapping it selects the note like the rest of the row.
                          // Offline it's plain too: resetting the New tags needs the server.
                          onNewClick={bulk || offline || !canEdit ? undefined : () => setConfirmResetNew(true)}
                          newClickDisabled={resettingNew}
                        />
                      </div>
                      {/* Right-aligned; they don't need to line up between notes. The creation date sits below. */}
                      <div className="note-side">
                      <div className="note-actions" data-saves-edit>
                        {ordering ? (
                          // Edit-order mode: instead of the usual buttons, move the note to the top or bottom of the tab.
                          <>
                            <IconButton
                              icon={faAnglesUp}
                              label="Move to top"
                              disabled={drag !== undefined || listedNotes[0]?.id === note.id}
                              onClick={() => moveToEnd(note.id, "top")}
                            />
                            <IconButton
                              icon={faAnglesDown}
                              label="Move to bottom"
                              disabled={drag !== undefined || listedNotes.at(-1)?.id === note.id}
                              onClick={() => moveToEnd(note.id, "bottom")}
                            />
                          </>
                        ) : canEdit ? (
                          <>
                        <IconButton
                          icon={faPen}
                          label={note.id === editingNote?.id ? "Editing this note" : (hint ?? "Edit note")}
                          disabled={busy || saving || note.id === editingNote?.id}
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
                          canBin && (
                            <IconButton
                              icon={faTrashCan}
                              label={hint ?? "Move to bin"}
                              disabled={busy}
                              onClick={() => void changeLifetime(note, "Bin")}
                            />
                          )
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
                          </>
                        ) : (
                          // Read-only: no buttons, just a reminder whose note it is.
                          <span className="read-only-mark" title={`Shared by ${note.shared!.ownerName}, to read only`}>
                            <FontAwesomeIcon icon={faEye} />
                          </span>
                        )}
                      </div>
                      {/* The due date if the note has one, otherwise when it was created. */}
                      <time
                        className={["note-date", note.dueDateTime && dueClass(note.dueDateTime, now)].filter(Boolean).join(" ")}
                        dateTime={note.dueDateTime ?? note.createdDateTime}
                        title={`${note.dueDateTime ? "Due" : "Created"} ${new Date(note.dueDateTime ?? note.createdDateTime).toLocaleString()}`}
                      >
                        {pendingIds.has(note.id) && (
                          <FontAwesomeIcon icon={faClock} className="note-pending" title="Waiting to be saved (offline)" />
                        )}
                        {note.dueDateTime ? "Due " : "Cr. "}
                        {formatNoteDate(note.dueDateTime ?? note.createdDateTime)}
                      </time>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
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

      {choosingDueDate && (
        <DueDateDialog
          dueDate={dueDate}
          onSet={(value) => {
            setDueDate(value);
            setChoosingDueDate(false);
          }}
          onCancel={() => setChoosingDueDate(false)}
        />
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
            closeLongForm();
            if (deleted) onNotesChanged();
          }}
          offline={offline}
          onSessionExpired={onSessionExpired}
        />
      )}

      {/* The full-tag-list toggle sits over the divider between the list and the add/edit area. */}
      <div className={longForm ? "area-divider over-editor" : "area-divider"}>
        <button
          type="button"
          className="area-toggle"
          aria-pressed={fullTagList}
          aria-label={fullTagList ? "Show tag dropdowns" : "Show all tags"}
          title={fullTagList ? "Show tag dropdowns" : "Show all tags"}
          // Not with a handwritten long-form note open (the area stays collapsed for its canvas),
          // nor in multi-select, which needs the pills. With a typed long-form note it can be toggled.
          disabled={handwrittenLongForm || bulkActive}
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
                onKeyDown={(event) => {
                  // Ctrl+Enter (Cmd+Enter on a Mac) adds the note at the top of the tab.
                  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    addAtTop.current = !editingNote;
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
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
                  className={addHold.held ? "icon-button primary add-button held" : "icon-button primary add-button"}
                  aria-label={editingNote ? "Update" : "Add"}
                  title={
                    editingNote
                      ? "Update"
                      : addBlocked
                        ? LONG_FORM_TITLE_FIRST
                        : canAddAtTop
                          ? "Add (hold to add at the top)"
                          : "Add"
                  }
                  disabled={saving || addBlocked}
                  ref={addButtonRef}
                  {...addHold.handlers}
                  // A long press has already added the note when it was let go; its click (if any) is ignored.
                  onClick={(event) => {
                    if (addHold.isLongPressClick(event)) event.preventDefault();
                    else addAtTop.current = false;
                  }}
                >
                  <FontAwesomeIcon icon={editingNote ? faCircleCheck : addHold.held ? faCircleUp : faCirclePlus} />
                </button>
              )}
              {/* Drawn on the screen rather than in the add area, so they aren't cut off at its edges. */}
              {addHold.rings}
              {bulkHold.rings}
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
                  <FontAwesomeIcon icon={faFileLines} />
                </button>
              )}
              {/* In the expanded area while editing: turn the note into a long-form note. */}
              {fullTagList && editingNote && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Convert to long-form note"
                  title={convertTitle}
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
                  className={bulk ? "icon-button primary" : bulkHold.held ? "icon-button held" : "icon-button"}
                  aria-label={bulk ? "Stop selecting notes" : "Select notes to change their tags"}
                  aria-pressed={bulkActive}
                  title={
                    bulk
                      ? "Stop selecting notes (no changes)"
                      : (listCheckHint ?? "Select notes to change their tags (hold to select them all)")
                  }
                  disabled={saving || (!bulk && listCheckHint !== undefined)}
                  {...bulkHold.handlers}
                  onClick={(event) => {
                    if (!bulkHold.isLongPressClick(event)) toggleBulk();
                  }}
                >
                  <FontAwesomeIcon icon={faListCheck} />
                </button>
              )}
              {/* In the expanded area: the due date of the note being added or edited. Filled in while it has one. */}
              {/* Only a note's owner sets its due date. */}
              {fullTagList && !bulk && !editingNote?.shared && (
                <button
                  type="button"
                  className={dueDate ? "icon-button primary" : "icon-button"}
                  aria-label={dueDate ? "Change due date" : "Set due date"}
                  title={dueDate ? `Due ${formatNoteDate(dueDate)}` : "Set due date"}
                  disabled={saving}
                  onClick={() => setChoosingDueDate(true)}
                >
                  <FontAwesomeIcon icon={faAlarmClock} />
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
  pressed,
  wide,
  primary,
  savesEdit,
}: {
  icon: IconDefinition;
  label: string;
  disabled: boolean;
  onClick: () => void;
  /** For a toggle: filled in while it's on. */
  pressed?: boolean;
  /** For an icon wider than it is tall: the button grows to fit it. */
  wide?: boolean;
  /** Styled like the app's main buttons: white on the accent green. */
  primary?: boolean;
  /** Using it during an edit saves the note first (see `data-saves-edit`). */
  savesEdit?: boolean;
}) {
  return (
    <button
      type="button"
      className={["note-button", pressed && "pressed", wide && "wide", primary && "primary"].filter(Boolean).join(" ")}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      disabled={disabled}
      onClick={onClick}
      data-saves-edit={savesEdit || undefined}
    >
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

/**
 * Search: whether every word appears (ignoring case) in the note's typed title or typed long-form
 * details. With words to find, a handwritten title never matches. No words: every note matches.
 */
function matchesSearch(note: Note, words: string[]): boolean {
  if (words.length === 0) return true;
  if (note.titleText === undefined) return false;
  const text = `${note.titleText}\n${note.detailsText ?? ""}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

/**
 * A note's creation or due time in the device's local time, as "dd/MM HH:mm" (e.g. "26/10 14:05"),
 * with the year as "dd/MM/yy" when it isn't this year (e.g. "12/01/27 20:00").
 */
function formatNoteDate(iso: string): string {
  const date = new Date(iso);
  const two = (n: number) => String(n).padStart(2, "0");
  const year = date.getFullYear() === new Date().getFullYear() ? "" : `/${two(date.getFullYear() % 100)}`;
  return `${two(date.getDate())}/${two(date.getMonth() + 1)}${year} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** How a due date stands out: red and bold once past, bold within the next week. */
function dueClass(iso: string, now: number): string | undefined {
  const due = Date.parse(iso);
  return due < now ? "overdue" : due - now < WEEK_MS ? "due-soon" : undefined;
}

/**
 * Why a new note with these tags can't be added, if it has tags shared with you: it goes in their
 * owner's notebook, so it can only have tags shared by that one person, all ones you may edit, and no
 * due date (only the owner sets those). The server checks the same.
 */
function sharedNoteProblem(tagIds: number[], categories: Category[], dueDate: string | undefined): string | undefined {
  const shared = categories.find((category) => category.shared)?.tags.filter((tag) => tagIds.includes(tag.id)) ?? [];
  if (shared.length === 0) return undefined;
  if (shared.length !== tagIds.filter((id) => !isLifetimeTag(id)).length) {
    return "A note with a tag shared with you can't also have your own tags.";
  }
  if (new Set(shared.map((tag) => tag.ownerId)).size > 1) return "A note can only have tags shared with you by one person.";
  const readOnly = shared.find((tag) => tag.permission === undefined || !allows(tag.permission, "edit"));
  if (readOnly) return `"${tagLabel(readOnly)}" is shared with you to read only, so you can't add notes to it.`;
  if (dueDate) return `Only ${shared[0]!.ownerName ?? "its owner"} can set due dates on their notes.`;
  return undefined;
}
