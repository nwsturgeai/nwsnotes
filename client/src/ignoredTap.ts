/** How long a button flashes red when a finger tap on it is ignored in stylus mode. */
export const IGNORED_TAP_FLASH_MS = 500;

const timers = new WeakMap<Element, number>();

/**
 * Flashes the button (or other control) that a finger tap was ignored on, in stylus mode: its background
 * goes red for half a second, so it's clear the tap was seen but did nothing. Another ignored tap during
 * the flash starts it again.
 */
export function flashIgnoredTap(target: EventTarget | null) {
  const element = target instanceof Element ? target.closest("button, [role='menuitem']") : null;
  if (!element) return;
  window.clearTimeout(timers.get(element));
  element.classList.add("ignored-tap");
  timers.set(
    element,
    window.setTimeout(() => {
      element.classList.remove("ignored-tap");
      timers.delete(element);
    }, IGNORED_TAP_FLASH_MS),
  );
}
