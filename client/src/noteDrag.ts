import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

/** How close (px) to the list's top or bottom edge the pointer must be to scroll it, and how fast (px per frame). */
const EDGE = 40;
const SCROLL_SPEED = 10;

/** A note being dragged, as the list draws it. */
export interface NoteDrag {
  noteId: number;
  /** Where the gap is: the index among the other listed notes that the dragged note would take. */
  target: number;
  /** The dragged note follows the pointer at a fixed position (viewport coordinates). */
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Another note's place when the drag started, in the list's scrolled content coordinates. */
interface Slot {
  left: number;
  mid: number;
}

interface Active {
  noteId: number;
  pointerId: number;
  grip: HTMLElement;
  /** The dragged note's index among all listed notes, i.e. its target if it isn't moved. */
  start: number;
  others: Slot[];
  /** Pointer position within the dragged note, so it doesn't jump when picked up. */
  grabY: number;
  left: number;
  width: number;
  height: number;
  clientX: number;
  clientY: number;
  target: number;
  frame: number;
}

/**
 * Dragging notes by their grips to reorder a list. The list items need `data-note-id`. Drop points are
 * worked out from where the notes were when the drag started, so the gap opening (and columns
 * re-balancing) doesn't move them. The list scrolls when the pointer is near its top or bottom edge.
 * `onDrop` gets the dragged note and the index among the other listed notes where it was dropped; it
 * isn't called if the note is dropped where it started, or the drag is cancelled (Escape).
 */
export function useNoteDrag(listRef: RefObject<HTMLElement | null>, onDrop: (noteId: number, target: number) => void) {
  const [drag, setDrag] = useState<NoteDrag>();
  const active = useRef<Active>(undefined);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  function show(a: Active) {
    setDrag({ noteId: a.noteId, target: a.target, top: a.clientY - a.grabY, left: a.left, width: a.width, height: a.height });
  }

  /** The index among the other notes where the pointer would drop the note. */
  function targetAt(a: Active, list: HTMLElement): number {
    const x = a.clientX;
    const y = a.clientY + list.scrollTop;
    // Notes in the same column share a left edge; pick the column the pointer is over.
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
    setDrag(undefined);
    if (drop && a.target !== a.start) onDropRef.current(a.noteId, a.target);
  }

  function startDrag(event: ReactPointerEvent<HTMLElement>, noteId: number) {
    const list = listRef.current;
    if (!list || active.current || event.button !== 0) return;
    const items = [...list.querySelectorAll<HTMLElement>("li[data-note-id]")];
    const start = items.findIndex((item) => Number(item.dataset.noteId) === noteId);
    const dragged = items[start];
    if (!dragged) return;
    event.preventDefault();
    const grip = event.currentTarget;
    grip.setPointerCapture(event.pointerId);

    const scroll = list.scrollTop;
    const rect = dragged.getBoundingClientRect();
    const others = items
      .filter((_, index) => index !== start)
      .map((item) => {
        const r = item.getBoundingClientRect();
        return { left: Math.round(r.left), mid: (r.top + r.bottom) / 2 + scroll };
      });
    const a: Active = {
      noteId,
      pointerId: event.pointerId,
      grip,
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
    };
    active.current = a;
    show(a);

    // Scroll near the edges, every frame while dragging (the pointer may be held still there).
    const tick = () => {
      const current = active.current;
      if (current !== a) return;
      const bounds = list.getBoundingClientRect();
      const before = list.scrollTop;
      if (a.clientY < bounds.top + EDGE) list.scrollTop -= SCROLL_SPEED;
      else if (a.clientY > bounds.bottom - EDGE) list.scrollTop += SCROLL_SPEED;
      if (list.scrollTop !== before) {
        a.target = targetAt(a, list);
        show(a);
      }
      a.frame = requestAnimationFrame(tick);
    };
    a.frame = requestAnimationFrame(tick);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const a = active.current;
    const list = listRef.current;
    if (!a || !list || event.pointerId !== a.pointerId) return;
    a.clientX = event.clientX;
    a.clientY = event.clientY;
    a.target = targetAt(a, list);
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

  /** Handlers for a note's grip. */
  const gripHandlers = (noteId: number) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => startDrag(event, noteId),
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  });

  return { drag, gripHandlers };
}
