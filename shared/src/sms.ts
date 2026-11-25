/*
 * Adding notes by text message (see Specs/text-messages.md): working out which tab a dictated text
 * names, spoken names' rules, and fitting replies into one SMS. No imports, so it can be tested on its own.
 */

/** Longest spoken name a tab can have. */
export const SPOKEN_NAME_MAX_LENGTH = 40;

/** The word a text may start with before the tab's name ("Tab shopping, milk"). */
const TAB_WORD = "tab";

/** The words of a text or name as compared: lower case, "&" as "and", anything but letters and digits between words. */
function wordsOf(text: string): string[] {
  return [...text.matchAll(/[\p{L}\p{N}]+|&/gu)].map((match) => (match[0] === "&" ? "and" : match[0].toLowerCase()));
}

/** A text or name as compared: e.g. "Kids' stuff" and "kids, stuff." are both "kids stuff". */
export function normaliseSpoken(text: string): string {
  return wordsOf(text).join(" ");
}

/** The words of the text with where each ends in it, so what follows the matched words can be kept as it was. */
function wordsWithEnds(text: string): { word: string; end: number }[] {
  return [...text.matchAll(/[\p{L}\p{N}]+|&/gu)].map((match) => ({
    word: match[0] === "&" ? "and" : match[0].toLowerCase(),
    end: match.index + match[0].length,
  }));
}

/** Whether two words differ by one letter added, missing or changed. */
function oneLetterApart(a: string, b: string): boolean {
  const x = [...a];
  const y = [...b];
  if (Math.abs(x.length - y.length) > 1) return false;
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  if (x.length === y.length) return x.slice(i + 1).join("") === y.slice(i + 1).join("");
  const [longer, shorter] = x.length > y.length ? [x, y] : [y, x];
  return longer.slice(i + 1).join("") === shorter.slice(i).join("");
}

/** A dictation slip: an "s" or "es" more or less at the end, or (for words of 5 letters or more) one letter out. */
function nearlySame(said: string, name: string): boolean {
  if (said === name) return true;
  for (const ending of ["s", "es"]) {
    if (said === name + ending || name === said + ending) return true;
  }
  return [...name].length >= 5 && oneLetterApart(said, name);
}

/** What a tab offers to match: its id, name and spoken name. */
export interface SpokenTab {
  id: number;
  name: string;
  spokenName?: string;
}

/** Which tab a text names, and the note's title once that's taken off. */
export interface SpokenNote<T extends SpokenTab> {
  /** Missing when no tab matched: the whole text is the title. */
  tab?: T;
  /** Empty when the text was only a tab's name. */
  title: string;
}

