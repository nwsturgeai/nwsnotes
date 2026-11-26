import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faLock } from "@fortawesome/free-solid-svg-icons";
import { LIFETIME_CATEGORY_ID, tagLabel, type Category, type Note, type TabFilter, type Tag } from "@nwsnotes/shared";
import { faCircleMinusOutline, faCirclePlusOutline } from "./icons";
import { SharingIcons } from "./sharingIcons";

/** The tags chosen in each category's dropdown: category id -> tag ids. */
export type TagSelection = Record<number, number[]>;

/**
 * The filter row's "(None)" choice, kept in a category's selection in place of tag ids: it lists only
 * notes with none of the category's tags. Tag ids start at 1 (and Lifetime's are negative), so 0 can't clash.
 */
export const NONE_TAG_ID = 0;

/** The categories whose filter dropdown has "(None)" ticked. Lifetime has no "(None)": every note has one. */
export function noneCategories(categories: Category[], selection: TagSelection): Category[] {
  return categories.filter((category) => !category.system && (selection[category.id] ?? []).includes(NONE_TAG_ID));
}

/** Whether a note has none of the tags of any of these categories. */
export function hasNoTagIn(note: Note, categories: Category[]): boolean {
  return categories.every((category) => !category.tags.some((tag) => note.tagIds.includes(tag.id)));
}

/** What the selected tab (and its additional filters) require of new notes: category id -> tag ids. */
export type TabConstraints = Map<number, number[]>;

/**
 * The new-note rules from a tab's filters and its additional filters. Lifetime isn't included:
 * new notes are always New, and there's no Lifetime dropdown.
 */
export function constraintsFor(filters: TabFilter[]): TabConstraints {
  return new Map(
    filters.filter((filter) => filter.categoryId !== LIFETIME_CATEGORY_ID).map((filter) => [filter.categoryId, filter.tagIds]),
  );
}

/** Dropdown choices as filters, leaving out categories with nothing ticked. */
export function selectionToFilters(categories: Category[], selection: TagSelection): TabFilter[] {
  return categories
    .map((category) => ({
      categoryId: category.id,
      tagIds: category.tags.filter((tag) => (selection[category.id] ?? []).includes(tag.id)).map((tag) => tag.id),
    }))
    .filter((filter) => filter.tagIds.length > 0);
}

/**
 * The tags a dropdown actually has chosen, once the tab's rules are applied:
 * a one-tag filter's tag is always included, and a single-select dropdown under
 * a several-tag filter can only hold one of the tab's tags.
 */
function effectiveChosen(category: Category, chosen: number[], tabTagIds: number[] | undefined): number[] {
  const existing = chosen.filter((id) => category.tags.some((tag) => tag.id === id));
  if (!tabTagIds) return existing;
  const locked = tabTagIds.length === 1 ? tabTagIds[0] : undefined;
  if (category.multiSelect) {
    return locked === undefined || existing.includes(locked) ? existing : [...existing, locked];
  }
  if (locked !== undefined) return [locked];
  return existing.filter((id) => tabTagIds.includes(id)).slice(0, 1);
}

/**
 * A single-select category's choice: at most one tag, the first in the category's order. (A selection
 * can hold more if the category was multi-select when it was made.)
 */
function singleChoice(category: Category, chosen: number[]): number[] {
  const first = category.tags.find((tag) => chosen.includes(tag.id));
  return first ? [first.id] : [];
}

/** What a dropdown or pill row shows as chosen: one tag for a single-select category, unless it's a check-list. */
function shownChoice(category: Category, chosen: number[], checkLists = false): number[] {
  return checkLists || category.multiSelect ? chosen : singleChoice(category, chosen);
}

/** The chosen tag ids that still exist, with the tab's rules applied, in category order then tag order. */
export function selectedTagIds(categories: Category[], selection: TagSelection, constraints?: TabConstraints): number[] {
  return categories.flatMap((category) => {
    const effective = effectiveChosen(category, selection[category.id] ?? [], constraints?.get(category.id));
    const chosen = category.multiSelect ? effective : singleChoice(category, effective);
    return category.tags.filter((tag) => chosen.includes(tag.id)).map((tag) => tag.id);
  });
}

