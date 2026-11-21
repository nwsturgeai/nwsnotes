import type { RefObject } from "react";
import { useListDrag, type ListDrag } from "./listDrag";

/** A note being dragged, as the list draws it. */
export interface NoteDrag extends ListDrag {
  noteId: number;
}

/**
 * Dragging notes by their grips in edit-order mode: the shared list drag (see listDrag.tsx), with the
 * note list's items identified by `data-note-id`. The note list itself is what scrolls.
 */
export function useNoteDrag(listRef: RefObject<HTMLElement | null>, onDrop: (noteId: number, target: number) => void) {
  const { drag, gripHandlers } = useListDrag(listRef, onDrop, "li[data-note-id]", (item) => Number(item.dataset.noteId));
  const noteDrag: NoteDrag | undefined = drag && { ...drag, noteId: drag.id };
  return { drag: noteDrag, gripHandlers };
}
