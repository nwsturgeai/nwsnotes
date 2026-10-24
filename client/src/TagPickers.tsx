import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck } from "@fortawesome/free-solid-svg-icons";
import type { Category } from "@nwsnotes/shared";

/** The tags chosen in each category's dropdown: category id -> tag ids. */
export type TagSelection = Record<number, number[]>;

/** The chosen tag ids that still exist, in category order then tag order. */
export function selectedTagIds(categories: Category[], selection: TagSelection): number[] {
  return categories.flatMap((category) => {
    const chosen = selection[category.id] ?? [];
    return category.tags.filter((tag) => chosen.includes(tag.id)).map((tag) => tag.id);
  });
}

interface Props {
  categories: Category[];
  selection: TagSelection;
  onChange: (selection: TagSelection) => void;
  disabled: boolean;
}

/** One dropdown per category, for choosing a new note's tags. They have no titles: an unset one shows its category name. */
export function TagPickers({ categories, selection, onChange, disabled }: Props) {
  if (categories.length === 0) return null;

  return (
    <div className="tag-pickers">
      {categories.map((category) => (
        <TagDropdown
          key={category.id}
          category={category}
          chosen={selection[category.id] ?? []}
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
  disabled: boolean;
  onChange: (tagIds: number[]) => void;
}

/**
 * A button showing the chosen tags (or the category name when none is chosen) that opens a list.
 * Single-select: choosing an option replaces the choice and closes the list. Multi-select: a check-list.
 * Built by the app rather than using the browser's own dropdown, so both kinds look and behave alike
 * and the app decides which inputs they respond to (see NotesPage's stylus-mode touch handling).
 */
function TagDropdown({ category, chosen, disabled, onChange }: DropdownProps) {
  /** Where the open list sits. It is positioned on the window, so the scrolling new-note area can't clip it. */
  const [position, setPosition] = useState<{ left: number; bottom: number }>();
  const open = position !== undefined;
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const names = category.tags.filter((tag) => chosen.includes(tag.id)).map((tag) => tag.name);
  const listId = `tag-dropdown-${category.id}`;

  function close() {
    setPosition(undefined);
  }

  function toggleOpen() {
    const rect = buttonRef.current?.getBoundingClientRect();
    // Opens upwards, as the new-note area is at the bottom of the screen.
    setPosition(open || !rect ? undefined : { left: rect.left, bottom: window.innerHeight - rect.top + 4 });
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

  return (
    <div className="tag-dropdown" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={names.length > 0 ? "tag-dropdown-button" : "tag-dropdown-button unset"}
        title={category.name}
        aria-label={`${category.name}: ${names.length > 0 ? names.join(", ") : "no tag"}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        onClick={toggleOpen}
      >
        {names.length > 0 ? names.join(", ") : category.name}
      </button>
      {open && (
        <div
          className="tag-dropdown-list"
          id={listId}
          role="group"
          aria-label={category.name}
          style={{ left: position.left, bottom: position.bottom }}
        >
          {category.multiSelect ? (
            category.tags.map((tag) => (
              <label key={tag.id}>
                <input
                  type="checkbox"
                  checked={chosen.includes(tag.id)}
                  onChange={(event) => toggle(tag.id, event.target.checked)}
                />
                {tag.name}
              </label>
            ))
          ) : (
            <>
              <Option label={category.name} unset chosen={chosen.length === 0} onChoose={() => choose(undefined)} />
              {category.tags.map((tag) => (
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
