import { isLongForm, type Category, type Note } from "@nwsnotes/shared";

/**
 * The filter row's "Properties" dropdown: rules about a note itself rather than its tags. It's shown
 * with the tag dropdowns' own component, as a made-up category whose "tags" are the rules. Its id is
 * never a real category's (user categories start at 1, Lifetime is -1).
 */
export const PROPERTIES_CATEGORY_ID = -1000;

export const PROPERTY_LONG_FORM = 1;
export const PROPERTY_DUE_SET = 2;
export const PROPERTY_DUE_TODAY = 3;
export const PROPERTY_OVERDUE = 4;
export const PROPERTY_HAS_PARENT = 5;

export const PROPERTIES_CATEGORY: Category = {
  id: PROPERTIES_CATEGORY_ID,
  name: "Properties",
  multiSelect: true,
  tags: [
    { id: PROPERTY_LONG_FORM, name: "Long-form" },
    { id: PROPERTY_HAS_PARENT, name: "Has a parent note" },
    { id: PROPERTY_DUE_SET, name: "Due date set" },
    { id: PROPERTY_DUE_TODAY, name: "Due today" },
    { id: PROPERTY_OVERDUE, name: "Overdue" },
  ],
};

/** The next local midnight after `now` (ms). */
function nextMidnight(now: number): number {
  const date = new Date(now);
  date.setHours(24, 0, 0, 0);
  return date.getTime();
}

/** Whether a note passes one property rule, at time `now` (ms). */
export function noteHasProperty(note: Note, property: number, now: number): boolean {
  const due = note.dueDateTime === undefined ? undefined : Date.parse(note.dueDateTime);
  switch (property) {
    case PROPERTY_LONG_FORM:
      return isLongForm(note);
    case PROPERTY_HAS_PARENT:
      return note.parentId !== undefined;
    case PROPERTY_DUE_SET:
      return due !== undefined;
    case PROPERTY_DUE_TODAY:
      return due !== undefined && due < nextMidnight(now);
    case PROPERTY_OVERDUE:
      return due !== undefined && due < now;
    default:
      return false;
  }
}

/**
 * Each rule's box goes empty, ticked, crossed, then empty again. A ticked rule's id is stored as it is,
 * a crossed one's as its negative (-1 for "not long-form").
 *
 * With nothing ticked every note passes; otherwise any ticked rule will do, like the tag dropdowns. A
 * crossed rule then leaves out every note it matches.
 */
export function noteMatchesProperties(note: Note, properties: number[], now: number): boolean {
  const ticked = properties.filter((id) => id > 0);
  return (
    (ticked.length === 0 || ticked.some((property) => noteHasProperty(note, property, now))) &&
    !properties.some((id) => id < 0 && noteHasProperty(note, -id, now))
  );
}

/** The ticked and crossed rules that still exist, in the dropdown's order (a rule is never both). */
export function validProperties(chosen: number[] | undefined): number[] {
  return PROPERTIES_CATEGORY.tags.flatMap((tag) => (chosen?.includes(tag.id) ? [tag.id] : chosen?.includes(-tag.id) ? [-tag.id] : []));
}
