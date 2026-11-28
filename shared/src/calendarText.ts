/*
 * Google Calendar (see Specs/google-calendar.md): the text of the events nwsnotes writes, and reading
 * back what was changed in Google. Hashtags carry a note's tags: a tag "Garden ideas" is #Garden_ideas.
 * Only imports the UK-time helpers, so it can be tested on its own.
 */
import { ukClock } from "./spokenDue";

/** How long an event made by nwsnotes lasts. May become a per-user setting. */
export const DEFAULT_EVENT_MINUTES = 15;

/** When a note from an all-day event is due, as a UK clock shows it. May become a per-user setting. */
export const ALL_DAY_DUE_HOUR = 20;
export const ALL_DAY_DUE_MINUTE = 0;

/** Whether a due date is at the all-day time (20:00, UK time): an all-day note stays all-day only then. */
export function isAllDayTime(dueDateTime: string): boolean {
  const clock = ukClock(new Date(dueDateTime));
  return clock.hour === ALL_DAY_DUE_HOUR && clock.minute === ALL_DAY_DUE_MINUTE;
}

/** When Google alerts for an all-day event: this time on the day itself, as a UK clock shows it. */
export const ALL_DAY_ALERT_HOUR = 9;

/** The event title of a note with a handwritten title. */
export const HANDWRITTEN_EVENT_TITLE = "Handwritten note";

/** The event description's body for a long-form note with handwritten details. */
export const HANDWRITTEN_EVENT_DESCRIPTION = "Handwritten description available in nwsnotes";

/** The note title for an event with no title. */
export const UNTITLED_EVENT = "(No title)";

/** A tag as a hashtag: "#" and its name, with spaces as underscores. */
export function hashtagOf(name: string): string {
  return `#${name.trim().replace(/\s+/g, "_")}`;
}

/** A tag's name, or a hashtag's text, for comparing: any case, underscores and spaces the same. */
function comparable(text: string): string {
  return text.replace(/_/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * A word's hashtag text (without the "#"), if it's a hashtag: "#" followed by anything but spaces and
 * "#", so "#urgent#" (a highlight) isn't one. A comma or full stop at the end is left out.
 */
export function hashtagText(word: string): string | undefined {
  const match = /^#([^\s#]+)$/.exec(word);
  if (!match) return undefined;
  const text = match[1]!.replace(/[.,]$/, "");
  return text === "" ? undefined : text;
}

/** The first of `tags` (in the order given: category order, then tag order) a hashtag's text names. */
export function tagForHashtag<T extends { name: string }>(text: string, tags: readonly T[]): T | undefined {
  const wanted = comparable(text);
  return tags.find((tag) => comparable(tag.name) === wanted);
}

/** Whether a hashtag's text and a tag's name are the same, as matching sees them. */
export function sameHashtag(a: string, b: string): boolean {
  return comparable(a) === comparable(b);
}

/** Whether a line is a tags line: at least one word, and every word a hashtag. */
export function isTagsLine(line: string): boolean {
  const words = line.trim().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((word) => hashtagText(word) !== undefined);
}

/**
 * An event's description, split into its tags line's words (as typed) and the body after it. Without
 * a tags line, it's all body (less one blank line at the start, which nwsnotes adds when the body's
 * first line would read as tags).
 */
export function splitDescription(description: string): { tagWords: string[]; body: string } {
  const text = description.replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  if (isTagsLine(lines[0]!)) {
    const rest = lines.slice(1);
    if (rest[0]?.trim() === "") rest.shift();
    return { tagWords: lines[0]!.trim().split(/\s+/), body: rest.join("\n").trimEnd() };
  }
  return { tagWords: [], body: text.replace(/^\n/, "").trimEnd() };
}

/** An event's description: the tags line, a blank line, then the body. */
export function joinDescription(tagWords: readonly string[], body: string): string {
  if (tagWords.length > 0) return body === "" ? tagWords.join(" ") : `${tagWords.join(" ")}\n\n${body}`;
  // With no tags line, a body whose first line looks like one gets a blank line before it.
  return body !== "" && isTagsLine(body.split("\n")[0]!) ? `\n${body}` : body;
}

/**
 * Takes the hashtags that name a tag out of an event's title (they go on the tags line). Other words,
 * hashtags that match no tag included, are left as they are.
 */
export function takeTitleHashtags(title: string, isTag: (text: string) => boolean): { title: string; tagWords: string[] } {
  const tagWords: string[] = [];
  const kept = title.split(/\s+/).filter((word) => {
    const text = hashtagText(word);
    if (text === undefined || !isTag(text)) return true;
    tagWords.push(word);
    return false;
  });
  return { title: kept.join(" ").trim(), tagWords };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/**
 * A description as plain text. Google keeps descriptions edited on its website as HTML; the formatting
 * is dropped, keeping the line breaks. Plain text (as nwsnotes writes) is returned as it is.
 */
export function descriptionText(description: string): string {
  if (!/<\/?[a-z][^>]*>/i.test(description)) return description;
  return description
    .replace(/\r\n?/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|ul|ol|blockquote)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code.startsWith("#x") || code.startsWith("#X")) return String.fromCodePoint(parseInt(code.slice(2), 16));
      if (code.startsWith("#")) return String.fromCodePoint(Number(code.slice(1)));
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}
