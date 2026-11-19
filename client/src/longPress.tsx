import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

/** How long a button must be held for a long press. */
const LONG_PRESS_MS = 1000;
/** The buzz when a long press is reached. */
const HOLD_BUZZ_MS = 40;

/**
 * A button that does something different when held for a second (a long press) rather than clicked:
 * Add (adds at the top of the tab) and multi-select (starts with every note selected).
 *
 * While the button is held, a ring fills round it; once it's been held long enough, rings burst out
 * from it, beyond the finger, and the device buzzes where it can. The rings are drawn on the screen,
 * centred on the button, so the area it's in can't cut them off.
 *
 * Spread `handlers` on the button, call `takeLongPress` from its click handler (it says whether that
 * click ends a long press), and render `rings` anywhere. With `enabled` false, presses are just clicks.
 */
export function useLongPress(enabled: boolean) {
  /** The button has been held long enough: letting go is a long press. */
  const [held, setHeldState] = useState(false);
  const heldRef = useRef(false);
  const pressing = useRef(false);
  const timer = useRef<number>(undefined);
  /** While pressed (and enabled): the button's centre and size on the screen, where the rings are drawn. */
  const [ring, setRing] = useState<{ x: number; y: number; size: number }>();

  function setHeld(next: boolean) {
    heldRef.current = next;
    setHeldState(next);
  }

  function endHold() {
    window.clearTimeout(timer.current);
    pressing.current = false;
    setRing(undefined);
  }

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Refs, not state, decide the click: the pointer events come first.
  const handlers = {
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      endHold();
      setHeld(false);
      if (event.button !== 0 || !enabled) return;
      pressing.current = true;
      const rect = event.currentTarget.getBoundingClientRect();
      setRing({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, size: rect.width });
      timer.current = window.setTimeout(() => {
        setHeld(true);
        // A short buzz too, where the device can (Android; iPhones can't).
        if ("vibrate" in navigator) navigator.vibrate(HOLD_BUZZ_MS);
      }, LONG_PRESS_MS);
    },
    onPointerUp: endHold,
    // Sliding off the button before letting go does nothing, so the long press is forgotten.
    onPointerLeave: () => {
      if (pressing.current) setHeld(false);
      endHold();
    },
    onPointerCancel: () => {
      setHeld(false);
      endHold();
    },
    // Android's long-press menu would otherwise open over the button.
    onContextMenu: (event: ReactMouseEvent) => event.preventDefault(),
  };

  /**
   * For the button's click handler: whether this click ends a long press. Enter or Space (with no
   * pointer: detail 0) is never a long press.
   */
  function takeLongPress(event: ReactMouseEvent): boolean {
    const long = heldRef.current && event.detail > 0;
    setHeld(false);
    return long;
  }

  const rings = ring && (
    <span
      className={held ? "hold-ring held" : "hold-ring"}
      style={{ left: ring.x, top: ring.y, width: ring.size, height: ring.size }}
      aria-hidden
    >
      {held ? (
        <>
          <span className="hold-burst" />
          <span className="hold-burst second" />
        </>
      ) : (
        <svg className="hold-progress" viewBox="0 0 52 52">
          <circle cx="26" cy="26" r="24" pathLength={100} />
        </svg>
      )}
    </span>
  );

  return { held, handlers, takeLongPress, rings };
}
