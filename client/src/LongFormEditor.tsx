import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheck,
  faChevronLeft,
  faChevronRight,
  faCircleCheck,
  faEraser,
  faHighlighter,
  faPen,
  faShareFromSquare,
  faTags,
  faX,
} from "@fortawesome/free-solid-svg-icons";
import { faAlarmClock, faCopy } from "@fortawesome/free-regular-svg-icons";
import {
  DETAILS_TEXT_MAX_LENGTH,
  detailsPagesOf,
  MAX_DETAILS_PAGES,
  NOTE_CHANGED_ELSEWHERE,
  TITLE_MAX_LENGTH,
  validateTitle,
  type Category,
  type Note,
  type NoteDetails,
  type TextEdit,
  tickboxSpacing,
  tickboxToggle,
} from "@nwsnotes/shared";
import { ApiError } from "./api";
import { isWaiting, offlineApi } from "./offline";
import { ConfirmDialog } from "./ConfirmDialog";
import { DueDateDialog, dueOf, dueRequest, dueTitle, sameDue, type Due } from "./DueDateDialog";
import { ParentDialog, ParentPill } from "./ParentDialog";
import { possibleParents } from "./parents";
import { FormattedText, TickboxTargets } from "./FormattedText";
import { flashIgnoredTap } from "./ignoredTap";
import { StylusPad, type StylusPadHandle } from "./StylusPad";
import { BLACK_PEN, HIGHLIGHTER_COLOURS, PEN_WIDTHS, useHighlighterColour, usePenColour, usePenWidth } from "./stylusMode";
import { PenColourDialog } from "./PenColourDialog";
import { selectedTagIds, TagPickers, type TagSelection } from "./TagPickers";

/** Details and tag changes are sent at most this often (and once this long after the first change). */
const SAVE_DELAY_MS = 30_000;

interface Props {
  /** The long-form note being edited, or undefined when creating a new one. */
  note: Note | undefined;
  /** Every note the user can see, for the Parent pill and pop-up. */
  notes: Note[];
  /** The shared note order, for the Parent pop-up's list. */
  noteOrder: number[];
  /** The note's parent to start with: its own when editing, or the one new notes would get. */
  initialParentId: number | undefined;
  /** User categories (no Lifetime dropdown). */
  categories: Category[];
  stylusMode: boolean;
  /** Height of the add-note area below, which the editor leaves uncovered. */
  bottom: number;
  /** A version of the note was saved (`created` the first time). */
  onSaved: (note: Note, created: boolean) => void;
  /** The editor closes; `deleted` when Cancel deleted the new note. */
  onFinish: (deleted?: boolean) => void;
  /**
   * The server can't be reached. Cancel then only works for a note created offline (it's simply
   * forgotten); deleting one that's already on the server has to wait for the connection.
   */
  offline: boolean;
  /** Typed details take the focus when the editor opens (a note just converted to long-form). */
  startInDetails?: boolean;
  /**
   * The tags the selected tab (and its additional filters) fix to one value: category id -> tag id.
   * The "match the tab" button sets these. Empty under "All", or a tab with no one-tag filters.
   */
  tabTags: ReadonlyMap<number, number>;
  /** The selected tab's name, for the button's hint. */
  tabName?: string;
  onSessionExpired: () => void;
  /**
   * Set to the editor's Finish, for finishing it from outside (starting another long-form note). It
   * resolves to whether the editor closed: it stays open after a refused save, for the user to choose.
   */
  finishRef?: RefObject<(() => Promise<boolean>) | undefined>;
}

const PAGE_LIMIT_HINT = `${MAX_DETAILS_PAGES} pages is the most a note can have`;

/** Space between the pages in an exported image, in canvas pixels, with a thin grey line across its middle. */
const EXPORT_PAGE_GAP = 32;

/** In stylus mode, finger and palm taps on the editor's bottom-row buttons are ignored (a stylus or mouse works). */
function ignoredTap(stylusMode: boolean, event: ReactMouseEvent): boolean {
  const ignored = stylusMode && (event.nativeEvent as Partial<PointerEvent>).pointerType === "touch";
  if (ignored) flashIgnoredTap(event.currentTarget);
  return ignored;
}

/** One page of handwritten details: a key for its canvas, and the saved image it starts from (if any). */
interface DetailsPage {
  key: number;
  image?: string;
}

let nextPageKey = 1;

/** The note's tags as dropdown selections. */
function selectionFor(note: Note | undefined, categories: Category[]): TagSelection {
  if (!note) return {};
  return Object.fromEntries(
    categories.map((category) => [category.id, category.tags.filter((tag) => note.tagIds.includes(tag.id)).map((tag) => tag.id)]),
  );
}

/** The formatting the details can use, shown under the first line of the empty text box's placeholder. */
const FORMATTING_HELP = [
  "",
  "Formatting:",
  "*text* for bold",
  "_text_ for underline",
  "/text/ for italic",
  "-text- for strikethrough",
  "#text# for a yellow highlight",
  "[ ] or [] at the start of a line for a tickbox",
].join("\n");
const DETAILS_PLACEHOLDER = `Details\n${FORMATTING_HELP}`;
/** While the text box is locked, it says what to do first. */
const LOCKED_DETAILS_PLACEHOLDER = `Accept the title to write the details\n${FORMATTING_HELP}`;

/**
 * Creating or editing a long-form note: a title, tags, and details (typed, or handwritten in stylus
 * mode). The title and the details are never editable at the same time: accepting the title (which
 * creates the note the first time) unlocks the details; "edit title" locks them again. Details and tag
 * changes are saved at most every 30 seconds, and straight away on Finish or when the app is hidden.
 */