/** The first category where the tab needs one of its several tags but none is chosen. */
export function missingRequiredCategory(
  categories: Category[],
  selection: TagSelection,
  constraints: TabConstraints,
): Category | undefined {
  return categories.find((category) => {
    const tabTagIds = constraints.get(category.id);
    if (!tabTagIds) return false;
    const chosen = effectiveChosen(category, selection[category.id] ?? [], tabTagIds);
    return !chosen.some((id) => tabTagIds.includes(id));
  });
}

interface Props {
  categories: Category[];
  selection: TagSelection;
  onChange: (selection: TagSelection) => void;
  disabled: boolean;
  /** The selected tab's rules for new notes (notes page only). */
  constraints?: TabConstraints;
  /** The selected tab's name, for explaining locked tags. */
  tabName?: string;
  /** Every dropdown is a check-list, even for single-select categories (the tab editor). */
  checkLists?: boolean;
  /**
   * The filter row: how many notes each tag would show (tag id -> count), how many "(None)" would show
   * (category id -> count), and how many are shown now.
   */
  counts?: { byTag: ReadonlyMap<number, number>; byNone?: ReadonlyMap<number, number>; total: number };
  /** The filter row: each check-list starts with small "select all" and "clear selection" links. */
  selectAll?: boolean;
  /** Your own shared tags show the sharing icon after their names. */
  showSharing?: boolean;
  /** The filter row: each check-list (but Lifetime's) ends with "(None)", for notes with none of its tags. */
  noneOption?: boolean;
  /** Check-lists: how far each option is indented (option id -> level, 0 for none), e.g. long-form notes under their parents. */
  indents?: ReadonlyMap<number, number>;
  /** Check-lists: options ticked because of another one (a ticked note's child notes), which can't be unticked themselves. */
  implied?: { ids: ReadonlySet<number>; hint: string };
  /** Full-tag-list mode: a last line after the categories (the note's parent), scrolling with them. */
  lastRow?: ReactNode;
}

/** The sharing icon after a tag's name in a picker, if it's one of yours that you've shared. */
function TagSharing({ tag, show }: { tag: Tag; show: boolean | undefined }) {
  return show && tag.sharedOut ? <SharingIcons permission={tag.sharedOut} decorative /> : null;
}

/** One dropdown per category. They have no titles: an unset one shows its category name. */
export function TagPickers({
  categories,
  selection,
  onChange,
  disabled,
  constraints,
  tabName,
  checkLists,
  counts,
  selectAll,
  showSharing,
  noneOption,
  indents,
  implied,
}: Props) {
  if (categories.length === 0) return null;

  return (
    <div className="tag-pickers">
      {categories.map((category) => (
        <TagDropdown
          key={category.id}
          category={category}
          chosen={shownChoice(category, effectiveChosen(category, selection[category.id] ?? [], constraints?.get(category.id)), checkLists)}
          tabTagIds={constraints?.get(category.id)}
          tabName={tabName}
          checkList={checkLists || category.multiSelect}
          disabled={disabled}
          onChange={(tagIds) => onChange({ ...selection, [category.id]: tagIds })}
          counts={counts}
          selectAll={selectAll}
          showSharing={showSharing}
          noneOption={noneOption && !category.system}
          noneChosen={(selection[category.id] ?? []).includes(NONE_TAG_ID)}
          indents={indents}
          implied={implied}
        />
      ))}
    </div>
  );
}

/** A tag's note count after its name, e.g. "(4)"; grey when there are none. */
function TagCount({ count }: { count: number | undefined }) {
  if (count === undefined) return null;
  return <span className={count === 0 ? "tag-count none" : "tag-count"}>({count})</span>;
}

interface DropdownProps {
  counts?: Props["counts"];
  indents?: Props["indents"];
  implied?: Props["implied"];
  selectAll?: boolean;
  showSharing?: boolean;
  /** The list ends with a "(None)" check-box (filter row only). */
  noneOption?: boolean;
  /** "(None)" is ticked: then no tags are. */
  noneChosen?: boolean;
  category: Category;
  chosen: number[];
  /** The selected tab's tags for this category, if the tab filters on it. */
  tabTagIds: number[] | undefined;
  tabName: string | undefined;
  checkList: boolean;
  disabled: boolean;
  onChange: (tagIds: number[]) => void;
}

