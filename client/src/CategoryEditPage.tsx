import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowDown, faArrowUp, faRightFromBracket, faShareNodes, faTrashCan } from "@fortawesome/free-solid-svg-icons";
import {
  NAME_MAX_LENGTH,
  TAGS_PER_CATEGORY_MAX,
  tagLabel,
  validateCategory,
  validateTab,
  type Category,
  type CategoryRequest,
  type Note,
  type Tab,
  type Tag,
} from "@nwsnotes/shared";
import { ApiError, api } from "./api";
import { hueColour } from "./colours";
import { ConfirmDialog } from "./ConfirmDialog";
import { HuePicker } from "./HuePicker";
import { DragGrip, draggedStyle, rowsWithGap, useListDrag } from "./listDrag";
import { ShareDialog } from "./ShareDialog";
import { SettingsSharingIcon } from "./sharingIcons";

interface Props {
  /** "new" to add a category. */
  id: number | "new";
  categories: Category[];
  /** All notes, to say how many a deleted tag is removed from. */
  notes: Note[];
  /** The tabs, to offer a tab for each tag of a single-select category that no tab uses. */
  tabs: Tab[];
  /** A tab made here with "Create Tab for this Tag" (saved straight away, without saving the category). */
  onTabSaved: (tab: Tab) => void;
  onSaved: (category: Category) => void;
  /** Returns to the settings page (after saving or cancelling). */
  onClose: () => void;
  onSessionExpired: () => void;
}

/** One tag text box. `id` is set for tags that are already saved. */
interface TagRow {
  key: number;
  id?: number;
  name: string;
  /** The tag's colour (degrees), if it has one. */
  hue?: number;
  /** In "Shared with me": the tag as shared (its name can't be changed there). */
  shared?: Tag;
}

