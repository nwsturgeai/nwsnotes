import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faCircleCheck, faEraser, faPen, faShareFromSquare, faTags, faX } from "@fortawesome/free-solid-svg-icons";
import {
  DETAILS_TEXT_MAX_LENGTH,
  NOTE_CHANGED_ELSEWHERE,
  TITLE_MAX_LENGTH,
  validateTitle,
  type Category,
  type Note,
  type NoteDetails,
} from "@nwsnotes/shared";
import { ApiError } from "./api";
import { isWaiting, offlineApi } from "./offline";
import { ConfirmDialog } from "./ConfirmDialog";
import { ParentDialog, ParentPill } from "./ParentDialog";
import { possibleParents } from "./parents";
import { FormattedText } from "./FormattedText";
import { StylusPad, type StylusPadHandle } from "./StylusPad";
import { PEN_WIDTHS, usePenWidth } from "./stylusMode";
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
  /** Typed or handwritten details: fixed for an existing note; for a new one, from stylus mode now. */
  const [kind] = useState<"text" | "image">(() =>
    note ? (note.detailsImage !== undefined ? "image" : "text") : stylusMode ? "image" : "text",
  );
  const [detailsText, setDetailsText] = useState(note?.detailsText ?? "");
  const padRef = useRef<StylusPadHandle>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const detailsRef = useRef<HTMLTextAreaElement>(null);
  /** The formatted copy of the typed details, under the text box; it scrolls with it. */
  const displayRef = useRef<HTMLDivElement>(null);
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
  /** Whether the details canvas has any ink, for the export button. */
  const [padHasInk, setPadHasInk] = useState(false);

  // The latest values, for saves that run from a timer.
  const latest = useRef({ selection, detailsText, parentId });
  latest.current = { selection, detailsText, parentId };
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

  function currentDetails(): NoteDetails {
    if (kind === "text") return { detailsText: latest.current.detailsText };
    const pad = padRef.current;
    return { detailsImage: pad?.hasInk() ? pad.toImage() : "" };
  }

  /** The note as it is now. An update says the parent either way (null for none); a new note only has one if chosen. */
  function request(titleText: string, update = true) {
    const parent = latest.current.parentId;
    return {
      titleText,
      tagIds: selectedTagIds(categories, latest.current.selection),
      ...currentDetails(),
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

  /** A details or tag change: save it once the 30-second window ends. */
  function schedule() {
    dirty.current = true;
    if (conflictRef.current) return;
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
    // The note changed elsewhere: the editor stays open until the user chooses which version to keep.
    if (conflictRef.current) {
      finishAfterConflict.current = true;
      setBusy(false);
      return;
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
        return;
      }
    }
    onFinish();
  }

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
    if (stylusMode && (event.nativeEvent as Partial<PointerEvent>).pointerType === "touch") return;
    setErasing(!erasing);
  }

  /** A pen-thickness button: chooses it (for every canvas on this device) and turns the eraser off. */
  function onPenWidthClick(event: ReactMouseEvent, width: number) {
    if (stylusMode && (event.nativeEvent as Partial<PointerEvent>).pointerType === "touch") return;
    setPenWidth(width);
    setErasing(false);
  }

  /**
   * Exports the handwritten details as a PNG (black on white, cropped to the ink): through the device's
   * share sheet where the browser can share files (Android), otherwise as a download.
   */
  function onExportClick(event: ReactMouseEvent) {
    if (stylusMode && (event.nativeEvent as Partial<PointerEvent>).pointerType === "touch") return;
    const pad = padRef.current;
    if (!pad?.hasInk()) return;
    const dataUrl = pad.toImage("#fff");
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
          // Two exactly overlapping layers: the formatted text underneath, and the real text box on top
          // with invisible text, so typing, the cursor and selection work as usual. Every letter is the
          // same width in both (see .lf-text in styles.css), so the cursor lines up with what's shown.
          <div className="lf-text">
            <div className="lf-text-display" ref={displayRef} aria-hidden>
              <FormattedText text={detailsText} showMarkers />
              {/* A last empty line still takes its height, as it does in the text box. */}
              {detailsText.endsWith("\n") && " "}
            </div>
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
              onScroll={(event) => {
                if (displayRef.current) displayRef.current.scrollTop = event.currentTarget.scrollTop;
              }}
            />
          </div>
        ) : (
          <StylusPad
            ref={padRef}
            fill
            label="Details of the long-form note"
            disabled={!detailsEditable}
            erasing={erasing}
            initialImage={note?.detailsImage || undefined}
            onInk={schedule}
            onInkChange={setPadHasInk}
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
        {/* At the far left, then the pen thicknesses; Export, Cancel and Finish are at the far right. */}
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
          <div className="lf-pen-widths" role="radiogroup" aria-label="Pen thickness">
            {PEN_WIDTHS.map((width) => (
              <button
                key={width}
                type="button"
                role="radio"
                aria-checked={penWidth === width}
                aria-label={`Pen thickness ${width}px`}
                title={`Pen thickness ${width}px`}
                className={penWidth === width ? "icon-button primary" : "icon-button"}
                disabled={busy || !detailsEditable}
                onClick={(event) => onPenWidthClick(event, width)}
              >
                <span className="lf-pen-sample" style={{ height: width }} />
                <span className="lf-pen-size">{width}px</span>
              </button>
            ))}
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

      {choosingParent && (
        <ParentDialog
          notes={notes}
          noteOrder={noteOrder}
          parentId={parentId}
          childId={noteId}
          owner={note?.shared ? { id: note.shared.ownerId, name: note.shared.ownerName } : sharedTagsOwner(categories, selection)}
          onSet={changeParent}
          onCancel={() => setChoosingParent(false)}
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