export function LongFormEditor({
  note,
  notes,
  noteOrder,
  initialParentId,
  categories,
  stylusMode,
  bottom,
  onSaved,
  onFinish,
  offline,
  startInDetails,
  tabTags,
  tabName,
  onSessionExpired,
  finishRef,
}: Props) {
  const [noteId, setNoteId] = useState(note?.id);
  const [title, setTitle] = useState(note?.titleText ?? "");
  /** The title as last saved; updates of the details are sent with it. */
  const savedTitle = useRef(note?.titleText ?? "");
  const [titleLocked, setTitleLocked] = useState(note !== undefined);
  const [selection, setSelection] = useState<TagSelection>(() => selectionFor(note, categories));
  /** The note's parent, saved with the tags (a new note is created with it). */
  const [parentId, setParentId] = useState(initialParentId);
  const [choosingParent, setChoosingParent] = useState(false);
  /** The note's due date, sent with every save (leaving it out would clear it). Only the owner can change it. */
  const [dueDate, setDueDate] = useState<Due | undefined>(() => dueOf(note));
  const [choosingDueDate, setChoosingDueDate] = useState(false);
  /** Typed or handwritten details: fixed for an existing note; for a new one, from stylus mode now. */
  const [kind] = useState<"text" | "image">(() =>
    note ? (note.detailsImage !== undefined ? "image" : "text") : stylusMode ? "image" : "text",
  );
  const [detailsText, setDetailsText] = useState(note?.detailsText ?? "");
  const titleRef = useRef<HTMLInputElement>(null);
  const detailsRef = useRef<HTMLTextAreaElement>(null);
  /** The formatted copy of the typed details, under the text box; it scrolls with it. */
  const displayRef = useRef<HTMLDivElement>(null);
  const targetsRef = useRef<HTMLDivElement>(null);
  /** Set when the title is accepted (or on opening a converted note), so the typed details take the focus once enabled. */
  const focusDetails = useRef(startInDetails === true && kind === "text");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  /** Only a note created in this editor can be cancelled (deleted); editing an existing one can't. */
  const [isNew] = useState(note === undefined);
  /** Cancel with details written asks before deleting. */
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  /** The eraser button (handwritten details only): selected, a stylus or mouse erases. */
  const [erasing, setErasing] = useState(false);
  /** The device's pen thickness, also chosen with the buttons beside the eraser. */
  const [penWidth, setPenWidth] = usePenWidth();
  /** The device's pen colour for long-form notes, chosen from the pen menu. */
  const [penColour, setPenColour] = usePenColour();
  const [choosingPenColour, setChoosingPenColour] = useState(false);
  /** The highlighter's colour (remembered on this device), and whether it's in use instead of the pen. */
  const [highlighterColour, setHighlighterColour] = useHighlighterColour();
  const [highlighting, setHighlighting] = useState(false);
  const [choosingHighlighter, setChoosingHighlighter] = useState(false);
  /**
   * Handwritten details' pages. Each has its own canvas; they're all kept (stacked, only the current
   * one shown), so turning the page never redraws or moves what's written.
   */
  const [pages, setPages] = useState<DetailsPage[]>(() => {
    const images = note ? detailsPagesOf(note) : [];
    return (images.length > 0 ? images : [""]).map((image) => ({ key: nextPageKey++, ...(image && { image }) }));
  });
  const [pageIndex, setPageIndex] = useState(0);
  /** Each page's canvas, by its key. */
  const pads = useRef(new Map<number, StylusPadHandle>());
  /** Which pages' canvases have any ink (by key), for the export button. */
  const [inkedPages, setInkedPages] = useState<ReadonlySet<number>>(new Set());
  const padHasInk = pages.some((page) => inkedPages.has(page.key));
  /** Where the open page menu sits on the window (above its button), if it's open. */
  const [pageMenu, setPageMenu] = useState<{ bottom: number; left: number }>();
  const pageMenuRef = useRef<HTMLDivElement>(null);
  const pageMenuButton = useRef<HTMLButtonElement>(null);
  /** Where the open pen-thickness menu sits on the window (above its button), if it's open. */
  const [penMenu, setPenMenu] = useState<{ bottom: number; left: number }>();
  const penMenuRef = useRef<HTMLDivElement>(null);
  const penMenuButton = useRef<HTMLButtonElement>(null);
  /** "Next page" on the last page asks whether to add one. */
  const [confirmingAddPage, setConfirmingAddPage] = useState(false);
  const [confirmingDeletePage, setConfirmingDeletePage] = useState(false);

  /** The pages as they are now, for saves that run from a timer. */
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  // The latest values, for saves that run from a timer.
  const latest = useRef({ selection, detailsText, parentId, dueDate });
  latest.current = { selection, detailsText, parentId, dueDate };
  const dirty = useRef(false);
  const timer = useRef<number>(undefined);
  const saving = useRef<Promise<void>>(Promise.resolve());
  /**
   * The note as the server last had it (its lastModifiedDateTime), when this editor opened or last saved:
   * a save is refused if it has changed since, e.g. in another tab. Undefined: saves replace whatever is
   * there (the note has offline changes waiting, or "keep mine" after a refusal).
   */
  const base = useRef(note && !isWaiting(note.id) ? note.lastModifiedDateTime : undefined);
  /** A save was refused because the note changed elsewhere: nothing more is saved until the user chooses. */
  const [conflict, setConflict] = useState(false);
  const conflictRef = useRef(false);
  conflictRef.current = conflict;
  /** The refusal came on Finish, so choosing "keep mine" finishes too. */
  const finishAfterConflict = useRef(false);

  /** Saves the note as it is now; the server's reply is the version later saves start from. */
  async function sendUpdate(id: number, titleText: string): Promise<void> {
    const saved = await offlineApi.updateNote(id, request(titleText), base.current);
    base.current = isWaiting(saved.id) ? undefined : saved.lastModifiedDateTime;
    onSaved(saved, false);
  }

  const detailsEditable = titleLocked && noteId !== undefined;
  /** As many pages as handwritten details can have: no more can be added. */
  const atPageLimit = pages.length >= MAX_DETAILS_PAGES;

  /** Each page's canvas, in page order. */
  function pagePads(): (StylusPadHandle | undefined)[] {
    return pagesRef.current.map((page) => pads.current.get(page.key));
  }

  function currentDetails(): NoteDetails {
    if (kind === "text") return { detailsText: latest.current.detailsText };
    const [first = "", ...more] = pagePads().map((pad) => (pad?.hasInk() ? pad.toImage() : ""));
    return { detailsImage: first, detailsMorePages: more };
  }

  /** The note as it is now. An update says the parent either way (null for none); a new note only has one if chosen. */
  function request(titleText: string, update = true) {
    const { parentId: parent, dueDate: due } = latest.current;
    return {
      titleText,
      tagIds: selectedTagIds(categories, latest.current.selection),
      ...currentDetails(),
      ...dueRequest(due),
      ...(update ? { parentId: parent ?? null } : parent !== undefined && { parentId: parent }),
    };
  }

  function failed(err: unknown, what: string) {
    if (err instanceof ApiError && err.isUnauthorized) {
      onSessionExpired();
      return;
    }
    if (err instanceof ApiError && err.isNoteChanged) {
      // What's here is kept (unsaved) until the user decides.
      dirty.current = true;
      window.clearTimeout(timer.current);
      timer.current = undefined;
      conflictRef.current = true;
      setConflict(true);
      return;
    }
    setError(`${what}: ${err instanceof Error ? err.message : String(err)}`);
  }

  /** Sends any pending details or tag change now. Saves run one at a time. */
  function flush(): Promise<void> {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    saving.current = saving.current.then(async () => {
      if (!dirty.current || noteId === undefined || conflictRef.current) return;
      dirty.current = false;
      try {
        await sendUpdate(noteId, savedTitle.current);
        setError(undefined);
      } catch (err) {
        // Try again at the next window (unless the note changed elsewhere: then the user decides).
        dirty.current = true;
        if (!(err instanceof ApiError && err.isNoteChanged)) schedule();
        failed(err, "The note wasn't saved; trying again shortly");
      }
    });
    return saving.current;
  }

  /** A due date chosen (or cleared, undefined) in the pop-up: saved straight away, not at the end of the window. */
  function changeDueDate(value: Due | undefined) {
    setChoosingDueDate(false);
    if (sameDue(value, latest.current.dueDate)) return;
    setDueDate(value);
    latest.current.dueDate = value;
    dirty.current = true;
    void flush();
  }

  /** A details or tag change: save it once the 30-second window ends. */
  function schedule() {
    dirty.current = true;
    if (conflictRef.current) return;
    if (timer.current === undefined) timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
  }

  /** The typed details changed (by typing, or by a tickbox or its spacing). */
  function changeDetails(text: string) {
    setDetailsText(text);
    latest.current.detailsText = text;
    schedule();
  }

  /**
   * A tickbox just typed at the start of a line: where it ends (after "[]" a space may follow), so the
   * first thing typed after it can space it out ("[]Hello" becomes "[ ] Hello"). Anything else typed,
   * deleted or undone clears it, so a space taken out on purpose doesn't come back.
   */
  const freshTickbox = useRef<{ lineStart: number; end: number }>(undefined);
  /** The line whose tickbox needs spacing once the phone's keyboard has finished the word being typed. */
  const spaceAfterComposing = useRef<number>(undefined);
  /** Lines (where each starts) whose tickboxes are waiting to be spaced out. */
  const tickboxesToSpace = useRef<number[]>([]);
  /** Set while this editor changes the text box's text itself, so that change isn't taken as typing. */
  const editing = useRef(false);
  /**
   * The text and cursor from before this editor's last change to the text box. Undo would put the cursor
   * where the change was (in a tickbox), so when Undo brings this text back, the cursor goes back too.
   */
  const beforeEdit = useRef<{ text: string; start: number; end: number }>(undefined);
  /**
   * Makes a change to the typed details. While the text box has the focus, it's made as an edit of the
   * text box, so Undo takes it back and the cursor stays where it was. Otherwise (a tickbox tapped on a
   * phone, say) the text is just replaced, without focusing the box and bringing up the keyboard.
   */
  function editDetails({ from, to, insert }: TextEdit) {
    const text = latest.current.detailsText;
    if (text.length - (to - from) + insert.length > DETAILS_TEXT_MAX_LENGTH) return;
    const shift = (at: number) => (at >= to ? at + insert.length - (to - from) : at);
    // A tickbox being typed further on, while this one is spaced out, has moved along.
    const fresh = freshTickbox.current;
    if (fresh) freshTickbox.current = { lineStart: shift(fresh.lineStart), end: shift(fresh.end) };
    if (spaceAfterComposing.current !== undefined) spaceAfterComposing.current = shift(spaceAfterComposing.current);
    tickboxesToSpace.current = tickboxesToSpace.current.map(shift);
    const box = detailsRef.current;
    if (box && document.activeElement === box) {
      const { selectionStart, selectionEnd } = box;
      box.setSelectionRange(from, to);
      editing.current = true;
      const done = document.execCommand("insertText", false, insert);
      editing.current = false;
      if (done) {
        box.setSelectionRange(shift(selectionStart), shift(selectionEnd));
        beforeEdit.current = { text, start: selectionStart, end: selectionEnd };
        return;
      }
    }
    changeDetails(text.slice(0, from) + insert + text.slice(to));
  }

  function toggleTickbox(lineIndex: number) {
    if (!detailsEditable) return;
    const edit = tickboxToggle(latest.current.detailsText, lineIndex);
    if (edit) editDetails(edit);
  }

  /** Queues the spacing of a line's tickbox, made once the typing that called for it is in the text box. */
  function spaceTickbox(lineStart: number) {
    tickboxesToSpace.current.push(lineStart);
  }

  function spaceTickboxes() {
    for (let lineStart; (lineStart = tickboxesToSpace.current.shift()) !== undefined; ) {
      const edit = tickboxSpacing(latest.current.detailsText, lineStart);
      if (edit) editDetails(edit);
    }
  }
  // Straight after the keystroke that called for it has been shown, before the next one (but not while
  // React is still updating the page, which would put the text box's old text back).
  useLayoutEffect(() => {
    if (tickboxesToSpace.current.length > 0) queueMicrotask(spaceTickboxes);
  }, [detailsText]);

  function onDetailsInput(box: HTMLTextAreaElement, input: InputEvent | undefined) {
    changeDetails(box.value);
    if (editing.current) return;
    const undone = beforeEdit.current;
    beforeEdit.current = undefined;
    if (input?.inputType === "historyUndo" && undone?.text === box.value) box.setSelectionRange(undone.start, undone.end);
    const fresh = freshTickbox.current;
    freshTickbox.current = undefined;
    const type = input?.inputType ?? "";
    const typed = type.startsWith("insert") && type !== "insertFromPaste" && type !== "insertFromDrop" && box.selectionStart === box.selectionEnd;
    if (!typed) return;
    const text = box.value;
    const caret = box.selectionStart;
    const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
    const before = text.slice(lineStart, caret);
    if (/^[ \t]*(\[[ xX]?\]|\[\] )$/.test(before)) {
      freshTickbox.current = { lineStart, end: caret };
      return;
    }
    // The first thing typed after a fresh tickbox, if it isn't a space or a new line.
    if (!fresh || fresh.lineStart !== lineStart || caret <= fresh.end || !/\S/.test(text[fresh.end] ?? "")) return;
    if (caret - (input?.data?.length ?? 1) !== fresh.end) return;
    if (input?.isComposing) {
      // A phone's keyboard is still working on this word: changing the text before it now can upset
      // its suggestions and autocorrect, so wait until it's finished.
      freshTickbox.current = fresh;
      spaceAfterComposing.current = lineStart;
      return;
    }
    spaceTickbox(lineStart);
  }

  function onDetailsCompositionEnd() {
    const lineStart = spaceAfterComposing.current;
    spaceAfterComposing.current = undefined;
    freshTickbox.current = undefined;
    if (lineStart === undefined) return;
    spaceTickbox(lineStart);
    // The keyboard may have finished without changing the text, so nothing else would make the change.
    window.setTimeout(spaceTickboxes);
  }

  // Save straight away if the app goes into the background, and when the editor closes.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flushRef.current();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      void flushRef.current();
    };
  }, []);

  async function acceptTitle() {
    const check = validateTitle(title);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      // Tag changes made while editing the title are saved with it.
      if (noteId === undefined) {
        const created = await offlineApi.addNote(request(check.title, false));
        base.current = isWaiting(created.id) ? undefined : created.lastModifiedDateTime;
        setNoteId(created.id);
        onSaved(created, true);
      } else {
        await saving.current;
        dirty.current = false;
        await sendUpdate(noteId, check.title);
      }
      savedTitle.current = check.title;
      setTitle(check.title);
      setTitleLocked(true);
      // Typed details get the focus, ready to write (once they're enabled).
      focusDetails.current = kind === "text";
    } catch (err) {
      failed(err, "The title wasn't saved");
    } finally {
      setBusy(false);
    }
  }

  function changeTags(next: TagSelection) {
    setSelection(next);
    latest.current.selection = next;
    if (detailsEditable) schedule();
  }

  /** A parent chosen in the Parent pop-up (undefined for none): saved like a tag change. */
  function changeParent(next: number | undefined) {
    setChoosingParent(false);
    setParentId(next);
    latest.current.parentId = next;
    if (detailsEditable) schedule();
  }

  /**
   * "Match the tab": each tag the selected tab fixes to one value is chosen. In a single-select
   * category it replaces whatever was chosen; in a multi-select one it's added to the others.
   */
  function matchTab() {
    const next: TagSelection = { ...selection };
    for (const category of categories) {
      const tagId = tabTags.get(category.id);
      if (tagId === undefined) continue;
      const chosen = next[category.id] ?? [];
      next[category.id] = category.multiSelect ? (chosen.includes(tagId) ? chosen : [...chosen, tagId]) : [tagId];
    }
    changeTags(next);
  }

  const matchHint =
    tabTags.size === 0
      ? tabName
        ? `The "${tabName}" tab has no one-tag filters to match`
        : `Choose a tab to match its tags`
      : `Set the tags to match the ${tabName ? `"${tabName}" tab` : "tab"}`;

  /** In stylus mode, Finish ignores finger and palm taps (a stylus or mouse works). */
  function onFinishClick(event: ReactMouseEvent) {
    if (ignoredTap(stylusMode, event)) return;
    void finish();
  }

  /** Outside stylus mode, Ctrl+Enter, Alt+Enter or Cmd+Enter (Mac) anywhere in the editor does the same as Finish. */
  function onEditorKeyDown(event: ReactKeyboardEvent) {
    if (stylusMode || event.key !== "Enter" || !(event.ctrlKey || event.altKey || event.metaKey)) return;
    // Not a new line in the details, and not "accept title".
    event.preventDefault();
    event.stopPropagation();
    if (!busy) void finish();
  }

  /** Saves everything and closes the editor; resolves to false if it stays open (a refused save). */
  async function finish(): Promise<boolean> {
    setBusy(true);
    await flush();
    // The note changed elsewhere: the editor stays open until the user chooses which version to keep.
    if (conflictRef.current) {
      finishAfterConflict.current = true;
      setBusy(false);
      return false;
    }
    // A changed title that hasn't been accepted yet is saved too, rather than lost.
    const check = validateTitle(title);
    if (!titleLocked && noteId !== undefined && check.ok && check.title !== savedTitle.current) {
      try {
        await sendUpdate(noteId, check.title);
      } catch (err) {
        failed(err, "The title wasn't saved");
        if (conflictRef.current) finishAfterConflict.current = true;
        setBusy(false);
        return false;
      }
    }
    onFinish();
    return true;
  }
  if (finishRef) finishRef.current = busy ? undefined : finish;

  /** After a refused save: this editor's version replaces the one saved elsewhere. */
  function keepMine() {
    base.current = undefined;
    conflictRef.current = false;
    setConflict(false);
    if (finishAfterConflict.current) void finish();
    else void flush();
  }

  /** After a refused save: this editor's unsaved changes are dropped, and it closes (showing the other version). */
  function discardMine() {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    dirty.current = false;
    setConflict(false);
    onFinish();
  }

  /** In stylus mode, finger and palm taps on the eraser button are ignored, like Finish. */
  function onEraserClick(event: ReactMouseEvent) {
    if (ignoredTap(stylusMode, event)) return;
    setErasing(!erasing);
  }

  function togglePenMenu(event: ReactMouseEvent) {
    if (ignoredTap(stylusMode, event)) return;
    const rect = penMenuButton.current?.getBoundingClientRect();
    if (penMenu || !rect) setPenMenu(undefined);
    else setPenMenu({ bottom: window.innerHeight - rect.top + 4, left: rect.left });
  }

  useCloseOnOutside(penMenu !== undefined, penMenuRef, () => setPenMenu(undefined));

  /**
   * A pen-thickness menu item: chooses it (for every canvas on this device), goes back to the pen from
   * the eraser or highlighter, and closes the menu.
   */
  function onPenWidthClick(event: ReactMouseEvent, width: number) {
    if (ignoredTap(stylusMode, event)) return;
    setPenWidth(width);
    setErasing(false);
    setHighlighting(false);
    setPenMenu(undefined);
  }

  /** A pen colour (from the dialog, or black from the menu): drawn with from now on, back to the pen. */
  function choosePenColour(colour: string) {
    setPenColour(colour);
    setErasing(false);
    setHighlighting(false);
    setChoosingPenColour(false);
    setPenMenu(undefined);
  }

  /** A highlighter colour (from its dialog): the highlighter is used from now on, instead of the pen or eraser. */
  function chooseHighlighter(colour: string) {
    setHighlighterColour(colour);
    setHighlighting(true);
    setErasing(false);
    setChoosingHighlighter(false);
    setPenMenu(undefined);
  }

  /** Turns to another page (the menu closes). */
  function goToPage(index: number) {
    setPageMenu(undefined);
    setPageIndex(Math.max(0, Math.min(pagesRef.current.length - 1, index)));
  }

  function onPreviousPage(event: ReactMouseEvent) {
    if (ignoredTap(stylusMode, event)) return;
    goToPage(pageIndex - 1);
  }

  /** Next page; on the last page, asks whether to add one (unless there are already as many as there can be). */
  function onNextPage(event: ReactMouseEvent) {
    if (ignoredTap(stylusMode, event)) return;
    if (pageIndex < pages.length - 1) goToPage(pageIndex + 1);
    else if (pages.length < MAX_DETAILS_PAGES) {
      setPageMenu(undefined);
      setConfirmingAddPage(true);
    }
  }

  /** Adds a blank page after the current one, and turns to it. Saved like any other change. */
  function addPage() {
    setConfirmingAddPage(false);
    setPageMenu(undefined);
    if (pagesRef.current.length >= MAX_DETAILS_PAGES) return;
    const next = [...pagesRef.current];
    next.splice(pageIndex + 1, 0, { key: nextPageKey++ });
    pagesRef.current = next;
    setPages(next);
    setPageIndex(pageIndex + 1);
    schedule();
  }

  /** Deletes the current page (never the only one), and shows the one before it (or the new first page). */
  function deletePage() {
    setConfirmingDeletePage(false);
    if (pagesRef.current.length <= 1) return;
    const next = pagesRef.current.filter((_, index) => index !== pageIndex);
    pagesRef.current = next;
    setPages(next);
    setPageIndex(Math.max(0, pageIndex - 1));
    schedule();
  }

  function togglePageMenu(event: ReactMouseEvent) {
    if (ignoredTap(stylusMode, event)) return;
    const rect = pageMenuButton.current?.getBoundingClientRect();
    if (pageMenu || !rect) setPageMenu(undefined);
    else setPageMenu({ bottom: window.innerHeight - rect.top + 4, left: rect.left });
  }

  useCloseOnOutside(pageMenu !== undefined, pageMenuRef, () => setPageMenu(undefined));

  /** A page menu item: ignores finger taps in stylus mode, like the buttons. */
  function menuAction(action: () => void) {
    return (event: ReactMouseEvent) => {
      if (!ignoredTap(stylusMode, event)) action();
    };
  }

  /**
   * The handwritten details as one PNG (the ink on white): each page with writing, cropped to its ink,
   * one under another (lined up on the left), with a thin grey line between pages. Blank pages are left out.
   */
  function exportImage(): string | undefined {
    const parts = pagePads()
      .filter((pad) => pad?.hasInk())
      .map((pad) => pad!.toCanvas("#fff"));
    if (parts.length === 0) return undefined;
    const joined = document.createElement("canvas");
    joined.width = Math.max(...parts.map((part) => part.width));
    joined.height = parts.reduce((total, part) => total + part.height, 0) + EXPORT_PAGE_GAP * (parts.length - 1);
    const context = joined.getContext("2d")!;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, joined.width, joined.height);
    let top = 0;
    parts.forEach((part, index) => {
      if (index > 0) {
        context.fillStyle = "#ccc";
        context.fillRect(0, top - EXPORT_PAGE_GAP / 2 - 1, joined.width, 2);
      }
      context.drawImage(part, 0, top);
      top += part.height + EXPORT_PAGE_GAP;
    });
    return joined.toDataURL("image/png");
  }

  /**
   * Exports the handwritten details (every page) as a PNG: through the device's share sheet where the
   * browser can share files (Android), otherwise as a download.
   */
  function onExportClick(event: ReactMouseEvent) {
    if (ignoredTap(stylusMode, event)) return;
    const dataUrl = exportImage();
    if (!dataUrl) return;
    const file = new File([dataUrlToBlob(dataUrl)], exportFileName(title), { type: "image/png" });
    // Shared straight away (no waiting first), as sharing needs the tap that asked for it.
    if (navigator.canShare?.({ files: [file] })) {
      navigator.share({ files: [file] }).catch((err: unknown) => {
        // Closing the share sheet without choosing anything isn't an error.
        if (!(err instanceof DOMException && err.name === "AbortError")) setError(`The image couldn't be shared: ${err instanceof Error ? err.message : String(err)}`);
      });
      return;
    }
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = file.name;
    link.click();
  }

  /** Cancel (new notes only): straight away if there are no details, otherwise after asking. */
  function onCancelClick(event: ReactMouseEvent) {
    if (ignoredTap(stylusMode, event)) return;
    const empty = kind === "text" ? latest.current.detailsText.trim() === "" : !pagePads().some((pad) => pad?.hasInk());
    if (empty) void cancel();
    else setConfirmingCancel(true);
  }

  /** Closes the editor, deleting the note if its title was already saved. Pending details are dropped. */
  async function cancel() {
    setConfirmingCancel(false);
    setBusy(true);
    const dropPending = () => {
      window.clearTimeout(timer.current);
      timer.current = undefined;
      dirty.current = false;
    };
    dropPending();
    await saving.current;
    // A save that failed meanwhile may have rescheduled itself.
    dropPending();
    if (noteId !== undefined) {
      try {
        await offlineApi.deleteNote(noteId);
      } catch (err) {
        failed(err, "The note wasn't deleted");
        setBusy(false);
        return;
      }
    }
    onFinish(noteId !== undefined);
  }

  // After accepting the title, move into the typed details.
  useEffect(() => {
    if (detailsEditable && !busy && focusDetails.current) {
      focusDetails.current = false;
      detailsRef.current?.focus();
    }
  }, [detailsEditable, busy]);

  /** Back to editing the title (the details lock); pending details are saved first. */
  async function editTitle() {
    if (busy) return;
    await flush();
    setTitleLocked(false);
    requestAnimationFrame(() => titleRef.current?.focus());
  }

  return (
    <div
      className="long-form-editor"
      style={{ bottom }}
      role="dialog"
      aria-label="Long-form note"
      // Capture, so it's handled before the title box's own Enter (accept title).
      onKeyDownCapture={onEditorKeyDown}
    >
      <div className="lf-title-row">
        <input
          ref={titleRef}
          type="text"
          aria-label="Long-form note title"
          placeholder="Title"
          value={title}
          maxLength={TITLE_MAX_LENGTH}
          autoComplete="off"
          autoFocus={!titleLocked}
          // Read-only rather than disabled while locked, so a click on it can start editing the title.
          readOnly={titleLocked}
          title={titleLocked ? "Click to edit the title" : undefined}
          disabled={busy}
          onClick={() => {
            if (titleLocked) void editTitle();
          }}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !titleLocked) void acceptTitle();
          }}
        />
        {titleLocked ? (
          <button
            type="button"
            className="icon-button"
            aria-label="Edit title"
            title="Edit title"
            disabled={busy}
            onClick={() => void editTitle()}
          >
            <FontAwesomeIcon icon={faPen} />
          </button>
        ) : (
          <button
            type="button"
            className="icon-button primary"
            aria-label="Accept title"
            title="Accept title"
            disabled={busy}
            onClick={() => void acceptTitle()}
          >
            <FontAwesomeIcon icon={faCheck} />
          </button>
        )}
      </div>

      {/* A tinted, labelled band, so the note's tags stand out between the title and the details. */}
      <div className="lf-tags" role="group" aria-label="Tags">
        {/* A note shared with you keeps its tags: only its owner changes them. */}
        <TagPickers
          categories={categories}
          selection={selection}
          onChange={changeTags}
          disabled={busy || note?.shared !== undefined}
          showSharing
        />
        {/* After the dropdowns: the note's parent, when there's a long-form note it could go inside. */}
        {possibleParents(notes).some((other) => other.id !== noteId) && (
          <div className="lf-parent" role="group" aria-label="Parent">
            <span className="tag-pill-category">Parent</span>
            <ParentPill notes={notes} parentId={parentId} disabled={busy} onClick={() => setChoosingParent(true)} />
          </div>
        )}
        {/* At the far right: choose the tags the selected tab fixes. */}
        <button
          type="button"
          className="note-button"
          aria-label={matchHint}
          title={matchHint}
          disabled={busy || tabTags.size === 0 || note?.shared !== undefined}
          onClick={matchTab}
        >
          <FontAwesomeIcon icon={faTags} />
        </button>
      </div>

      <div className={detailsEditable ? "lf-details" : "lf-details locked"}>
        {kind === "text" ? (
          // Exactly overlapping layers: the formatted text underneath, the real text box on top with
          // invisible text, so typing, the cursor and selection work as usual, and above that only the
          // tickboxes, to click on. Every letter is the same width in all three (see .lf-text in
          // styles.css), so the cursor lines up with what's shown.
          <div className="lf-text">
            <div className="lf-text-display" ref={displayRef} aria-hidden>
              <FormattedText text={detailsText} showMarkers tickboxes />
              {/* A last empty line still takes its height, as it does in the text box. */}
              {detailsText.endsWith("\n") && " "}
            </div>
            <textarea
              ref={detailsRef}
              aria-label="Details"
              placeholder={detailsEditable ? DETAILS_PLACEHOLDER : LOCKED_DETAILS_PLACEHOLDER}
              value={detailsText}
              maxLength={DETAILS_TEXT_MAX_LENGTH}
              disabled={!detailsEditable}
              onChange={(event) => onDetailsInput(event.currentTarget, event.nativeEvent as InputEvent)}
              onCompositionEnd={onDetailsCompositionEnd}
              onScroll={(event) => {
                if (displayRef.current) displayRef.current.scrollTop = event.currentTarget.scrollTop;
                if (targetsRef.current) targetsRef.current.scrollTop = event.currentTarget.scrollTop;
              }}
            />
            {/* Above the text box: the tickboxes, to click on. */}
            {detailsEditable && (
              <div
                className="lf-text-targets"
                ref={(layer) => {
                  targetsRef.current = layer;
                  if (layer && detailsRef.current) layer.scrollTop = detailsRef.current.scrollTop;
                }}
                aria-hidden
              >
                <TickboxTargets text={detailsText} onToggle={toggleTickbox} />
                {detailsText.endsWith("\n") && " "}
              </div>
            )}
          </div>
        ) : (
          pages.map((page, index) => (
            // Every page's canvas stays, stacked; only the current one is shown (and can be written on).
            <div key={page.key} className={index === pageIndex ? "lf-page" : "lf-page hidden"}>
              <StylusPad
                ref={(handle) => {
                  if (handle) pads.current.set(page.key, handle);
                  else pads.current.delete(page.key);
                }}
                fill
                label="Details of the long-form note"
                disabled={!detailsEditable || index !== pageIndex}
                colour={penColour}
                highlighter={highlighting ? highlighterColour : undefined}
                erasing={erasing}
                initialImage={page.image}
                onInk={schedule}
                onInkChange={(inked) =>
                  setInkedPages((was) => {
                    if (was.has(page.key) === inked) return was;
                    const next = new Set(was);
                    if (inked) next.add(page.key);
                    else next.delete(page.key);
                    return next;
                  })
                }
              />
            </div>
          ))
        )}
        {!detailsEditable && kind === "image" && (
          <p className="lf-locked-hint">{noteId === undefined ? "Accept the title to write the details" : "Accept the title to keep writing"}</p>
        )}
      </div>

      {error && (
        <p className="save-error" role="alert">
          {error}
        </p>
      )}

      <div className="lf-finish">
        {/* At the far left, then the pen thicknesses and the pages; Export, the due date, Cancel and Finish are at the far right. */}
        {kind === "image" && (
          <>
          <button
            type="button"
            className={erasing ? "icon-button primary lf-eraser" : "icon-button lf-eraser"}
            aria-label="Eraser"
            aria-pressed={erasing}
            title={erasing ? "Eraser on: tap to draw again" : "Eraser"}
            disabled={busy || !detailsEditable}
            onClick={onEraserClick}
          >
            <FontAwesomeIcon icon={faEraser} />
          </button>
          {/*
           * One button (a scribble, or a highlighter while that's in use) that opens the pen menu above it:
           * the pen thicknesses, then the pen colour, black, and the highlighter.
           */}
          <div className="lf-pen-menu" ref={penMenuRef}>
            <button
              ref={penMenuButton}
              type="button"
              className={highlighting ? "icon-button lf-highlighting" : "icon-button"}
              style={highlighting ? { background: highlighterColour } : undefined}
              aria-label="Pen thickness"
              title={highlighting ? "Highlighter" : `Pen thickness: ${penWidth}px`}
              aria-haspopup="menu"
              aria-expanded={penMenu !== undefined}
              disabled={busy || !detailsEditable}
              onClick={togglePenMenu}
            >
              {highlighting ? (
                <FontAwesomeIcon icon={faHighlighter} />
              ) : (
                <ScribbleIcon colour={penColour === BLACK_PEN ? undefined : penColour} />
              )}
            </button>
            {penMenu && (
              <div className="tag-dropdown-list lf-pen-menu-list" role="menu" aria-label="Pen thickness" style={penMenu}>
                {PEN_WIDTHS.map((width) => (
                  <button
                    key={width}
                    type="button"
                    role="menuitemradio"
                    aria-checked={!highlighting && penWidth === width}
                    aria-label={`Pen thickness ${width}px`}
                    className={penWidth === width ? "tag-option chosen" : "tag-option"}
                    onClick={(event) => onPenWidthClick(event, width)}
                  >
                    <span className="lf-pen-check" aria-hidden>
                      {!highlighting && penWidth === width && <FontAwesomeIcon icon={faCheck} />}
                    </span>
                    <span className="lf-pen-sample" style={{ height: width }} />
                    <span className="lf-pen-size">{width}px</span>
                  </button>
                ))}
                <div className="lf-pen-menu-divider" role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  className="tag-option"
                  onClick={menuAction(() => {
                    setPenMenu(undefined);
                    setChoosingPenColour(true);
                  })}
                >
                  <span className="lf-pen-check" aria-hidden />
                  <span className="lf-pen-swatch" style={{ background: penColour }} aria-hidden />
                  Pen colour…
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="tag-option"
                  disabled={!highlighting && penColour === BLACK_PEN}
                  onClick={menuAction(() => choosePenColour(BLACK_PEN))}
                >
                  <span className="lf-pen-check" aria-hidden />
                  <span className="lf-pen-swatch" style={{ background: BLACK_PEN }} aria-hidden />
                  Black pen
                </button>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={highlighting}
                  className="tag-option"
                  onClick={menuAction(() => {
                    setPenMenu(undefined);
                    setChoosingHighlighter(true);
                  })}
                >
                  <span className="lf-pen-check" aria-hidden>
                    {highlighting && <FontAwesomeIcon icon={faCheck} />}
                  </span>
                  <span className="lf-pen-swatch light" style={{ background: highlighterColour }} aria-hidden />
                  Highlighter…
                </button>
              </div>
            )}
          </div>
          <div className="lf-pages" role="group" aria-label="Pages">
            <span className="lf-page-count" title={`Page ${pageIndex + 1} of ${pages.length}`}>
              {pageIndex + 1}/{pages.length}
            </span>
            {/* Hidden when the row is too narrow for them; they're in the menu too. */}
            <button
              type="button"
              className="icon-button lf-page-step"
              aria-label="Previous page"
              title="Previous page"
              disabled={busy || !detailsEditable || pageIndex === 0}
              onClick={onPreviousPage}
            >
              <FontAwesomeIcon icon={faChevronLeft} />
            </button>
            <button
              type="button"
              className="icon-button lf-page-step"
              aria-label="Next page"
              title={atPageLimit && pageIndex === pages.length - 1 ? PAGE_LIMIT_HINT : "Next page"}
              disabled={busy || !detailsEditable || (atPageLimit && pageIndex === pages.length - 1)}
              onClick={onNextPage}
            >
              <FontAwesomeIcon icon={faChevronRight} />
            </button>
            <div className="lf-page-menu" ref={pageMenuRef}>
              <button
                ref={pageMenuButton}
                type="button"
                className="icon-button"
                aria-label="Page options"
                title="Page options"
                aria-haspopup="menu"
                aria-expanded={pageMenu !== undefined}
                disabled={busy || !detailsEditable}
                onClick={togglePageMenu}
              >
                <FontAwesomeIcon icon={faCopy} />
              </button>
              {pageMenu && (
                <div className="tag-dropdown-list lf-page-menu-list" role="menu" aria-label="Page options" style={pageMenu}>
                  <button type="button" role="menuitem" className="tag-option" disabled={pageIndex === 0} onClick={menuAction(() => goToPage(pageIndex - 1))}>
                    Previous page
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="tag-option"
                    disabled={atPageLimit && pageIndex === pages.length - 1}
                    title={atPageLimit && pageIndex === pages.length - 1 ? PAGE_LIMIT_HINT : undefined}
                    onClick={onNextPage}
                  >
                    Next page
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="tag-option"
                    disabled={atPageLimit}
                    title={atPageLimit ? PAGE_LIMIT_HINT : undefined}
                    onClick={menuAction(addPage)}
                  >
                    Add page after this one
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="tag-option"
                    disabled={pages.length <= 1}
                    title={pages.length <= 1 ? "A note always has at least one page" : undefined}
                    onClick={menuAction(() => {
                      setPageMenu(undefined);
                      setConfirmingDeletePage(true);
                    })}
                  >
                    Delete this page
                  </button>
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            className="icon-button lf-export"
            aria-label="Export as image"
            title="Export as image"
            disabled={busy || !detailsEditable || !padHasInk}
            onClick={onExportClick}
          >
            <FontAwesomeIcon icon={faShareFromSquare} />
          </button>
          </>
        )}
        {/* The note's due date: after Export (or in its place, for typed details). Only its owner sets it. */}
        {!note?.shared && (
          <button
            type="button"
            className={dueDate ? "icon-button primary lf-due" : "icon-button lf-due"}
            aria-label={dueDate ? "Change the long-form note's due date" : "Set the long-form note's due date"}
            title={noteId === undefined ? "Accept the title first" : dueDate ? dueTitle(dueDate) : "Set due date"}
            disabled={busy || noteId === undefined}
            onClick={() => setChoosingDueDate(true)}
          >
            <FontAwesomeIcon icon={faAlarmClock} />
          </button>
        )}
        <div className="lf-finish-end">
        {isNew && (
          <button
            type="button"
            className="icon-button"
            aria-label="Cancel"
            // A note already on the server (positive id) can't be deleted offline.
            disabled={busy || (offline && noteId !== undefined && noteId > 0)}
            title={offline && noteId !== undefined && noteId > 0 ? "Not available offline" : "Cancel"}
            onClick={onCancelClick}
          >
            <FontAwesomeIcon icon={faX} />
          </button>
        )}
        <button
          type="button"
          className="icon-button primary"
          aria-label="Finish"
          disabled={busy}
          title={stylusMode ? "Finish" : "Finish (Ctrl+Enter)"}
          onClick={onFinishClick}
        >
          <FontAwesomeIcon icon={faCircleCheck} />
        </button>
        </div>
      </div>

      {choosingDueDate && (
        <DueDateDialog due={dueDate} onSet={changeDueDate} onCancel={() => setChoosingDueDate(false)} />
      )}
      {choosingParent && (
        <ParentDialog
          notes={notes}
          categories={categories}
          noteOrder={noteOrder}
          parentId={parentId}
          childId={noteId}
          owner={note?.shared ? { id: note.shared.ownerId, name: note.shared.ownerName } : sharedTagsOwner(categories, selection)}
          onSet={changeParent}
          onCancel={() => setChoosingParent(false)}
        />
      )}
      {choosingPenColour && (
        <PenColourDialog
          colour={penColour}
          onChoose={(colour, event) => {
            if (!ignoredTap(stylusMode, event)) choosePenColour(colour);
          }}
          onCancel={() => setChoosingPenColour(false)}
        />
      )}
      {choosingHighlighter && (
        <PenColourDialog
          title="Highlighter colour"
          colours={HIGHLIGHTER_COLOURS}
          light
          colour={highlighting ? highlighterColour : undefined}
          onChoose={(colour, event) => {
            if (!ignoredTap(stylusMode, event)) chooseHighlighter(colour);
          }}
          onCancel={() => setChoosingHighlighter(false)}
        />
      )}
      {confirmingAddPage && (
        <ConfirmDialog
          message="This is the last page. Add a new page?"
          confirmLabel="Yes"
          cancelLabel="No"
          danger={false}
          onConfirm={addPage}
          onCancel={() => setConfirmingAddPage(false)}
        />
      )}
      {confirmingDeletePage && (
        <ConfirmDialog
          message="Delete this page?"
          confirmLabel="Yes"
          cancelLabel="No"
          onConfirm={deletePage}
          onCancel={() => setConfirmingDeletePage(false)}
        />
      )}
      {confirmingCancel && (
        <ConfirmDialog
          message="Are you sure you want to delete this note?"
          confirmLabel="Yes"
          cancelLabel="No"
          onConfirm={() => void cancel()}
          onCancel={() => setConfirmingCancel(false)}
        />
      )}
      {conflict && (
        <ConfirmDialog
          message={`${NOTE_CHANGED_ELSEWHERE} Keep your version (replacing that change), or discard your changes and see that version?`}
          confirmLabel="Discard mine"
          cancelLabel="Keep mine"
          onConfirm={discardMine}
          onCancel={keepMine}
        />
      )}
    </div>
  );
}