/** Adding and editing a category share this page. */
export function CategoryEditPage(props: Props) {
  const existing = props.id === "new" ? undefined : props.categories.find((c) => c.id === props.id);
  if (props.id !== "new" && !existing) {
    return (
      <main className="settings-page">
        <h1>Category not found</h1>
        <p>There is no category with id {props.id}.</p>
        <button type="button" className="button" onClick={props.onClose}>
          Back to settings
        </button>
      </main>
    );
  }
  // Keyed so that switching between categories starts a fresh form.
  return <CategoryForm key={String(props.id)} {...props} existing={existing} />;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function CategoryForm({
  categories,
  notes,
  tabs,
  onTabSaved,
  existing,
  onSaved,
  onClose,
  onSessionExpired,
}: Props & { existing: Category | undefined }) {
  // The form starts from the saved category and isn't changed by live updates while open.
  const nextKey = useRef(0);
  /** "Shared with me": only the order and colours of its tags can be changed, and they're yours alone. */
  const sharedLayout = existing?.shared === true;
  const newRow = (tag?: Tag): TagRow => ({
    key: nextKey.current++,
    ...(tag && { id: tag.id, name: tag.name, ...(tag.hue !== undefined && { hue: tag.hue }) }),
    ...(tag?.ownerName !== undefined && { shared: tag }),
    name: tag?.name ?? "",
  });
  const [name, setName] = useState(existing?.name ?? "");
  const [multiSelect, setMultiSelect] = useState(existing?.multiSelect ?? false);
  const [rows, setRows] = useState<TagRow[]>(() => (existing ? existing.tags.map((tag) => newRow(tag)) : [newRow()]));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  /** Asking before saving, when deleted tags are on notes or a change to single-select trims notes' tags. */
  const [confirming, setConfirming] = useState<{ message: string; confirmLabel: string; request: CategoryRequest; tabRowKey?: number }>();
  const focusKey = useRef<number>(undefined);
  /** The tag row whose colour is being chosen. */
  const [pickingHueFor, setPickingHueFor] = useState<TagRow>();
  /** The saved tag whose sharing is being changed. */
  const [sharing, setSharing] = useState<{ id: number; name: string }>();
  /** "Shared with me": the tag you're asked to confirm you want to stop viewing, and whether that's being sent. */
  const [leaving, setLeaving] = useState<Tag>();
  const [leavingBusy, setLeavingBusy] = useState(false);

  /** "Create Tab for this Tag": the tag row whose tab is being made, and what happened (by row key). */
  const [makingTabFor, setMakingTabFor] = useState<number>();
  const [tabResults, setTabResults] = useState<Map<number, { made: boolean; message: string }>>(new Map());
  const setTabResult = (key: number, outcome: { made: boolean; message: string }) =>
    setTabResults((current) => new Map(current).set(key, outcome));

  /**
   * While editing a single-select category, each tag that no tab's filters use (a new one included) gets
   * "Create Tab for this Tag" under its name. Clicking it saves the category as it is, then makes the tab.
   */
  function offersTab(row: TagRow): boolean {
    if (!existing || existing.system || sharedLayout || multiSelect || row.shared || row.name.trim() === "") return false;
    return row.id === undefined || !tabs.some((tab) => tab.categories.some((filter) => filter.tagIds.includes(row.id!)));
  }

  function createTabFor(row: TagRow) {
    if (!existing || saving) return;
    // The tab's name is checked first, so the category isn't saved for a tab that can't be made. (The tag may be
    // new, with no id until the category is saved, so one of its saved tags stands in for it in the filter.)
    const standIn = existing.tags[0];
    if (standIn) {
      const check = validateTab({ name: row.name.trim(), categories: [{ categoryId: existing.id, tagIds: [standIn.id] }] }, tabs, categories);
      if (!check.ok) {
        setTabResult(row.key, { made: false, message: `The tab wasn't made: ${check.error}` });
        return;
      }
    }
    submit(row.key);
  }

  /** After the category is saved: makes a tab named after the tag, showing only notes with that tag. */
  async function makeTab(rowKey: number, category: Category, tag: Tag) {
    setMakingTabFor(rowKey);
    try {
      const tab = await api.addTab({ name: tag.name, categories: [{ categoryId: category.id, tagIds: [tag.id] }] });
      onTabSaved(tab);
      setTabResult(rowKey, { made: true, message: `Saved the category and made the tab "${tab.name}".` });
    } catch (err) {
      if (err instanceof ApiError && err.isUnauthorized) {
        onSessionExpired();
        return;
      }
      setTabResult(rowKey, { made: false, message: `The category was saved, but the tab wasn't made: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setMakingTabFor(undefined);
    }
  }

  function setRowHue(key: number, hue: number | undefined) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, hue } : row)));
  }

  function setRowName(key: number, value: string) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, name: value } : row)));
    // Why a tab couldn't be made was about the name as it was.
    setTabResults((current) => {
      if (current.get(key)?.made !== false) return current;
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  }

  /** A category has room for at most TAGS_PER_CATEGORY_MAX tag rows. */
  const tagsFull = rows.length >= TAGS_PER_CATEGORY_MAX;

  function addRow() {
    if (tagsFull) return;
    const row = newRow();
    focusKey.current = row.key;
    setRows((current) => [...current, row]);
  }

  /** Deletes a tag row. A saved tag is only deleted (and removed from notes) when the category is saved. */
  function deleteRow(key: number) {
    setRows((current) => current.filter((row) => row.key !== key));
  }

  /** The arrow to focus after a move, so pressing it again keeps moving the same tag. */
  const focusArrow = useRef<{ key: number; direction: "up" | "down" }>(undefined);

  /** Dragging tag rows by their grips: a drop rearranges the list, which is saved with the category. */
  const tagListRef = useRef<HTMLDivElement>(null);
  const { drag: tagDrag, gripHandlers: tagGrip } = useListDrag(tagListRef, (key, target) =>
    setRows((current) => {
      const moving = current.find((row) => row.key === key);
      if (!moving) return current;
      const others = current.filter((row) => row.key !== key);
      return [...others.slice(0, target), moving, ...others.slice(target)];
    }),
  );

  /** Moves a tag row up (-1) or down (+1); the new order is saved with the category. */
  function moveRow(key: number, by: -1 | 1) {
    setRows((current) => {
      const from = current.findIndex((row) => row.key === key);
      const to = from + by;
      const moving = current[from];
      const other = current[to];
      if (!moving || !other) return current;
      const next = [...current];
      next[from] = other;
      next[to] = moving;
      // At the top or bottom that arrow is greyed out, so the other one takes the focus.
      const edge = by < 0 ? to === 0 : to === next.length - 1;
      focusArrow.current = { key, direction: (by < 0) !== edge ? "up" : "down" };
      return next;
    });
  }

  /** Ref for a row's arrow button: focuses it if it's the one to focus after a move. */
  function arrowRef(key: number, direction: "up" | "down") {
    return (button: HTMLButtonElement | null) => {
      const target = focusArrow.current;
      if (button && target?.key === key && target.direction === direction) {
        focusArrow.current = undefined;
        button.focus();
      }
    };
  }

  function onTagKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Enter in a tag box adds another tag rather than saving.
    if (event.key === "Enter") {
      event.preventDefault();
      addRow();
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (sharedLayout) {
      void saveSharedLayout();
      return;
    }
    submit();
  }

  /**
   * Checks and saves the category (asking first where Save would), then goes back to Settings. With
   * `tabRowKey` ("Create Tab for this Tag"), it stays on the page and makes that tag's tab instead.
   */
  function submit(tabRowKey?: number) {
    const request: CategoryRequest = {
      name,
      multiSelect,
      tags: rows.map((row) => ({
        ...(row.id !== undefined && { id: row.id }),
        name: row.name,
        ...(row.hue !== undefined && { hue: row.hue }),
      })),
    };
    const check = validateCategory(request, categories, existing);
    if (!check.ok) {
      setError(check.error);
      return;
    }

    // Deleting tags removes them from every note that has them, so say so first.
    const deleted = (existing?.tags ?? []).filter((tag) => !check.category.tags.some((t) => t.id === tag.id));
    const affected = notes.filter((note) => deleted.some((tag) => note.tagIds.includes(tag.id))).length;
    // Changing to single-select leaves notes with only their first tag from the category, so say that too.
    const keptIds = check.category.tags.flatMap((tag) => (tag.id === undefined ? [] : [tag.id]));
    const narrowed =
      existing?.multiSelect && !check.category.multiSelect
        ? notes.filter((note) => note.tagIds.filter((id) => keptIds.includes(id)).length > 1).length
        : 0;
    if (affected > 0 || narrowed > 0) {
      const names = deleted.map((tag) => `"${tag.name}"`).join(", ");
      const messages = [
        affected > 0 &&
          `Delete ${deleted.length === 1 ? "the tag" : "the tags"} ${names}? ${deleted.length === 1 ? "It" : "They"} will be removed from ${plural(affected, "note")}.`,
        narrowed > 0 &&
          `Change to single-select? ${plural(narrowed, "note")} with more than one of these tags will keep only the first one in the list.`,
      ].filter(Boolean);
      setConfirming({
        message: messages.join(" "),
        confirmLabel: affected > 0 && narrowed > 0 ? "Save" : affected > 0 ? "Delete and save" : "Change and save",
        request: check.category,
        ...(tabRowKey !== undefined && { tabRowKey }),
      });
      return;
    }
    void send(check.category, tabRowKey);
  }

  /**
   * "Shared with me": stops seeing one of its tags, straight away. The other rows keep any unsaved changes;
   * with none left, the category has gone, so it's back to Settings.
   */
  async function leave(tag: Tag) {
    if (leavingBusy) return;
    setLeavingBusy(true);
    setError(undefined);
    try {
      await api.leaveSharedTag(tag.id);
      const left = rows.filter((row) => row.id !== tag.id);
      setRows(left);
      setLeaving(undefined);
      if (left.length === 0) onClose();
    } catch (err) {
      if (err instanceof ApiError && err.isUnauthorized) {
        onSessionExpired();
        return;
      }
      setLeaving(undefined);
      setError(`You're still viewing “${tagLabel(tag)}”: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLeavingBusy(false);
    }
  }

  /** "Shared with me": saves your order and colours for its tags. */
  async function saveSharedLayout() {
    setSaving(true);
    setError(undefined);
    try {
      const saved = await api.setSharedTags({ tags: rows.map((row) => ({ id: row.id!, ...(row.hue !== undefined && { hue: row.hue }) })) });
      if (saved) onSaved(saved);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.isUnauthorized) {
        onSessionExpired();
        return;
      }
      setError(`The order and colours weren't saved: ${err instanceof Error ? err.message : String(err)}`);
      setSaving(false);
    }
  }

  async function send(request: CategoryRequest, tabRowKey?: number) {
    setConfirming(undefined);
    setSaving(true);
    setError(undefined);
    let saved: Category;
    try {
      saved = existing ? await api.updateCategory(existing.id, request) : await api.addCategory(request);
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError && err.isUnauthorized) {
        onSessionExpired();
        return;
      }
      setError(`The category wasn't saved: ${err instanceof Error ? err.message : String(err)}`);
      setSaving(false);
      return;
    }
    if (tabRowKey === undefined) {
      onClose();
      return;
    }
    // Staying on the page: the rows become the tags as saved (new ones now have ids, empty new rows are gone),
    // each keeping its row's key, matched by name, so what's shown under it stays put.
    const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
    const keyOf = (tag: Tag) => rows.find((row) => sameName(row.name, tag.name))?.key;
    setRows(saved.tags.map((tag) => ({ ...newRow(tag), key: keyOf(tag) ?? nextKey.current++ })));
    setSaving(false);
    const target = rows.find((row) => row.key === tabRowKey);
    const tag = target && saved.tags.find((t) => sameName(t.name, target.name));
    if (tag) await makeTab(tabRowKey, saved, tag);
  }

  return (
    <main className="settings-page">
      <h1>{sharedLayout ? existing!.name : existing ? "Edit category" : "New category"}</h1>
      <form className="category-form" onSubmit={save}>
        {sharedLayout ? (
          <p className="hint">
            These are the tags other people have shared with you. You can choose their order and colours here: they only change how the
            notes look to you.
          </p>
        ) : (
          <>
        <label htmlFor="category-name">Name</label>
        <input
          id="category-name"
          type="text"
          value={name}
          maxLength={NAME_MAX_LENGTH}
          autoComplete="off"
          autoFocus={!existing}
          disabled={saving}
          onChange={(event) => setName(event.target.value)}
        />

        {/* Linked by id as well as wrapping, with a tall tap area, so tapping the text toggles the box. */}
        <label className="checkbox" htmlFor="category-multi-select">
          <input
            id="category-multi-select"
            type="checkbox"
            checked={multiSelect}
            disabled={saving}
            onChange={(event) => setMultiSelect(event.target.checked)}
          />
          <span>Multi-select: a note can have several tags from this category</span>
        </label>
        {existing?.multiSelect && !multiSelect && (
          <p className="hint">Notes with more than one of these tags will keep only the first one in the list below.</p>
        )}
          </>
        )}

        <fieldset>
          <legend>Tags</legend>
          <div className="tag-rows" ref={tagListRef}>
          {rowsWithGap(rows, (row) => row.key, tagDrag).map((entry) => {
            if ("gap" in entry) return <div key="drag-gap" className="drag-gap" style={{ height: entry.gap }} aria-hidden />;
            const row = entry.item;
            const index = rows.indexOf(row);
            const dragging = tagDrag?.id === row.key;
            const tabResult = tabResults.get(row.key);
            const tabLink = offersTab(row);
            const savedTag = row.id === undefined ? undefined : existing?.tags.find((tag) => tag.id === row.id);
            const nameBox = row.shared ? (
                <span className="shared-tag-name">{tagLabel(row.shared)}</span>
              ) : (
              <input
                type="text"
                aria-label={`Tag ${index + 1}`}
                value={row.name}
                maxLength={NAME_MAX_LENGTH}
                autoComplete="off"
                placeholder={row.id === undefined ? "New tag" : undefined}
                disabled={saving}
                ref={(input) => {
                  if (input && focusKey.current === row.key) {
                    focusKey.current = undefined;
                    input.focus();
                  }
                }}
                onChange={(event) => setRowName(row.key, event.target.value)}
                onKeyDown={onTagKeyDown}
              />
              );
            const underName = tabResult ?? (tabLink ? "link" : undefined);
            return (
            <div
              key={row.key}
              data-drag-id={row.key}
              className={["tag-row", dragging && "dragging", underName && "with-note"].filter(Boolean).join(" ")}
              style={dragging ? draggedStyle(tagDrag) : undefined}
            >
              <DragGrip label={`Drag ${row.name || `tag ${index + 1}`}`} handlers={tagGrip(row.key)} />
              {/* The tag's colour: tapping opens the hue picker. Saved with the category. */}
              <button
                type="button"
                className={row.hue === undefined ? "hue-box none" : "hue-box"}
                style={row.hue === undefined ? undefined : { background: hueColour(row.hue, "swatch") }}
                aria-label={`Colour of ${row.name || `tag ${index + 1}`}: ${row.hue === undefined ? "none" : `hue ${row.hue}°`}`}
                title={row.hue === undefined ? "Choose a colour" : `Colour: hue ${row.hue}°`}
                disabled={saving}
                onClick={() => setPickingHueFor(row)}
              />
              {underName ? (
                // The name box, with "Create Tab for this Tag" (or what came of it) in small text underneath.
                <div className="tag-name">
                  {nameBox}
                  {tabLink && tabResult?.made !== true && (
                    <button
                      type="button"
                      className="tag-tab-link"
                      aria-label={`Create Tab for ${row.name.trim()}`}
                      disabled={saving || makingTabFor !== undefined}
                      onClick={() => createTabFor(row)}
                    >
                      {makingTabFor === row.key ? "Creating tab…" : "Create Tab for this Tag"}
                    </button>
                  )}
                  {tabResult && (
                    <span className={tabResult.made ? "tag-tab-result" : "tag-tab-result error"} role={tabResult.made ? "status" : "alert"}>
                      {tabResult.message}
                    </span>
                  )}
                </div>
              ) : (
                nameBox
              )}
              {/* "Shared by you", as on the tag's pills: what the most generous of its shares allows, or an hourglass
                  while someone hasn't accepted yet. Every row keeps the room for it, so the name boxes line up. */}
              <span className="tag-row-sharing">{savedTag && !sharedLayout && <SettingsSharingIcon tag={savedTag} />}</span>
              {/* Up and down change the tag order; like renames and deletes, it's saved with the category. */}
              <button
                type="button"
                className="note-button"
                ref={arrowRef(row.key, "up")}
                aria-label={`Move up ${row.name || `tag ${index + 1}`}`}
                title="Move up"
                disabled={saving || index === 0}
                onClick={() => moveRow(row.key, -1)}
              >
                <FontAwesomeIcon icon={faArrowUp} />
              </button>
              <button
                type="button"
                className="note-button"
                ref={arrowRef(row.key, "down")}
                aria-label={`Move down ${row.name || `tag ${index + 1}`}`}
                title="Move down"
                disabled={saving || index === rows.length - 1}
                onClick={() => moveRow(row.key, 1)}
              >
                <FontAwesomeIcon icon={faArrowDown} />
              </button>
              {!sharedLayout && (
                <>
                  {/* Sharing is saved by itself, straight away, so only a saved tag (with its saved name) can be shared. */}
                  <button
                    type="button"
                    className="note-button"
                    aria-label={`Share ${row.name || `tag ${index + 1}`}`}
                    title={row.id === undefined ? "Save the category before sharing this tag" : "Share with other people"}
                    disabled={saving || row.id === undefined}
                    onClick={() => {
                      const saved = existing?.tags.find((tag) => tag.id === row.id);
                      if (saved) setSharing({ id: saved.id, name: saved.name });
                    }}
                  >
                    <FontAwesomeIcon icon={faShareNodes} />
                  </button>
                  <button
                    type="button"
                    className="note-button"
                    aria-label={`Delete tag ${row.name || index + 1}`}
                    title="Delete tag"
                    // A category needs at least one tag.
                    disabled={saving || rows.length === 1}
                    onClick={() => deleteRow(row.key)}
                  >
                    <FontAwesomeIcon icon={faTrashCan} />
                  </button>
                </>
              )}
              {sharedLayout && row.shared && (
                // Stops seeing the tag straight away (after asking), not when the page is saved.
                <button
                  type="button"
                  className="note-button"
                  aria-label={`Stop viewing ${tagLabel(row.shared)}`}
                  title="Stop viewing this shared tag"
                  disabled={saving || leavingBusy}
                  onClick={() => setLeaving(row.shared)}
                >
                  <FontAwesomeIcon icon={faRightFromBracket} />
                </button>
              )}
            </div>
            );
          })}
          </div>
          {sharedLayout ? null : tagsFull ? (
            <p className="hint">A category can have at most {TAGS_PER_CATEGORY_MAX} tags.</p>
          ) : (
            <button type="button" className="button" disabled={saving} onClick={addRow}>
              Add tag
            </button>
          )}
        </fieldset>

        {error && (
          <p className="save-error" role="alert">
            {error}
          </p>
        )}

        <div className="form-buttons">
          <button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" className="button" disabled={saving} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
      {pickingHueFor && (
        <HuePicker
          tagName={pickingHueFor.shared ? tagLabel(pickingHueFor.shared) : pickingHueFor.name || "New tag"}
          hue={pickingHueFor.hue}
          onSet={(hue) => {
            setRowHue(pickingHueFor.key, hue);
            setPickingHueFor(undefined);
          }}
          onCancel={() => setPickingHueFor(undefined)}
        />
      )}
      {sharing && (
        <ShareDialog tagId={sharing.id} tagName={sharing.name} onClose={() => setSharing(undefined)} onSessionExpired={onSessionExpired} />
      )}
      {leaving && (
        <ConfirmDialog
          message={`Stop viewing “${tagLabel(leaving)}”? You won't see ${leaving.ownerName}'s notes with this tag any more, and ${leaving.ownerName} will be emailed to say so. Only ${leaving.ownerName} can share it with you again.`}
          confirmLabel={leavingBusy ? "Stopping…" : "Stop viewing"}
          onConfirm={() => void leave(leaving)}
          onCancel={() => !leavingBusy && setLeaving(undefined)}
        />
      )}
      {confirming && (
        <ConfirmDialog
          message={confirming.message}
          confirmLabel={confirming.confirmLabel}
          onConfirm={() => void send(confirming.request, confirming.tabRowKey)}
          onCancel={() => setConfirming(undefined)}
        />
      )}
    </main>
  );
}