/** An open list's rows are 2.1rem (33.6px) high, plus 0.7rem of padding and a 1px border; it shows up to 15 before scrolling. */
const LIST_ROW_PX = 33.6;
const LIST_PADDING_PX = 13.2;
const LIST_MAX_ROWS = 15;
/** Space kept between an open list and the window's edge. */
const LIST_MARGIN_PX = 8;

/**
 * A button showing the chosen tags (or the category name when none is chosen) that opens a list.
 * Single-select: choosing an option replaces the choice and closes the list. Check-list: tick any number.
 * Built by the app rather than using the browser's own dropdown, so both kinds look and behave alike
 * and the app decides which inputs they respond to (see NotesPage's stylus-mode touch handling).
 */
function TagDropdown({
  category,
  chosen,
  tabTagIds,
  tabName,
  checkList,
  disabled,
  onChange,
  counts,
  selectAll,
  showSharing,
  noneOption,
  noneChosen,
  indents,
  implied,
}: DropdownProps) {
  /** Where the open list sits. It is positioned on the window, so a scrolling area can't clip it. */
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number; room: number }>();
  const open = position !== undefined;
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const withNone = checkList && noneOption === true;
  const names = withNone && noneChosen ? ["(None)"] : category.tags.filter((tag) => chosen.includes(tag.id)).map(tagLabel);
  const listId = `tag-dropdown-${category.id}`;

  /** A one-tag tab filter fixes this tag. */
  const lockedTagId = tabTagIds?.length === 1 ? tabTagIds[0] : undefined;
  /** A single-select dropdown with its tag fixed by the tab can't be changed at all. */
  const fullyLocked = lockedTagId !== undefined && !checkList;
  /** Under a several-tag filter a single-select dropdown offers only the tab's tags, and one is required. */
  const options = !checkList && tabTagIds ? category.tags.filter((tag) => tabTagIds.includes(tag.id)) : category.tags;
  const lockHint = tabName ? `set by the "${tabName}" tab's filters` : "set by this tab's filters";

  function close() {
    setPosition(undefined);
  }

  function toggleOpen() {
    if (fullyLocked) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (open || !rect) {
      close();
      return;
    }
    // Opens downwards when the whole list fits (e.g. in Settings); otherwise towards the side with more
    // room (upwards from the new-note area at the bottom). It's limited to the room there, and scrolls.
    const rows =
      (checkList ? category.tags.length + (selectAll ? 1 : 0) + (withNone ? 1 : 0) : options.length + (tabTagIds ? 0 : 1)) +
      (counts ? 1 : 0);
    const needed = Math.min(rows, LIST_MAX_ROWS) * LIST_ROW_PX + LIST_PADDING_PX;
    const spaceBelow = window.innerHeight - rect.bottom - 4 - LIST_MARGIN_PX;
    const spaceAbove = rect.top - 4 - LIST_MARGIN_PX;
    setPosition(
      spaceBelow >= needed || spaceBelow >= spaceAbove
        ? { left: rect.left, top: rect.bottom + 4, room: spaceBelow }
        : { left: rect.left, bottom: window.innerHeight - rect.top + 4, room: spaceAbove },
    );
  }

  // Close when clicking elsewhere, pressing Escape, scrolling or resizing.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    // A scroll elsewhere only closes the list if it moved the button (the list is placed next to it).
    // Scrolls that don't, such as the note list jumping to the bottom when a filter is ticked, leave it open.
    const opened = buttonRef.current?.getBoundingClientRect();
    const onScroll = (event: Event) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      const now = buttonRef.current?.getBoundingClientRect();
      if (!opened || !now || Math.abs(now.top - opened.top) > 1 || Math.abs(now.left - opened.left) > 1) close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  function choose(tagId: number | undefined) {
    onChange(tagId === undefined ? [] : [tagId]);
    close();
    buttonRef.current?.focus();
  }

  /** Ticking a tag unticks "(None)" (it's never in `chosen`, which only holds tags). */
  function toggle(tagId: number, checked: boolean) {
    onChange(checked ? [...chosen, tagId] : chosen.filter((id) => id !== tagId));
  }

  const classes = ["tag-dropdown-button", names.length === 0 && "unset", fullyLocked && "locked"].filter(Boolean);

  return (
    <div className="tag-dropdown" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={classes.join(" ")}
        title={fullyLocked ? `${category.name} (${lockHint})` : category.name}
        aria-label={`${category.name}: ${names.length > 0 ? names.join(", ") : "no tag"}${fullyLocked ? `, ${lockHint}` : ""}`}
        aria-haspopup={fullyLocked ? undefined : "true"}
        aria-expanded={fullyLocked ? undefined : open}
        aria-controls={fullyLocked ? undefined : listId}
        aria-disabled={fullyLocked || undefined}
        disabled={disabled}
        onClick={toggleOpen}
      >
        {fullyLocked && <FontAwesomeIcon icon={faLock} className="lock-icon" />}
        {names.length > 0 ? names.join(", ") : category.name}
      </button>
      {open && (
        <div
          className="tag-dropdown-list"
          id={listId}
          role="group"
          aria-label={category.name}
          style={{ left: position.left, top: position.top, bottom: position.bottom, "--list-room": `${position.room}px` } as CSSProperties}
        >
          {/* "select all" ticks every tag (greyed out once they all are); "clear selection" unticks every tag
              and "(None)", but not a tag the tab fixes (greyed out once nothing else is ticked). */}
          {checkList && selectAll && (
            <div className="tag-dropdown-links">
              <button
                type="button"
                className="tag-dropdown-select-all"
                disabled={category.tags.every((tag) => chosen.includes(tag.id))}
                onClick={() => onChange(category.tags.map((tag) => tag.id))}
              >
                select all
              </button>
              <button
                type="button"
                className="tag-dropdown-select-all"
                disabled={!noneChosen && chosen.every((id) => id === lockedTagId)}
                onClick={() => onChange(lockedTagId !== undefined ? [lockedTagId] : [])}
              >
                clear selection
              </button>
            </div>
          )}
          {checkList ? (
            category.tags.map((tag) => {
              const locked = tag.id === lockedTagId || implied?.ids.has(tag.id) === true;
              const indent = indents?.get(tag.id) ?? 0;
              return (
                <label
                  key={tag.id}
                  className={locked ? "locked" : undefined}
                  title={tag.id === lockedTagId ? lockHint : locked ? implied?.hint : undefined}
                  style={indent > 0 ? { paddingLeft: `${0.75 + indent * 1.25}rem` } : undefined}
                >
                  <input
                    type="checkbox"
                    checked={chosen.includes(tag.id) || locked}
                    disabled={locked}
                    onChange={(event) => toggle(tag.id, event.target.checked)}
                  />
                  {tagLabel(tag)}
                  <TagSharing tag={tag} show={showSharing} />
                  <TagCount count={counts?.byTag.get(tag.id)} />
                  {locked && <FontAwesomeIcon icon={faLock} className="lock-icon" />}
                </label>
              );
            })
          ) : (
            <>
              {/* Under a tab that filters on this category, a tag is required, so there's no "no tag" option. */}
              {!tabTagIds && (
                <Option label={category.name} unset chosen={chosen.length === 0} onChoose={() => choose(undefined)} />
              )}
              {options.map((tag) => (
                <Option
                  key={tag.id}
                  label={tagLabel(tag)}
                  after={<TagSharing tag={tag} show={showSharing} />}
                  chosen={chosen.includes(tag.id)}
                  onChoose={() => choose(tag.id)}
                />
              ))}
            </>
          )}
          {/* Notes with none of this category's tags. Ticking it unticks every tag. */}
          {withNone && (
            <label className="tag-dropdown-none">
              <input
                type="checkbox"
                checked={noneChosen === true}
                onChange={(event) => onChange(event.target.checked ? [NONE_TAG_ID] : [])}
              />
              (None)
              <TagCount count={counts?.byNone?.get(category.id)} />
            </label>
          )}
          {/* Not an option: how many notes the list shows now. */}
          {counts && <div className="tag-dropdown-total">TOTAL: {counts.total}</div>}
        </div>
      )}
    </div>
  );
}

