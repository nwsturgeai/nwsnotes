import { useEffect, useImperativeHandle, useRef, type PointerEvent as ReactPointerEvent, type Ref } from "react";

/** The canvas works at this many pixels per CSS pixel; saved images are shown at 1/INK_SCALE of their pixel size. */
export const INK_SCALE = 2;
/** Canvas height in CSS pixels. */
const HEIGHT = 80;
const LINE_WIDTH = 2.5;
/** Space kept around the writing when cropping, in CSS pixels. */
const CROP_MARGIN = 4;

export interface StylusPadHandle {
  /** True once anything has been written. */
  hasInk(): boolean;
  /** The writing as a PNG data URL, cropped to what was written plus a small margin. */
  toImage(): string;
  clear(): void;
}

interface Props {
  ref: Ref<StylusPadHandle>;
  disabled: boolean;
  /** Called when a new stroke starts. */
  onInk?: () => void;
  /** A handwritten note's image (PNG data URL) to start from, when editing it. */
  initialImage?: string;
  /**
   * Fill the height of its box (a long-form note's details) instead of the usual 80px. A size change
   * then keeps what's written (cut off if it no longer fits) rather than clearing it.
   */
  fill?: boolean;
  label?: string;
}

interface Point {
  x: number;
  y: number;
}

/** A copy of a canvas's current pixels. */
function copyOf(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const copy = document.createElement("canvas");
  copy.width = canvas.width;
  copy.height = canvas.height;
  copy.getContext("2d")!.drawImage(canvas, 0, 0);
  return copy;
}

/**
 * A canvas to write a note on. Only a stylus (or a mouse, for testing on a computer) draws;
 * fingers and palms are ignored.
 */
