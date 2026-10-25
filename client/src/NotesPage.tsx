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
import {
  faBoxArchive,
  faChartDiagram,
  faChevronDown,
  faChevronUp,
  faCircleCheck,
  faCirclePlus,
  faDeleteLeft,
  faHourglass,
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
  validateTitle,
  validateTitleImage,
  type Category,
  type LifetimeChange,
  type Note,
  type NoteTitle,
  type Tab,
} from "@nwsnotes/shared";
import { ApiError, api } from "./api";
import { useExtraFilters } from "./extraFilters";
import { LongFormEditor } from "./LongFormEditor";
import { useFullTagList } from "./stylusMode";

const LONG_FORM_TITLE_FIRST = "Set the long-form note's title first";
import { INK_SCALE, StylusPad, type StylusPadHandle } from "./StylusPad";
import {
  constraintsFor,
  missingRequiredCategory,
  selectedTagIds,
  selectionToFilters,
  TagPickers,
  TagPillPicker,
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
  onSessionExpired: () => void;
}

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
  const [longForm, setLongForm] = useState<{ note: Note | undefined; key: number }>();
  /** The open long-form note's id, once its title has been accepted; new notes become its children. */
  const [longFormId, setLongFormId] = useState<number>();
  /** Before a new long-form note's title is first accepted, regular notes can't be added. */
  const addBlocked = longForm !== undefined && longFormId === undefined;

  function openLongForm(note: Note | undefined) {
    setLongForm({ note, key: Date.now() });
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

  /** The canvas is shown in stylus mode, and when editing a handwritten note whatever the mode. */
  const showCanvas = editingNote ? editingNote.titleImage !== undefined : stylusMode;
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
  const extraCategories = useMemo(
    () => categories.filter((category) => !tabFilters.some((filter) => filter.categoryId === category.id)),
    [categories, tabFilters],
  );
  const allFilters = useMemo(
    () => [...tabFilters, ...selectionToFilters(extraCategories, extraSelection)],
    [tabFilters, extraCategories, extraSelection],
  );

  // Hidden notes aren't changed, just not listed. Bin notes are hidden unless a filter ticks Bin.
  const visibleNotes = useMemo(() => notes.filter((note) => noteMatchesFilters(note, allFilters)), [notes, allFilters]);
  /** What the filters require of new notes, so they always match and stay visible. */
  const constraints = useMemo(() => constraintsFor(allFilters), [allFilters]);

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

  /** Archive, reinstate or bin a note. If it no longer matches the filters, it leaves the list. */
  async function changeLifetime(note: Note, lifetime: LifetimeChange) {
    if (busyNoteId !== undefined) return;
    setBusyNoteId(note.id);
    try {
      onNoteUpdated(await api.setLifetime(note.id, lifetime));
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
        onNoteUpdated(await api.updateNote(editingNote.id, { ...noteTitle, tagIds }));
        finishEdit();
      } else {
        // The dropdowns keep their selections, so the next note gets the same tags unless they're changed.
        const tagIds = selectedTagIds(userCategories, tagSelection, constraints);
        // While a long-form note is open, new notes are its children.
        const note = await api.addNote({ ...noteTitle, tagIds, ...(longFormId !== undefined && { parentId: longFormId }) });
        onNoteAdded(note);
        if (showCanvas) padRef.current?.clear();
        else setTitle("");
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

  return (
    <div className={fullTagList ? "notes-page full-tag-list" : "notes-page"}>
      {extraCategories.length > 0 && (
        <div className="filter-row" aria-label="More filters for this tab">
          <TagPickers
            categories={extraCategories}
            selection={extraSelection}
            onChange={setExtraSelection}
            disabled={blocked}
            checkLists
          />
          <IconButton
            icon={faReplyAll}
            label={blocked ? "Finish or cancel the edit first" : "Reset filters"}
            disabled={blocked}
            onClick={() => setExtraSelection({})}
          />
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
            {visibleNotes.map((note) => {
              const lifetime = lifetimeOf(note);
              const classes = [
                note.id === editingNote?.id && "editing",
                lifetime === LIFETIME_WAITING && "waiting",
                lifetime === LIFETIME_ARCHIVED && "archived",
                lifetime === LIFETIME_BIN && "binned",
              ].filter(Boolean);
              const busy = blocked || busyNoteId !== undefined;
              const hint = blocked ? "Finish or cancel the current edit first" : undefined;
              return (
                <li key={note.id} className={classes.join(" ") || undefined}>
                  <div className="note-body">
                    {note.titleImage !== undefined ? <HandwrittenTitle image={note.titleImage} /> : note.titleText}
                    <TagPills tagIds={note.tagIds} categories={categories} extra={specialPills(note)} />
                  </div>
                  {/* Right-aligned; they don't need to line up between notes. */}
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
                </li>
              );
            })}
          </ul>
        )}
      </div>

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
          onFinish={() => {
            setLongForm(undefined);
            setLongFormId(undefined);
          }}
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
          // Not while a long-form note is open, so the editor's space doesn't change under it.
          disabled={longForm !== undefined}
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
            {showCanvas ? (
              <StylusPad
                // A fresh pad for each note edited (loaded with its image), and an empty one for new notes.
                key={editingNote ? `edit-${editingNote.id}` : "new"}
                ref={padRef}
                disabled={saving || addBlocked}
                initialImage={editingNote?.titleImage}
                onInk={() => setSaveError(undefined)}
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
                disabled={saving || addBlocked}
                onChange={(event) => setTitle(event.target.value)}
              />
            )}
            {/* Icon-only buttons; Clear sits under Add, leaving more width for handwriting. */}
            <div className="new-note-buttons">
              <button
                type="submit"
                className="icon-button primary"
                aria-label={editingNote ? "Update" : "Add"}
                title={editingNote ? "Update" : addBlocked ? LONG_FORM_TITLE_FIRST : "Add"}
                disabled={saving || addBlocked}
              >
                <FontAwesomeIcon icon={editingNote ? faCircleCheck : faCirclePlus} />
              </button>
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
                    setSaveError(undefined);
                  }}
                >
                  <FontAwesomeIcon icon={faDeleteLeft} />
                </button>
              )}
              {/* In the expanded (250px) area: start a long-form note. */}
              {fullTagList && !editingNote && !longForm && (
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
            </div>
          </div>
          {addBlocked && <p className="lf-add-hint">{LONG_FORM_TITLE_FIRST}</p>}
          {saveError && (
            <p className="save-error" role="alert">
              {saveError}
            </p>
          )}
          {/* Dropdowns, or every tag as a pill in full-tag-list mode. Both share the same choices. */}
          {editingNote ? (
            <TagChooser
              categories={userCategories}
              selection={editSelection}
              onChange={setEditSelection}
              disabled={saving}
            />
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
