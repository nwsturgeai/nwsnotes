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

export const PROPERTIES_CATEGORY: Category = {
  id: PROPERTIES_CATEGORY_ID,
  name: "Properties",
  multiSelect: true,
  tags: [
    { id: PROPERTY_LONG_FORM, name: "Long-form" },
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

/** Like the tag dropdowns: with nothing ticked every note passes; otherwise any ticked rule will do. */
export function noteMatchesProperties(note: Note, properties: number[], now: number): boolean {
  return properties.length === 0 || properties.some((property) => noteHasProperty(note, property, now));
}

/** The ticked rules that still exist, in the dropdown's order. */
export function validProperties(chosen: number[] | undefined): number[] {
  return PROPERTIES_CATEGORY.tags.map((tag) => tag.id).filter((id) => (chosen ?? []).includes(id));
}
