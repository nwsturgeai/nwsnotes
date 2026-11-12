import { LIFETIME_ARCHIVED, LIFETIME_WAITING, lifetimeOf, type Category, type Note } from "@nwsnotes/shared";

/**
 * Tag colours. A tag's hue (in degrees) is shown in several shades, each a saturation and value
 * (HSV, as in the spec) drawn as the matching CSS hsl() colour.
 */

/** Saturation and value (0-1) for each place a hue is shown. */
const SHADES = {
  /** The boxes on the settings and category pages. */
  swatch: { s: 1, v: 1 },
  /** Notes that are New or Active. */
  active: { s: 0.18, v: 1 },
  waiting: { s: 0.25, v: 0.8 },
  archived: { s: 0.3, v: 0.65 },
} as const;

export type Shade = keyof typeof SHADES;

/** A hue in one of the shades, as a CSS colour. */
export function hueColour(hue: number, shade: Shade): string {
  const { s, v } = SHADES[shade];
  // HSV to HSL: same hue; lightness and HSL saturation from the value and HSV saturation.
  const l = v * (1 - s / 2);
  const sl = l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l);
  return `hsl(${hue} ${Math.round(sl * 1000) / 10}% ${Math.round(l * 1000) / 10}%)`;
}

/** The hue a note is tinted with: from the first of its tags that has one, in category then tag order. */
export function noteHue(note: Note, categories: Category[]): number | undefined {
  for (const category of categories) {
    for (const tag of category.tags) {
      if (tag.hue !== undefined && note.tagIds.includes(tag.id)) return tag.hue;
    }
  }
  return undefined;
}

/** A tinted note's background for its Lifetime (Bin notes are never tinted). */
export function noteBackground(note: Note, hue: number): string {
  const lifetime = lifetimeOf(note);
  return hueColour(hue, lifetime === LIFETIME_WAITING ? "waiting" : lifetime === LIFETIME_ARCHIVED ? "archived" : "active");
}