/** Punctuation left between the tab's name and the note, taken off the title. */
const LEADING_PUNCTUATION = /^[\s,:;.\-–—'’]+/u;

/** The title with its first letter in upper case. */
function capitalised(title: string): string {
  const first = title.codePointAt(0);
  if (first === undefined) return title;
  const letter = String.fromCodePoint(first);
  return letter.toUpperCase() + title.slice(letter.length);
}

/**
 * Works out which of the tabs a dictated text starts with (by its name or spoken name), and the title
 * after it. Exact matches win over slips; among them, the longest name. Slips only count when they point
 * to one tab. Two tabs tying exactly (which their names' rules prevent) means no tab.
 */
export function matchSpokenTab<T extends SpokenTab>(text: string, tabs: T[]): SpokenNote<T> {
  const trimmed = text.trim();
  const words = wordsWithEnds(trimmed);

  const at = (offset: number): SpokenNote<T> | undefined => {
    const said = words.slice(offset).map((w) => w.word);
    const names = tabs.flatMap((tab) =>
      [tab.name, tab.spokenName].flatMap((name) => {
        const nameWords = name === undefined ? [] : wordsOf(name);
        return nameWords.length > 0 && nameWords.length <= said.length ? [{ tab, nameWords }] : [];
      }),
    );
    const exact = names.filter(({ nameWords }) => nameWords.every((word, i) => said[i] === word));
    const slips = names.filter(({ nameWords }) => nameWords.every((word, i) => nearlySame(said[i]!, word)));
    let best: { tab: T; nameWords: string[] } | undefined;
    if (exact.length > 0) {
      const longest = Math.max(...exact.map((m) => m.nameWords.length));
      const winners = exact.filter((m) => m.nameWords.length === longest);
      if (new Set(winners.map((m) => m.tab.id)).size > 1) return undefined;
      best = winners[0];
    } else if (slips.length > 0 && new Set(slips.map((m) => m.tab.id)).size === 1) {
      best = slips.reduce((a, b) => (b.nameWords.length > a.nameWords.length ? b : a));
    }
    if (!best) return undefined;
    const end = words[offset + best.nameWords.length - 1]!.end;
    return { tab: best.tab, title: capitalised(trimmed.slice(end).replace(LEADING_PUNCTUATION, "").trim()) };
  };

  const found = at(0) ?? (words[0]?.word === TAB_WORD ? at(1) : undefined);
  return found ?? { title: capitalised(trimmed) };
}

/**
 * Checks a tab's spoken name (already trimmed, not empty) against its own name and the other tabs'.
 * Returns an error message, or undefined if it's allowed.
 */
export function spokenNameError(spokenName: string, ownName: string, otherTabs: SpokenTab[]): string | undefined {
  if (spokenName.length > SPOKEN_NAME_MAX_LENGTH) {
    return `The spoken name is ${spokenName.length} characters long; the maximum is ${SPOKEN_NAME_MAX_LENGTH}.`;
  }
  const spoken = normaliseSpoken(spokenName);
  if (spoken === "") return "The spoken name needs at least one letter or digit.";
  if (spoken === "all") return `The spoken name can't be "All".`;
  if (spoken === TAB_WORD) return `The spoken name can't be "${TAB_WORD}".`;
  if (spoken === normaliseSpoken(ownName)) return "The spoken name is the same as the tab's name.";
  const clash = otherTabs.find(
    (tab) => normaliseSpoken(tab.name) === spoken || (tab.spokenName !== undefined && normaliseSpoken(tab.spokenName) === spoken),
  );
  if (clash) return `Another tab already uses that name ("${clash.name}").`;
  return undefined;
}

/** A tab name that is another tab's spoken name, once normalised: the other tab, if there is one. */
export function nameClashesWithSpokenName(name: string, otherTabs: SpokenTab[]): SpokenTab | undefined {
  const normalised = normaliseSpoken(name);
  return otherTabs.find((tab) => tab.spokenName !== undefined && normaliseSpoken(tab.spokenName) === normalised);
}

// ---- One-text replies -------------------------------------------------------

/** The standard SMS alphabet (GSM-7): texts using only these fit 160 characters. */
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
/** Characters that are in the alphabet's extension, which take two places each. */
const GSM_EXTENDED = "^{}\\[~]|€\f";

/** How many places a text takes in one SMS, and how many there are. */
export function smsLength(text: string): { used: number; max: number } {
  let used = 0;
  for (const char of text) {
    if (GSM_BASIC.includes(char)) used += 1;
    else if (GSM_EXTENDED.includes(char)) used += 2;
    // Outside the alphabet: the whole text uses a larger one (UCS-2), which fits 70 (UTF-16 units).
    else return { used: text.length, max: 70 };
  }
  return { used, max: 160 };
}

/** Whether a text fits in one SMS. */
export function fitsOneSms(text: string): boolean {
  const { used, max } = smsLength(text);
  return used <= max;
}

/**
 * `make(quoted)` with as much of `text` (spaces tidied) as fits in one SMS, cut short with "..." when
 * needed; `fallback` when not even one character fits.
 */
function fitQuoted(make: (quoted: string) => string, text: string, fallback: string): string {
  const tidied = text.trim().replace(/\s+/g, " ");
  if (fitsOneSms(make(tidied))) return make(tidied);
  const chars = [...tidied];
  for (let length = chars.length - 1; length > 0; length--) {
    const reply = make(`${chars.slice(0, length).join("").trimEnd()}...`);
    if (fitsOneSms(reply)) return reply;
  }
  return fallback;
}

/**
 * A "not saved" reply naming the note: `Not saved: "<start of the note>..." - <reason>`, with the quoted
 * start cut short so the whole reply fits in one SMS.
 */
export function notSavedReply(noteText: string, reason: string): string {
  return fitQuoted((quoted) => `Not saved: "${quoted}" - ${reason}`, noteText, `Not saved: ${reason}`);
}

/**
 * The confirmation texted back for a saved note, for users the admin has turned confirmations on for:
 * `Saved to <tab>: "<title>"` (", cut short" after the tab when the title was too long), fitted into one SMS.
 */
export function savedReply(tabName: string, title: string, cut: boolean): string {
  const heading = `Saved to ${tabName}${cut ? ", cut short" : ""}`;
  return fitQuoted((quoted) => `${heading}: "${quoted}"`, title, fitsOneSms(`${heading}.`) ? `${heading}.` : "Saved.");
}

/** The confirmation texted back for "Reset New": how many New notes became Active. */
export function resetNewReply(count: number): string {
  return count === 0 ? "Reset New: there were no New notes." : `Reset New: ${count === 1 ? "1 note" : `${count} notes`} made Active.`;
}

/** The confirmation texted back for a tab email: `Emailed <tab> (<n> notes) to <email>.`, fitted into one SMS. */
export function emailedReply(tabName: string, noteCount: number, email: string): string {
  const notes = noteCount === 1 ? "1 note" : `${noteCount} notes`;
  for (const reply of [`Emailed ${tabName} (${notes}) to ${email}.`, `Emailed ${tabName} (${notes}).`]) {
    if (fitsOneSms(reply)) return reply;
  }
  return `Emailed (${notes}).`;
}

/** The confirmation texted back for a due date set by "Due": `Due <when>: "<title>"`, fitted into one SMS. */
export function dueSetReply(when: string, title: string): string {
  return fitQuoted((quoted) => `Due ${when}: "${quoted}"`, title, `Due ${when}.`);
}

/** The reply when "Due" was followed by something that isn't a date and time, quoting it cut short to fit one SMS. */
export function dueNotUnderstoodReply(heard: string): string {
  return fitQuoted((quoted) => `Not set: couldn't understand "${quoted}" as a date and time.`, heard, "Not set: couldn't understand the date and time.");
}

/** The confirmation texted back when a phone is linked, for users with confirmations on. */
export const LINKED_REPLY = "Phone linked: notes you text from it will be added to nwsnotes.";

/** A UK number in the usual form ("07700 900123"); any other in E.164 as given. */
export function formatPhoneNumber(e164: string): string {
  const uk = /^\+44(7\d{3})(\d{6})$/.exec(e164);
  if (uk) return `0${uk[1]} ${uk[2]}`;
  return e164;
}

// ---- Commands -----------------------------------------------------------------

/** What a text asks for: every text starts with a command word, or it's simply a note with no tags. */
export type SmsCommand =
  /** "Add <tab name> <title>": `rest` is what follows "Add" (the tab's name, then the title). */
  | { command: "add"; rest: string }
  /** "New <title>": a note with no tags. */
  | { command: "new"; title: string }
  /** "Due <when>" (or "Due date <when>"): `when` is what follows, empty when nothing does. */
  | { command: "due"; when: string }
  /** "Reset New": the user's New notes become Active. */
  | { command: "reset-new" }
  /** "Email tab <tab name>": `named` is what follows "Email tab", empty when nothing does. */
  | { command: "email-tab"; named: string }
  /** No command word: the whole text is a note with no tags. */
  | { command: "none" };

/**
 * Reads the command word a text starts with (any case, any punctuation): Add, New, Due, Reset New or
 * Email tab ("e-mail" and "e mail" count as "email", as dictation may write them either way). Anything
 * else is no command. The words after the command are returned as written, without the punctuation between.
 */
export function readSmsCommand(text: string): SmsCommand {
  const trimmed = text.trim();
  const words = wordsWithEnds(trimmed);
  const word = (i: number) => words[i]?.word;
  /** What follows the command's words (the first `count`), as written. */
  const after = (count: number) => trimmed.slice(words[count - 1]!.end).replace(LEADING_PUNCTUATION, "").trim();
  switch (word(0)) {
    case "add":
      return { command: "add", rest: after(1) };
    case "new":
      return { command: "new", title: capitalised(after(1)) };
    case "due":
      return { command: "due", when: after(word(1) === "date" ? 2 : 1) };
    case "reset":
      // Only "Reset New" on its own: "Reset the boiler timer" is a note.
      return word(1) === "new" && words.length === 2 ? { command: "reset-new" } : { command: "none" };
  }
  const email = word(0) === "email" ? 1 : word(0) === "e" && word(1) === "mail" ? 2 : 0;
  if (email > 0 && word(email) === TAB_WORD) return { command: "email-tab", named: after(email + 1) };
  return { command: "none" };
}

/**
 * Which tab an "Email tab" command names (`named`, what follows "Email tab"): one of the tabs (by its
 * name or spoken name, as for notes), "all" for the built-in All tab, or undefined when it names none or
 * has words after the name.
 */
export function emailTabTarget<T extends SpokenTab>(named: string, tabs: T[]): T | "all" | undefined {
  const words = wordsOf(named);
  const withoutTabWord = words[0] === TAB_WORD ? words.slice(1) : words;
  if (withoutTabWord.join(" ") === "all") return "all";
  if (withoutTabWord.length === 0) return undefined;
  const { tab, title } = matchSpokenTab(named, tabs);
  return tab && normaliseSpoken(title) === "" ? tab : undefined;
}
