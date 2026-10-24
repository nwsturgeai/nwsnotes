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
}

interface Point {
  x: number;
  y: number;
}

/**
 * A canvas to write a note on. Only a stylus (or a mouse, for testing on a computer) draws;
 * fingers and palms are ignored.
 */
export function StylusPad({ ref, disabled, onInk }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** The stroke being drawn: which pointer, and where it last was. */
  const stroke = useRef<{ pointerId: number; last: Point }>(undefined);
  /** The area written on so far, in CSS pixels. */
  const bounds = useRef<{ minX: number; minY: number; maxX: number; maxY: number }>(undefined);

  function clear() {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    bounds.current = undefined;
    stroke.current = undefined;
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

  // Keep the canvas's pixel size matched to its box. A size change (e.g. rotating the device) clears it.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const resize = () => {
      const width = Math.round(canvas.clientWidth * INK_SCALE);
      const height = HEIGHT * INK_SCALE;
      if (canvas.width === width && canvas.height === height) return;
      // Setting the size also wipes the canvas.
      canvas.width = width;
      canvas.height = height;
      bounds.current = undefined;
      stroke.current = undefined;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
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
      className="stylus-pad"
      role="img"
      aria-label="Writing area for a new note"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endStroke}
      onPointerCancel={endStroke}
      onLostPointerCapture={endStroke}
      onContextMenu={(event) => event.preventDefault()}
    />
  );
}