/** One option in a single-select list, with a tick when it's the current choice. */
function Option({
  label,
  after,
  unset,
  chosen,
  onChoose,
}: {
  label: string;
  /** Shown after the label (a shared tag's sharing icon). */
  after?: ReactNode;
  unset?: boolean;
  chosen: boolean;
  onChoose: () => void;
}) {
  return (
    <button type="button" className={unset ? "tag-option unset" : "tag-option"} aria-pressed={chosen} onClick={onChoose}>
      <span className="tag-option-tick">{chosen && <FontAwesomeIcon icon={faCheck} />}</span>
      {label}
      {after}
    </button>
  );
}

/** Props of the add/edit area's tag chooser: which categories are dropdowns, the rest being pills. */
interface MixedProps extends Props {
  /** Categories shown as a dropdown (the others are pill lines). */
  collapsed: number[];
  onCollapsedChange: (categoryIds: number[]) => void;
}

/**
 * The add/edit area's tags: each category is either a dropdown or a line of pills, and can be switched.
 * The dropdowns come first, in one row, each with an expand button (an outline circle-plus) just right
 * of it; then a line per expanded category: its name (small, grey), a collapse button (outline
 * circle-minus) just right of it, and every tag as a pill. A chosen pill is dark, an unchosen one light;
 * tapping toggles it. The tab's rules apply either way: a locked tag can't be turned off, and in a
 * single-select category where one of several tags is required, the others can't be chosen.
 */
