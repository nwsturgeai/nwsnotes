import { useEffect, useRef, useState } from "react";
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

/** One dropdown per category, for choosing a new note's tags. */
export function TagPickers({ categories, selection, onChange, disabled }: Props) {
  if (categories.length === 0) return null;

  function set(categoryId: number, tagIds: number[]) {
    onChange({ ...selection, [categoryId]: tagIds });
  }

  return (
    <div className="tag-pickers">
      {categories.map((category) => {
        const chosen = selection[category.id] ?? [];
        return category.multiSelect ? (
          <MultiSelectPicker
            key={category.id}
            category={category}
            chosen={chosen}
            disabled={disabled}
            onChange={(tagIds) => set(category.id, tagIds)}
          />
        ) : (
          <label key={category.id} className="tag-picker">
            <span>{category.name}</span>
            <select
              value={chosen[0] ?? ""}
              disabled={disabled}
              onChange={(event) => set(category.id, event.target.value === "" ? [] : [Number(event.target.value)])}
            >
              <option value="">(none)</option>
              {category.tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          </label>
        );
      })}
    </div>
  );
}

interface MultiSelectProps {
  category: Category;
  chosen: number[];
  disabled: boolean;
  onChange: (tagIds: number[]) => void;
}

/** A button showing the chosen tags, which opens a check-list. */
function MultiSelectPicker({ category, chosen, disabled, onChange }: MultiSelectProps) {
  /** Where the open check-list sits. It is positioned on the window, so the scrolling new-note area can't clip it. */
  const [position, setPosition] = useState<{ left: number; bottom: number }>();
  const open = position !== undefined;
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const names = category.tags.filter((tag) => chosen.includes(tag.id)).map((tag) => tag.name);
  const listId = `tag-picker-${category.id}`;

  function toggleOpen() {
    const rect = buttonRef.current?.getBoundingClientRect();
    // Opens upwards, as the new-note area is at the bottom of the screen.
    setPosition(open || !rect ? undefined : { left: rect.left, bottom: window.innerHeight - rect.top + 4 });
  }

  // Close when clicking elsewhere, pressing Escape, scrolling or resizing.
  useEffect(() => {
    if (!open) return;
    const close = () => setPosition(undefined);
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

  function toggle(tagId: number, checked: boolean) {
    onChange(checked ? [...chosen, tagId] : chosen.filter((id) => id !== tagId));
  }

  return (
    <div className="tag-picker" ref={rootRef}>
      <span id={`${listId}-label`}>{category.name}</span>
      <button
        ref={buttonRef}
        type="button"
        className="multi-select-button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-labelledby={`${listId}-label`}
        aria-controls={listId}
        disabled={disabled}
        onClick={toggleOpen}
      >
        {names.length > 0 ? names.join(", ") : "(none)"}
      </button>
      {open && (
        <div
          className="multi-select-list"
          id={listId}
          role="group"
          aria-labelledby={`${listId}-label`}
          style={{ left: position.left, bottom: position.bottom }}
        >
          {category.tags.map((tag) => (
            <label key={tag.id}>
              <input
                type="checkbox"
                checked={chosen.includes(tag.id)}
                onChange={(event) => toggle(tag.id, event.target.checked)}
              />
              {tag.name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
