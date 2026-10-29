import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faEraser, faPen, faRectangleList } from "@fortawesome/free-solid-svg-icons";
import {
  DETAILS_TEXT_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  validateTitle,
  type Category,
  type Note,
  type NoteDetails,
} from "@nwsnotes/shared";
import { ApiError } from "./api";
import { offlineApi } from "./offline";
import { ConfirmDialog } from "./ConfirmDialog";
import { StylusPad, type StylusPadHandle } from "./StylusPad";
import { selectedTagIds, TagPickers, type TagSelection } from "./TagPickers";

/** Details and tag changes are sent at most this often (and once this long after the first change). */
const SAVE_DELAY_MS = 30_000;

interface Props {
  /** The long-form note being edited, or undefined when creating a new one. */
  note: Note | undefined;
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
}

/** The note's tags as dropdown selections. */
function selectionFor(note: Note | undefined, categories: Category[]): TagSelection {
  if (!note) return {};
  return Object.fromEntries(
    categories.map((category) => [category.id, category.tags.filter((tag) => note.tagIds.includes(tag.id)).map((tag) => tag.id)]),
  );
}

/**
 * Creating or editing a long-form note: a title, tags, and details (typed, or handwritten in stylus
 * mode). The title and the details are never editable at the same time: accepting the title (which
 * creates the note the first time) unlocks the details; "edit title" locks them again. Details and tag
 * changes are saved at most every 30 seconds, and straight away on Finish or when the app is hidden.
 */
export function LongFormEditor({
  note,
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
}: Props) {
  const [noteId, setNoteId] = useState(note?.id);
  const [title, setTitle] = useState(note?.titleText ?? "");
  /** The title as last saved; updates of the details are sent with it. */
  const savedTitle = useRef(note?.titleText ?? "");
  const [titleLocked, setTitleLocked] = useState(note !== undefined);
  const [selection, setSelection] = useState<TagSelection>(() => selectionFor(note, categories));
  /** Typed or handwritten details: fixed for an existing note; for a new one, from stylus mode now. */
  const [kind] = useState<"text" | "image">(() =>
    note ? (note.detailsImage !== undefined ? "image" : "text") : stylusMode ? "image" : "text",
  );
  const [detailsText, setDetailsText] = useState(note?.detailsText ?? "");
  const padRef = useRef<StylusPadHandle>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const detailsRef = useRef<HTMLTextAreaElement>(null);
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

  // The latest values, for saves that run from a timer.
  const latest = useRef({ selection, detailsText });
  latest.current = { selection, detailsText };
  const dirty = useRef(false);
  const timer = useRef<number>(undefined);
  const saving = useRef<Promise<void>>(Promise.resolve());

  const detailsEditable = titleLocked && noteId !== undefined;

  function currentDetails(): NoteDetails {
    if (kind === "text") return { detailsText: latest.current.detailsText };
    const pad = padRef.current;
    return { detailsImage: pad?.hasInk() ? pad.toImage() : "" };
  }

  function request(titleText: string) {
    return { titleText, tagIds: selectedTagIds(categories, latest.current.selection), ...currentDetails() };
  }

  function failed(err: unknown, what: string) {
    if (err instanceof ApiError && err.isUnauthorized) {
      onSessionExpired();
      return;
    }
    setError(`${what}: ${err instanceof Error ? err.message : String(err)}`);
  }

  /** Sends any pending details or tag change now. Saves run one at a time. */
  function flush(): Promise<void> {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    saving.current = saving.current.then(async () => {
      if (!dirty.current || noteId === undefined) return;
      dirty.current = false;
      try {
        onSaved(await offlineApi.updateNote(noteId, request(savedTitle.current)), false);
        setError(undefined);
      } catch (err) {
        // Try again at the next window.
        dirty.current = true;
        schedule();
        failed(err, "The note wasn't saved; trying again shortly");
      }
    });
    return saving.current;
  }

  /** A details or tag change: save it once the 30-second window ends. */
  function schedule() {
    dirty.current = true;
    if (timer.current === undefined) timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
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
        const created = await offlineApi.addNote(request(check.title));
        setNoteId(created.id);
        onSaved(created, true);
      } else {
        await saving.current;
        dirty.current = false;
        onSaved(await offlineApi.updateNote(noteId, request(check.title)), false);
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
    if (stylusMode && (event.nativeEvent as Partial<PointerEvent>).pointerType === "touch") return;
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

  async function finish() {
    setBusy(true);
    await flush();
    // A changed title that hasn't been accepted yet is saved too, rather than lost.
    const check = validateTitle(title);
    if (!titleLocked && noteId !== undefined && check.ok && check.title !== savedTitle.current) {
      try {
        onSaved(await offlineApi.updateNote(noteId, request(check.title)), false);
      } catch (err) {
        failed(err, "The title wasn't saved");
        setBusy(false);
        return;
      }
    }
    onFinish();
  }

  /** In stylus mode, finger and palm taps on the eraser button are ignored, like Finish. */
  function onEraserClick(event: ReactMouseEvent) {
    if (stylusMode && (event.nativeEvent as Partial<PointerEvent>).pointerType === "touch") return;
    setErasing(!erasing);
  }

  /** Cancel (new notes only): straight away if there are no details, otherwise after asking. */
  function onCancelClick(event: ReactMouseEvent) {
    if (stylusMode && (event.nativeEvent as Partial<PointerEvent>).pointerType === "touch") return;
    const empty = kind === "text" ? latest.current.detailsText.trim() === "" : !padRef.current?.hasInk();
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
        <TagPickers categories={categories} selection={selection} onChange={changeTags} disabled={busy} />
        {/* At the far right: choose the tags the selected tab fixes. */}
        <button
          type="button"
          className="note-button"
          aria-label={matchHint}
          title={matchHint}
          disabled={busy || tabTags.size === 0}
          onClick={matchTab}
        >
          <FontAwesomeIcon icon={faRectangleList} />
        </button>
      </div>

      <div className={detailsEditable ? "lf-details" : "lf-details locked"}>
        {kind === "text" ? (
          <textarea
            ref={detailsRef}
            aria-label="Details"
            placeholder={detailsEditable ? "Details" : "Accept the title to write the details"}
            value={detailsText}
            maxLength={DETAILS_TEXT_MAX_LENGTH}
            disabled={!detailsEditable}
            onChange={(event) => {
              setDetailsText(event.target.value);
              latest.current.detailsText = event.target.value;
              schedule();
            }}
          />
        ) : (
          <StylusPad
            ref={padRef}
            fill
            label="Details of the long-form note"
            disabled={!detailsEditable}
            erasing={erasing}
            initialImage={note?.detailsImage || undefined}
            onInk={schedule}
          />
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
        {/* At the far left; Cancel and Finish stay centred. Colours inverted while selected. */}
        {kind === "image" && (
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
        )}
        {isNew && (
          <button
            type="button"
            className="button"
            // A note already on the server (positive id) can't be deleted offline.
            disabled={busy || (offline && noteId !== undefined && noteId > 0)}
            title={offline && noteId !== undefined && noteId > 0 ? "Not available offline" : undefined}
            onClick={onCancelClick}
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          className="button"
          disabled={busy}
          title={stylusMode ? undefined : "Finish (Ctrl+Enter)"}
          onClick={onFinishClick}
        >
          Finish
        </button>
      </div>

      {confirmingCancel && (
        <ConfirmDialog
          message="Are you sure you want to delete this note?"
          confirmLabel="Yes"
          cancelLabel="No"
          onConfirm={() => void cancel()}
          onCancel={() => setConfirmingCancel(false)}
        />
      )}
    </div>
  );
}