export function MixedTagPicker({
  categories,
  selection,
  onChange,
  disabled,
  constraints,
  tabName,
  showSharing,
  lastRow,
  collapsed,
  onCollapsedChange,
}: MixedProps) {
  if (categories.length === 0 && !lastRow) return null;
  const lockHint = tabName ? `set by the "${tabName}" tab's filters` : "set by this tab's filters";
  const dropdowns = categories.filter((category) => collapsed.includes(category.id));
  const pillLines = categories.filter((category) => !collapsed.includes(category.id));

  return (
    <div className="tag-mixed-picker">
      {dropdowns.length > 0 && (
        <div className="tag-pickers">
          {dropdowns.map((category) => (
            <div key={category.id} className="tag-dropdown-toggle">
              <TagDropdown
                category={category}
                chosen={shownChoice(category, effectiveChosen(category, selection[category.id] ?? [], constraints?.get(category.id)))}
                tabTagIds={constraints?.get(category.id)}
                tabName={tabName}
                checkList={category.multiSelect}
                disabled={disabled}
                onChange={(tagIds) => onChange({ ...selection, [category.id]: tagIds })}
                showSharing={showSharing}
              />
              <button
                type="button"
                className="category-toggle"
                aria-label={`Show ${category.name} as pills`}
                title={`Show ${category.name} as pills`}
                aria-expanded={false}
                onClick={() => onCollapsedChange(collapsed.filter((id) => id !== category.id))}
              >
                <FontAwesomeIcon icon={faCirclePlusOutline} />
              </button>
            </div>
          ))}
        </div>
      )}
      {(pillLines.length > 0 || lastRow) && (
        <div className="tag-pill-picker">
          {pillLines.map((category) => {
            const tabTagIds = constraints?.get(category.id);
            const chosen = shownChoice(category, effectiveChosen(category, selection[category.id] ?? [], tabTagIds));
            const lockedTagId = tabTagIds?.length === 1 ? tabTagIds[0] : undefined;

            function toggle(tagId: number) {
              const isChosen = chosen.includes(tagId);
              // Single-select: choosing a tag unchooses the others; tapping the chosen one clears it.
              const next = category.multiSelect
                ? isChosen
                  ? chosen.filter((id) => id !== tagId)
                  : [...chosen, tagId]
                : isChosen
                  ? []
                  : [tagId];
              onChange({ ...selection, [category.id]: next });
            }

            return (
              <div key={category.id} className="tag-pill-row" role="group" aria-label={category.name}>
                {/* The name and the collapse button are one button: tapping either shows the category as a dropdown. */}
                <button
                  type="button"
                  className="category-toggle with-name"
                  aria-label={`Show ${category.name} as a dropdown`}
                  title={`Show ${category.name} as a dropdown`}
                  aria-expanded
                  onClick={() => onCollapsedChange([...collapsed, category.id])}
                >
                  <span className="tag-pill-category">{category.name}</span>
                  <FontAwesomeIcon icon={faCircleMinusOutline} />
                </button>
                {category.tags.map((tag) => {
                  const isChosen = chosen.includes(tag.id);
                  const locked = tag.id === lockedTagId;
                  // Under a several-tag filter, a single-select category only offers the tab's tags.
                  const unavailable = !category.multiSelect && tabTagIds !== undefined && !tabTagIds.includes(tag.id);
                  const classes = ["tag-pill", isChosen && "chosen", locked && "locked", unavailable && "unavailable"];
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      className={classes.filter(Boolean).join(" ")}
                      aria-pressed={isChosen}
                      title={locked ? `${tagLabel(tag)} (${lockHint})` : unavailable ? `${tagLabel(tag)} (not shown in this tab)` : tagLabel(tag)}
                      disabled={disabled || locked || unavailable}
                      onClick={() => toggle(tag.id)}
                    >
                      {locked && <FontAwesomeIcon icon={faLock} className="lock-icon" />}
                      {tagLabel(tag)}
                      <TagSharing tag={tag} show={showSharing} />
                    </button>
                  );
                })}
              </div>
            );
          })}
          {lastRow}
        </div>
      )}
    </div>
  );
}