/** Whose notebook a note with these tags is in: the owner of a tag shared with you, if it has one; otherwise yours (undefined). */
function sharedTagsOwner(categories: Category[], selection: TagSelection): { id: number; name: string } | undefined {
  const tagIds = selectedTagIds(categories, selection);
  const tag = categories.find((category) => category.shared)?.tags.find((t) => tagIds.includes(t.id));
  return tag?.ownerId !== undefined ? { id: tag.ownerId, name: tag.ownerName ?? "its owner" } : undefined;
}

/** A data URL's contents, as a Blob. */
function dataUrlToBlob(dataUrl: string): Blob {
  const [header, data] = dataUrl.split(",", 2) as [string, string];
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: header.slice(5).split(";")[0] });
}

/** An exported image's file name: the note's title and today's date, e.g. "Garden plan 2026-11-19.png". */
function exportFileName(title: string, now = new Date()): string {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  // Characters that file names can't have (on Windows, the strictest), and control characters.
  const safe = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 80).trim();
  return `${safe ? `${safe} ` : ""}${date}.png`;
}

/** While a menu is open, it closes on a click outside `ref`, on Escape, or when the window is resized. */
function useCloseOnOutside(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const onClose = () => closeRef.current();
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onClose);
    };
  }, [open, ref]);
}

/**
 * A scribble (like Font Awesome Pro's fa-scribble, which the free icons don't have): one rounded line
 * with two loops, rising from the bottom left and ending at the right. Sized like a Font Awesome icon;
 * drawn in the pen colour when it isn't black (black follows the text colour, for dark mode).
 */
function ScribbleIcon({ colour = "currentColor" }: { colour?: string }) {
  return (
    <svg className="svg-inline--fa" viewBox="0 0 512 512" aria-hidden focusable="false">
      <path
        fill="none"
        stroke={colour}
        strokeWidth={44}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M40 400C110 360 190 250 190 150C190 70 110 90 120 190C130 300 230 380 300 300C350 240 340 150 290 170C240 190 280 330 360 360C420 380 450 330 472 300"
      />
    </svg>
  );
}