export function StylusPad({ ref, disabled, onInk, initialImage, fill, label = "Writing area for a new note" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** The stroke being drawn: which pointer, and where it last was. */
  const stroke = useRef<{ pointerId: number; last: Point }>(undefined);
  /** The area written on so far, in CSS pixels. */
  const bounds = useRef<{ minX: number; minY: number; maxX: number; maxY: number }>(undefined);
  /** True once anything has been drawn or cleared since `initialImage` was loaded. */
  const changedSinceLoad = useRef(false);

  function clear() {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    bounds.current = undefined;
    stroke.current = undefined;
    changedSinceLoad.current = true;
  }

  /**
   * Draws a saved image at the top-left of the canvas, at the size it was written,
   * or shrunk to fit if it's wider than the canvas (so nothing is lost on Update).
   */
  function loadImage(dataUrl: string) {
    const image = new Image();
    image.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas || changedSinceLoad.current) return;
      const scale = Math.min(1, canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      const context = canvas.getContext("2d")!;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, width, height);
      // The saved image already includes the crop margin, so the writing sits inside it;
      // this keeps the image the same size if it's updated without changes.
      const margin = CROP_MARGIN * scale;
      const right = width / INK_SCALE;
      const bottom = height / INK_SCALE;
      bounds.current = {
        minX: Math.min(margin, right / 2),
        minY: Math.min(margin, bottom / 2),
        maxX: Math.max(right - margin, right / 2),
        maxY: Math.max(bottom - margin, bottom / 2),
      };
    };
    image.src = dataUrl;
  }

  useImperativeHandle(ref, () => ({
    hasInk: () => bounds.current !== undefined,
    toImage: () => {
      const canvas = canvasRef.current!;
      const b = bounds.current!;
      const left = Math.max(0, Math.floor((b.minX - CROP_MARGIN) * INK_SCALE));
      const top = Math.max(0, Math.floor((b.minY - CROP_MARGIN) * INK_SCALE));
      const right = Math.min(canvas.width, Math.ceil((b.maxX + CROP_MARGIN) * INK_SCALE));
      const bottom = Math.min(canvas.height, Math.ceil((b.maxY + CROP_MARGIN) * INK_SCALE));
      const cropped = document.createElement("canvas");
      cropped.width = right - left;
      cropped.height = bottom - top;
      cropped.getContext("2d")!.drawImage(canvas, left, top, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
      return cropped.toDataURL("image/png");
    },
    clear,
  }));

  // Keep the canvas's pixel size matched to its box. A size change (e.g. rotating the device) clears
  // any new writing; a note being edited is reloaded if it hasn't been changed yet.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const resize = () => {
      const width = Math.round(canvas.clientWidth * INK_SCALE);
      const height = Math.round((fill ? canvas.clientHeight : HEIGHT) * INK_SCALE);
      if (canvas.width === width && canvas.height === height) return;
      // A filling pad keeps its drawing across size changes; copy it before resizing wipes it.
      const keep = fill && changedSinceLoad.current && bounds.current && canvas.width > 0 ? copyOf(canvas) : undefined;
      // Setting the size also wipes the canvas.
      canvas.width = width;
      canvas.height = height;
      stroke.current = undefined;
      if (keep) {
        canvas.getContext("2d")!.drawImage(keep, 0, 0);
        return;
      }
      bounds.current = undefined;
      if (initialImage && !changedSinceLoad.current) loadImage(initialImage);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
    // The pad is remounted (keyed) for each note it edits, so this runs once per image.
  }, []);

  function pen(): CanvasRenderingContext2D {
    const context = canvasRef.current!.getContext("2d")!;
    context.setTransform(INK_SCALE, 0, 0, INK_SCALE, 0, 0);
    context.strokeStyle = "#000";
    context.fillStyle = "#000";
    context.lineWidth = LINE_WIDTH;
    context.lineCap = "round";
    context.lineJoin = "round";
    return context;
  }

  function include(point: Point) {
    const r = LINE_WIDTH / 2;
    const b = bounds.current;
    bounds.current = {
      minX: Math.min(b?.minX ?? Infinity, point.x - r),
      minY: Math.min(b?.minY ?? Infinity, point.y - r),
      maxX: Math.max(b?.maxX ?? -Infinity, point.x + r),
      maxY: Math.max(b?.maxY ?? -Infinity, point.y + r),
    };
  }

  /** A pointer position in the canvas's drawing area (inside its border), in CSS pixels. */
  function pointOf(event: { clientX: number; clientY: number }): Point {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left - canvas.clientLeft, y: event.clientY - rect.top - canvas.clientTop };
  }

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    // Fingers and palms don't draw; nor do other mouse buttons.
    if (disabled || event.pointerType === "touch" || event.button !== 0 || stroke.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointOf(event);
    // A dot, so a tap without moving still leaves a mark.
    const context = pen();
    context.beginPath();
    context.arc(point.x, point.y, LINE_WIDTH / 2, 0, Math.PI * 2);
    context.fill();
    include(point);
    stroke.current = { pointerId: event.pointerId, last: point };
    changedSinceLoad.current = true;
    onInk?.();
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const current = stroke.current;
    if (!current || event.pointerId !== current.pointerId) return;
    // Coalesced events give every point the stylus passed over since the last event, for smoother lines.
    const events = event.nativeEvent.getCoalescedEvents?.() ?? [];
    const points = (events.length > 0 ? events : [event]).map(pointOf);
    const context = pen();
    context.beginPath();
    context.moveTo(current.last.x, current.last.y);
    for (const point of points) {
      context.lineTo(point.x, point.y);
      include(point);
    }
    context.stroke();
    current.last = points.at(-1)!;
  }

  function endStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (stroke.current?.pointerId === event.pointerId) stroke.current = undefined;
  }

  return (
    <canvas
      ref={canvasRef}
      className={fill ? "stylus-pad fill" : "stylus-pad"}
      role="img"
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endStroke}
      onPointerCancel={endStroke}
      onLostPointerCapture={endStroke}
      onContextMenu={(event) => event.preventDefault()}
    />
  );
}