/** Multi-select: the pills clicked so far, as tag id -> whether it ended chosen (to add) or not (to remove). */
export type BulkTagChanges = Map<number, boolean>;

interface BulkProps {
  categories: Category[];
  /** The notes selected in the list. With none, the pills can't be clicked. */
  notes: Note[];
  changes: BulkTagChanges;
  onChange: (changes: BulkTagChanges) => void;
  disabled: boolean;
  /** Your own shared tags show the sharing icon after their names. */
  showSharing?: boolean;
}

/**
 * Multi-select (bulk tag editing): every tag as a pill, showing whether all, some or none of the
 * selected notes have it (chosen, mixed or not), until it's clicked. Clicking a not-chosen or mixed
 * pill chooses it, and a chosen one unchooses it. In a single-select category, choosing a tag also
 * unchooses the category's other tags (all counting as clicked). Tab rules don't apply.
 */
export function BulkTagPicker({ categories, notes, changes, onChange, disabled, showSharing }: BulkProps) {
  if (categories.length === 0) return null;

  function stateOf(tagId: number): "chosen" | "mixed" | "none" {
    const changed = changes.get(tagId);
    if (changed !== undefined) return changed ? "chosen" : "none";
    const count = notes.filter((note) => note.tagIds.includes(tagId)).length;
    return count === 0 ? "none" : count === notes.length ? "chosen" : "mixed";
  }

  return (
    <div className="tag-pill-picker">
      {categories.map((category) => {
        function toggle(tagId: number) {
          const choose = stateOf(tagId) !== "chosen";
          const next = new Map(changes);
          next.set(tagId, choose);
          if (choose && !category.multiSelect) {
            for (const tag of category.tags) if (tag.id !== tagId) next.set(tag.id, false);
          }
          onChange(next);
        }

        return (
          <div key={category.id} className="tag-pill-row" role="group" aria-label={category.name}>
            <span className="tag-pill-category">{category.name}</span>
            {category.tags.map((tag) => {
              const state = stateOf(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  className={state === "none" ? "tag-pill" : `tag-pill ${state}`}
                  aria-pressed={state === "chosen" ? true : state === "mixed" ? "mixed" : false}
                  title={state === "mixed" ? `${tag.name} (some of the selected notes)` : tag.name}
                  disabled={disabled || notes.length === 0}
                  onClick={() => toggle(tag.id)}
                >
                  {tag.name}
                  <TagSharing tag={tag} show={showSharing} />
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
