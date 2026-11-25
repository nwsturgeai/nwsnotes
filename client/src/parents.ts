import { descendantIds, isLongForm, lifetimeOf, LIFETIME_BIN, orderNotes, withoutMarkers, type Category, type Note } from "@nwsnotes/shared";

/**
 * The filter row's "Long-form" dropdown: one option per long-form note in the tab, each child long-form
 * note indented under its parent. It's shown with the tag dropdowns' own component, as a made-up category
 * whose "tags" are the long-form notes (their ids as tag ids). Its ticks are kept with the row's other
 * choices under this id, which is never a real category's (user categories start at 1, Lifetime is -1,
 * Properties is -1000).
 */
export const LONG_FORM_FILTER_ID = -1001;

/** A note's title as pills and lists show it: formatting markers taken out, and cut to `max` characters with "…". */
export function shortTitle(note: Note, max: number): string {
  const title = withoutMarkers(note.titleText ?? "");
  return title.length > max ? `${title.slice(0, max - 1)}…` : title;
}

/** A long-form note in a tree: how many parents above it are in the same list. */
export interface TreeEntry {
  note: Note;
  depth: number;
}

/**
 * Long-form notes as a tree, in the notes' shared order: each note followed by the long-form notes under
 * it (indented one more level). A note whose parent isn't among `longForms` is at the top level.
 */
export function longFormTree(longForms: Note[], noteOrder: number[]): TreeEntry[] {
  const ordered = orderNotes(longForms, noteOrder);
  const ids = new Set(ordered.map((note) => note.id));
  const children = new Map<number, Note[]>();
  for (const note of ordered) {
    if (note.parentId !== undefined && ids.has(note.parentId)) children.set(note.parentId, [...(children.get(note.parentId) ?? []), note]);
  }
  const tree: TreeEntry[] = [];
  const placed = new Set<number>();
  const visit = (note: Note, depth: number) => {
    if (placed.has(note.id)) return;
    placed.add(note.id);
    tree.push({ note, depth });
    for (const child of children.get(note.id) ?? []) visit(child, depth + 1);
  };
  for (const note of ordered) if (note.parentId === undefined || !ids.has(note.parentId)) visit(note, 0);
  // Anything left over would be in a loop (the server never allows one): listed at the top level anyway.
  for (const note of ordered) visit(note, 0);
  return tree;
}

/** The made-up category the Long-form dropdown shows: its "tags" are the tree's notes. Other people's notes say whose. */
export function longFormCategory(tree: TreeEntry[]): Category {
  return {
    id: LONG_FORM_FILTER_ID,
    name: "Long-form",
    multiSelect: true,
    tags: tree.map(({ note }) => ({
      id: note.id,
      name: shortTitle(note, 40),
      ...(note.shared && { ownerName: note.shared.ownerName }),
    })),
  };
}

/**
 * The Long-form filter's ticks after one option is ticked or unticked. Ticking a note also ticks every
 * long-form note under it (shown ticked and locked, not stored), so a note under it is never stored
 * as ticked itself; unticking a note unticks them all.
 */
export function toggleLongFormTick(notes: Note[], ticked: number[], noteId: number, tick: boolean): number[] {
  if (!tick) return ticked.filter((id) => id !== noteId);
  const below = descendantIds(notes, noteId);
  return [...ticked.filter((id) => !below.has(id)), noteId];
}

/** Every note shown while these long-form notes are ticked: them, and everything under them (all the way down). */
export function treeNoteIds(notes: Note[], ticked: number[]): Set<number> {
  const ids = new Set<number>();
  for (const id of ticked) {
    ids.add(id);
    for (const below of descendantIds(notes, id)) ids.add(below);
  }
  return ids;
}

/** A long-form note's direct child notes, leaving out those in the Bin. */
export function childNotes(notes: Note[], parentId: number): Note[] {
  return notes.filter((note) => note.parentId === parentId && lifetimeOf(note) !== LIFETIME_BIN);
}

/** Long-form notes that can be parents: every one not in the Bin. */
export function possibleParents(notes: Note[]): Note[] {
  return notes.filter((note) => isLongForm(note) && lifetimeOf(note) !== LIFETIME_BIN);
}
