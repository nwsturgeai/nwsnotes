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
  /** Empty when the text was only a tab's name (and perhaps "top"). */
  title: string;
  /** "top" came straight after the tab's name: add the note at the top of the tab. Never set without a tab. */
  top?: boolean;
}

/** Punctuation left between the tab's name and the note, taken off the title. */
const LEADING_PUNCTUATION = /^[\s,:;.\-–—'’]+/u;
/** "top" as a whole word at the start (after the tab's name), any case. */
const TOP_WORD = /^top(?![\p{L}\p{N}])/iu;

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
    const rest = trimmed.slice(end).replace(LEADING_PUNCTUATION, "");
    // "top" straight after the tab's name: the note goes at the top of the tab, and the word isn't part of it.
    if (TOP_WORD.test(rest)) {
      return { tab: best.tab, title: capitalised(rest.replace(TOP_WORD, "").replace(LEADING_PUNCTUATION, "").trim()), top: true };
    }
    return { tab: best.tab, title: capitalised(rest.trim()) };
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
  if (spoken.split(" ")[0] === APP_WORD) return `A spoken name can't start with "${APP_WORD}": texts starting "App" are commands to the app.`;
  if (spoken === normaliseSpoken(ownName)) return "The spoken name is the same as the tab's name.";
  const clash = otherTabs.find(
    (tab) => normaliseSpoken(tab.name) === spoken || (tab.spokenName !== undefined && normaliseSpoken(tab.spokenName) === spoken),
  );
  if (clash) return `Another tab already uses that name ("${clash.name}").`;
  return undefined;
}

// ---- Commands: texts starting "App" ---------------------------------------

/** The first word that makes a text a command to the app, not a note. */
const APP_WORD = "app";

/** The commands a text can give, after "App", as normalised (lower case, single spaces). */
export const APP_COMMANDS = ["reset new"] as const;
export type AppCommand = (typeof APP_COMMANDS)[number];

/**
 * A text whose first word is "App": the command after it, normalised ("App: Reset New." gives "reset new"),
 * whether or not it's one there is. Undefined when the text isn't a command (e.g. "Apple juice").
 */
export function appCommandOf(text: string): string | undefined {
  const words = wordsOf(text);
  return words[0] === APP_WORD ? words.slice(1).join(" ") : undefined;
}

/** Whether a command (from appCommandOf) is one there is. */
export function isAppCommand(command: string): command is AppCommand {
  return (APP_COMMANDS as readonly string[]).includes(command);
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
 * A "not saved" reply naming the note: `Not saved: "<start of the note>..." - <reason>`, with the quoted
 * start cut short so the whole reply fits in one SMS.
 */
export function notSavedReply(noteText: string, reason: string, outcome = "Not saved"): string {
  return withQuote(noteText, (quoted) => `${outcome}: "${quoted}" - ${reason}`, `${outcome}: ${reason}`);
}

/** The reply to a command that isn't one: `Unknown command "<command>". Commands: reset new.`, in one SMS. */
export function unknownCommandReply(command: string): string {
  const list = `Commands: ${APP_COMMANDS.join(", ")}.`;
  if (command.trim() === "") return `That isn't a command. ${list}`;
  return withQuote(command, (quoted) => `Unknown command "${quoted}". ${list}`, `Unknown command. ${list}`);
}

/** `make(quoted)` with as much of `text` quoted as fits in one SMS (cut short with "..."), or `fallback`. */
function withQuote(text: string, make: (quoted: string) => string, fallback: string): string {
  const whole = text.trim().replace(/\s+/g, " ");
  if (fitsOneSms(make(whole))) return make(whole);
  const chars = [...whole];
  for (let length = chars.length - 1; length > 0; length--) {
    const reply = make(`${chars.slice(0, length).join("").trimEnd()}...`);
    if (fitsOneSms(reply)) return reply;
  }
  return fallback;
}

/** A UK number in the usual form ("07700 900123"); any other in E.164 as given. */
export function formatPhoneNumber(e164: string): string {
  const uk = /^\+44(7\d{3})(\d{6})$/.exec(e164);
  if (uk) return `0${uk[1]} ${uk[2]}`;
  return e164;
}
