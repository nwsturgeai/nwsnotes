import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faLock } from "@fortawesome/free-solid-svg-icons";
import { LIFETIME_CATEGORY_ID, type Category, type TabFilter } from "@nwsnotes/shared";

/** The tags chosen in each category's dropdown: category id -> tag ids. */
export type TagSelection = Record<number, number[]>;

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

/** The chosen tag ids that still exist, with the tab's rules applied, in category order then tag order. */
export function selectedTagIds(categories: Category[], selection: TagSelection, constraints?: TabConstraints): number[] {
  return categories.flatMap((category) => {
    const chosen = effectiveChosen(category, selection[category.id] ?? [], constraints?.get(category.id));
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
}

/** One dropdown per category. They have no titles: an unset one shows its category name. */
export function TagPickers({ categories, selection, onChange, disabled, constraints, tabName, checkLists }: Props) {
  if (categories.length === 0) return null;

  return (
    <div className="tag-pickers">
      {categories.map((category) => (
        <TagDropdown
          key={category.id}
          category={category}
          chosen={effectiveChosen(category, selection[category.id] ?? [], constraints?.get(category.id))}
          tabTagIds={constraints?.get(category.id)}
          tabName={tabName}
          checkList={checkLists || category.multiSelect}
          disabled={disabled}
          onChange={(tagIds) => onChange({ ...selection, [category.id]: tagIds })}
        />
      ))}
    </div>
  );
}

interface DropdownProps {
  category: Category;
  chosen: number[];
  /** The selected tab's tags for this category, if the tab filters on it. */
  tabTagIds: number[] | undefined;
  tabName: string | undefined;
  checkList: boolean;
  disabled: boolean;
  onChange: (tagIds: number[]) => void;
}

/** Room needed below the button to open the list downwards. */
const LIST_SPACE = 260;

/**
 * A button showing the chosen tags (or the category name when none is chosen) that opens a list.
 * Single-select: choosing an option replaces the choice and closes the list. Check-list: tick any number.
 * Built by the app rather than using the browser's own dropdown, so both kinds look and behave alike
 * and the app decides which inputs they respond to (see NotesPage's stylus-mode touch handling).
 */
function TagDropdown({ category, chosen, tabTagIds, tabName, checkList, disabled, onChange }: DropdownProps) {
  /** Where the open list sits. It is positioned on the window, so a scrolling area can't clip it. */
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number }>();
  const open = position !== undefined;
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const names = category.tags.filter((tag) => chosen.includes(tag.id)).map((tag) => tag.name);
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
    // Opens downwards when there's room (e.g. in Settings); otherwise upwards (the new-note area is at the bottom).
    const spaceBelow = window.innerHeight - rect.bottom;
    setPosition(
      spaceBelow >= LIST_SPACE || spaceBelow > rect.top
        ? { left: rect.left, top: rect.bottom + 4 }
        : { left: rect.left, bottom: window.innerHeight - rect.top + 4 },
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
    const onScroll = (event: Event) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
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
          style={{ left: position.left, top: position.top, bottom: position.bottom }}
        >
          {checkList ? (
            category.tags.map((tag) => {
              const locked = tag.id === lockedTagId;
              return (
                <label key={tag.id} className={locked ? "locked" : undefined} title={locked ? lockHint : undefined}>
                  <input
                    type="checkbox"
                    checked={chosen.includes(tag.id)}
                    disabled={locked}
                    onChange={(event) => toggle(tag.id, event.target.checked)}
                  />
                  {tag.name}
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
                <Option key={tag.id} label={tag.name} chosen={chosen.includes(tag.id)} onChoose={() => choose(tag.id)} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** One option in a single-select list, with a tick when it's the current choice. */
function Option({ label, unset, chosen, onChoose }: { label: string; unset?: boolean; chosen: boolean; onChoose: () => void }) {
  return (
    <button type="button" className={unset ? "tag-option unset" : "tag-option"} aria-pressed={chosen} onClick={onChoose}>
      <span className="tag-option-tick">{chosen && <FontAwesomeIcon icon={faCheck} />}</span>
      {label}
    </button>
  );
}

/**
 * Full-tag-list mode: every tag of every category as a pill, one category per line (its name first,
 * in small grey text). A chosen tag is dark, an unchosen one light; tapping toggles it. The tab's
 * rules apply as for the dropdowns: a locked tag can't be turned off, and in a single-select category
 * where one of several tags is required, the others can't be chosen.
 */
export function TagPillPicker({ categories, selection, onChange, disabled, constraints, tabName }: Props) {
  if (categories.length === 0) return null;
  const lockHint = tabName ? `set by the "${tabName}" tab's filters` : "set by this tab's filters";

  return (
    <div className="tag-pill-picker">
      {categories.map((category) => {
        const tabTagIds = constraints?.get(category.id);
        const chosen = effectiveChosen(category, selection[category.id] ?? [], tabTagIds);
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
            <span className="tag-pill-category">{category.name}</span>
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
                  title={locked ? `${tag.name} (${lockHint})` : unavailable ? `${tag.name} (not shown in this tab)` : tag.name}
                  disabled={disabled || locked || unavailable}
                  onClick={() => toggle(tag.id)}
                >
                  {locked && <FontAwesomeIcon icon={faLock} className="lock-icon" />}
                  {tag.name}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
