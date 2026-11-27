import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGripVertical } from "@fortawesome/free-solid-svg-icons";

/*
 * Reordering a list by dragging its rows by their grips: the note list in edit-order mode, the
 * categories and tabs in Settings, and the tags on a category's page all use this, so they behave alike.
 */

/** How close (px) to the scrolling area's top or bottom edge the pointer must be to scroll it, and how fast (px per frame). */
const EDGE = 40;
const SCROLL_SPEED = 10;

/** A row being dragged, as the list draws it. */
export interface ListDrag {
  id: number;
  /** Where the gap is: the index among the other draggable rows that the dragged row would take. */
  target: number;
  /** The dragged row follows the pointer at a fixed position (viewport coordinates). */
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Another row's place when the drag started, in the scrolling area's content coordinates. */
interface Slot {
  left: number;
  mid: number;
}

interface Active {
  id: number;
  pointerId: number;
  grip: HTMLElement;
  /** What scrolls: the list itself (the note list) or the page around it (Settings). */
  scroller: HTMLElement;
  /** The dragged row's index among all draggable rows, i.e. its target if it isn't moved. */
  start: number;
  others: Slot[];
  /** Pointer position within the dragged row, so it doesn't jump when picked up. */
  grabY: number;
  left: number;
  width: number;
  height: number;
  clientX: number;
  clientY: number;
  target: number;
  frame: number;
  /** The drop zone outside the list the pointer is over (see `DropZones`), if any. */
  zone: HTMLElement | undefined;
}

/**
 * Places outside the list a row can be dropped on (the tabs, for notes): elements matching `selector`.
 * While the pointer is over one it gets the `drop-target` class and the gap goes back to where the row
 * started; letting go there calls `onDrop` with the row's id and that element instead of reordering.
 */
export interface DropZones {
  selector: string;
  onDrop: (id: number, zone: HTMLElement) => void;
}

/** The drop zone under the point, looking past the dragged row (which follows the pointer). */
function zoneAt(selector: string, x: number, y: number): HTMLElement | undefined {
  for (const element of document.elementsFromPoint(x, y)) {
    const zone = element.closest<HTMLElement>(selector);
    if (zone) return zone;
  }
  return undefined;
}

/** The nearest element that scrolls up and down, from `element` outwards (the page itself if none). */
function scrollerOf(element: HTMLElement): HTMLElement {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/** The part of the screen a scroller shows (the whole window for the page itself). */
function visibleBounds(scroller: HTMLElement): { top: number; bottom: number } {
  if (scroller === document.scrollingElement || scroller === document.documentElement) return { top: 0, bottom: window.innerHeight };
  const rect = scroller.getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom };
}

/**
 * Dragging rows by their grips to reorder a list. The draggable rows are the list's elements matching
 * `itemSelector`, each identified by `idOf`; other rows (e.g. "All", which can't move) are left out, so
 * nothing can be dropped beyond them. Drop points are worked out from where the rows were when the drag
 * started, so the gap opening (and columns re-balancing) doesn't move them. The list, or the page around
 * it, scrolls when the pointer is near the top or bottom edge. `onDrop` gets the dragged row's id and the
 * index among the other draggable rows where it was dropped; it isn't called if the row is dropped where
 * it started, or the drag is cancelled (Escape).
 */
export function useListDrag(
  listRef: RefObject<HTMLElement | null>,
  onDrop: (id: number, target: number) => void,
  itemSelector = "[data-drag-id]",
  idOf: (item: HTMLElement) => number = (item) => Number(item.dataset.dragId),
  zones?: DropZones,
) {
  const [drag, setDrag] = useState<ListDrag>();
  const active = useRef<Active>(undefined);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  const zonesRef = useRef(zones);
  zonesRef.current = zones;

  /** Notes which drop zone the pointer is over (none if `clear`), marking it. */
  function updateZone(a: Active, clear = false) {
    const selector = zonesRef.current?.selector;
    const zone = clear || !selector ? undefined : zoneAt(selector, a.clientX, a.clientY);
    if (zone === a.zone) return;
    a.zone?.classList.remove("drop-target");
    zone?.classList.add("drop-target");
    a.zone = zone;
  }

  function show(a: Active) {
    setDrag({ id: a.id, target: a.target, top: a.clientY - a.grabY, left: a.left, width: a.width, height: a.height });
  }

  /** The index among the other rows where the pointer would drop the dragged one. */
  function targetAt(a: Active): number {
    const x = a.clientX;
    const y = a.clientY + a.scroller.scrollTop;
    // Rows in the same column share a left edge; pick the column the pointer is over.
    const columns = [...new Set(a.others.map((slot) => slot.left))].sort((p, q) => p - q);
    if (columns.length === 0) return 0;
    const column = columns.filter((left) => left <= x).pop() ?? columns[0];
    let last = -1;
    for (const [i, slot] of a.others.entries()) {
      if (slot.left !== column) continue;
      if (slot.mid > y) return i;
      last = i;
    }
    return last + 1;
  }

  function end(drop: boolean) {
    const a = active.current;
    if (!a) return;
    active.current = undefined;
    cancelAnimationFrame(a.frame);
    if (a.grip.hasPointerCapture(a.pointerId)) a.grip.releasePointerCapture(a.pointerId);
    const zone = a.zone;
    updateZone(a, true);
    setDrag(undefined);
    if (drop && zone) zonesRef.current?.onDrop(a.id, zone);
    else if (drop && a.target !== a.start) onDropRef.current(a.id, a.target);
  }

  function startDrag(event: ReactPointerEvent<HTMLElement>, id: number) {
    const list = listRef.current;
    if (!list || active.current || event.button !== 0) return;
    const items = [...list.querySelectorAll<HTMLElement>(itemSelector)];
    const start = items.findIndex((item) => idOf(item) === id);
    const dragged = items[start];
    if (!dragged) return;
    event.preventDefault();
    const grip = event.currentTarget;
    grip.setPointerCapture(event.pointerId);

    const scroller = scrollerOf(list);
    const scroll = scroller.scrollTop;
    const rect = dragged.getBoundingClientRect();
    const others = items
      .filter((_, index) => index !== start)
      .map((item) => {
        const r = item.getBoundingClientRect();
        return { left: Math.round(r.left), mid: (r.top + r.bottom) / 2 + scroll };
      });
    const a: Active = {
      id,
      pointerId: event.pointerId,
      grip,
      scroller,
      start,
      others,
      grabY: event.clientY - rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      clientX: event.clientX,
      clientY: event.clientY,
      target: start,
      frame: 0,
      zone: undefined,
    };
    active.current = a;
    show(a);

    // Scroll near the edges, every frame while dragging (the pointer may be held still there).
    const tick = () => {
      if (active.current !== a) return;
      // Not while over a drop zone (the tabs are near the list's top edge).
      if (a.zone) {
        a.frame = requestAnimationFrame(tick);
        return;
      }
      const bounds = visibleBounds(scroller);
      const before = scroller.scrollTop;
      if (a.clientY < bounds.top + EDGE) scroller.scrollTop -= SCROLL_SPEED;
      else if (a.clientY > bounds.bottom - EDGE) scroller.scrollTop += SCROLL_SPEED;
      if (scroller.scrollTop !== before) {
        a.target = targetAt(a);
        show(a);
      }
      a.frame = requestAnimationFrame(tick);
    };
    a.frame = requestAnimationFrame(tick);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const a = active.current;
    if (!a || event.pointerId !== a.pointerId) return;
    a.clientX = event.clientX;
    a.clientY = event.clientY;
    updateZone(a);
    a.target = a.zone ? a.start : targetAt(a);
    show(a);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLElement>) {
    if (active.current?.pointerId === event.pointerId) end(true);
  }

  function onPointerCancel(event: ReactPointerEvent<HTMLElement>) {
    if (active.current?.pointerId === event.pointerId) end(false);
  }

  // Escape cancels a drag.
  useEffect(() => {
    if (!drag) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        end(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  // A drag in progress when the list goes away (e.g. leaving the page) just stops.
  useEffect(() => () => end(false), []);

  /** Handlers for a row's grip. */
  const gripHandlers = (id: number) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => startDrag(event, id),
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  });

  return { drag, gripHandlers };
}

/**
 * The rows to draw while dragging: the dragged row stays among its original neighbours (so it isn't
 * re-created mid-drag; it's drawn following the pointer), with a gap where it would go.
 */
export function rowsWithGap<T>(items: T[], idOf: (item: T) => number, drag: ListDrag | undefined): ({ item: T } | { gap: number })[] {
  const rows: ({ item: T } | { gap: number })[] = items.map((item) => ({ item }));
  if (!drag) return rows;
  const start = items.findIndex((item) => idOf(item) === drag.id);
  if (start < 0) return rows;
  const [dragged] = rows.splice(start, 1);
  rows.splice(drag.target, 0, { gap: drag.height });
  rows.splice(drag.target <= start ? start + 1 : start, 0, dragged!);
  return rows;
}

/** The style that makes the dragged row follow the pointer. */
export function draggedStyle(drag: ListDrag) {
  return { top: drag.top, left: drag.left, width: drag.width, height: drag.height };
}

/** A row's grip (`fa-grip-vertical`), at its left. */
export function DragGrip({ label, handlers }: { label: string; handlers: ReturnType<ReturnType<typeof useListDrag>["gripHandlers"]> }) {
  return (
    <span className="drag-grip" title="Drag to reorder" aria-label={label} role="img" {...handlers}>
      <FontAwesomeIcon icon={faGripVertical} />
    </span>
  );
}
