/*
 * Setting a due date by text message (see "Setting a due date" in Specs/text-messages.md): reading a
 * dictated date and time, such as "tomorrow at 3 p.m." or "25th December 15:00", as UK time.
 * No imports, so it can be tested on its own.
 */

/** The time zone dictated dates and times are in. */
export const SPOKEN_TIME_ZONE = "Europe/London";

/** The time a date with no time is due at, as in the due-date dialog. */
const DEFAULT_HOUR = 20;

/** The time a part of the day with no time means ("tomorrow morning"). */
const PART_OF_DAY_HOURS = { morning: 9, afternoon: 15, evening: 20 } as const;

// ---- UK time ------------------------------------------------------------------

/** A date and time as a clock in the UK shows it. Months are 1–12; weekdays 0 (Sunday) to 6. */
interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

const WEEKDAY_NUMBERS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

let wallClockFormat: Intl.DateTimeFormat | undefined;

/** What a clock in the UK shows at this moment. */
function ukClock(instant: Date): WallClock {
  wallClockFormat ??= new Intl.DateTimeFormat("en-GB", {
    timeZone: SPOKEN_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(wallClockFormat.formatToParts(instant).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: WEEKDAY_NUMBERS[parts.weekday ?? ""] ?? 0,
  };
}

/** The moment a UK clock shows this date and time (GMT or BST, whichever is in force then). */
function fromUkClock(year: number, month: number, day: number, hour: number, minute: number): Date {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const offsetAt = (time: number) => {
    const clock = ukClock(new Date(time));
    return Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute) - time;
  };
  // Twice, so a time near the change between GMT and BST uses the offset in force at that time.
  const first = asUtc - offsetAt(asUtc);
  return new Date(asUtc - offsetAt(first));
}

/** A calendar date some days after another (months and years rolling over as needed). */
function addDays(date: { year: number; month: number; day: number }, days: number): { year: number; month: number; day: number } {
  const moved = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() };
}

/** Whether a day exists in that month (no 31st April). */
function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  return new Date(Date.UTC(year, month - 1, day)).getUTCDate() === day;
}

/**
 * A due date as replies and notifications show it, in UK time: e.g. "Tue 25/11 15:00", with the year
 * ("Tue 05/01/27 09:00") when it isn't this year.
 */
export function formatSpokenDue(dueDateTime: string, now: Date = new Date()): string {
  const due = ukClock(new Date(dueDateTime));
  const two = (n: number) => String(n).padStart(2, "0");
  const weekday = Object.keys(WEEKDAY_NUMBERS).find((name) => WEEKDAY_NUMBERS[name] === due.weekday)!;
  const year = due.year === ukClock(now).year ? "" : `/${two(due.year % 100)}`;
  return `${weekday} ${two(due.day)}/${two(due.month)}${year} ${two(due.hour)}:${two(due.minute)}`;
}

// ---- Words ----------------------------------------------------------------------

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50 };
const ORDINAL_UNITS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9,
  tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16,
  seventeenth: 17, eighteenth: 18, nineteenth: 19,
};
const ORDINAL_TENS: Record<string, number> = { twentieth: 20, thirtieth: 30 };

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};

/** Words that join the parts of a date and time without changing it ("on Friday at 3"). */
const FILLERS = new Set(["at", "on", "the", "of", "by", "for", "a", "and", "in", "this", "next", "hours", "hrs", "around", "about"]);

/** Parts of the day: "tomorrow morning", "this evening", "3 in the afternoon". */
const PARTS_OF_DAY: Record<string, keyof typeof PART_OF_DAY_HOURS> = {
  morning: "morning",
  afternoon: "afternoon",
  evening: "evening",
  night: "evening",
};

/**
 * The text as a list of words, with numbers in words turned into digits ("twenty five" → "25",
 * "fifteen hundred" → "1500", "nine oh five" → "9 05"), "a.m."/"p.m." as "am"/"pm", ordinals without their
 * endings ("25th" → "25"), and punctuation other than ":" and "." in times and "/" in dates taken out.
 */
export function spokenDueWords(text: string): string[] {
  const tidied = text
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/\bo\s*'?\s*clock\b/g, " oclock ")
    .replace(/\b([ap])\s*\.?\s*m\b\.?/g, " $1m ")
    .replace(/(\d)(am|pm|oclock)\b/g, "$1 $2")
    .replace(/(\d+)(st|nd|rd|th)\b/g, "$1")
    .replace(/(\p{L})-(?=\p{L})/gu, "$1 ")
    // Full stops, commas and the like, except a "." or ":" between digits (a time) and "/" in a date.
    .replace(/(?<!\d)[.:]|[.:](?!\d)/g, " ")
    .replace(/[^\p{L}\p{N}:./']+/gu, " ")
    .replace(/'/g, "");
  const raw = tidied.split(" ").filter((word) => word !== "");

  const words: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const word = raw[i]!;
    const next = raw[i + 1];
    const tens = TENS[word];
    if (tens !== undefined && next !== undefined && (UNITS[next] ?? 0) > 0 && UNITS[next]! < 10) {
      words.push(String(tens + UNITS[next]!));
      i++;
    } else if (tens !== undefined && next !== undefined && ORDINAL_UNITS[next] !== undefined && ORDINAL_UNITS[next]! < 10) {
      words.push(String(tens + ORDINAL_UNITS[next]!));
      i++;
    } else if (tens !== undefined) {
      words.push(String(tens));
    } else if (UNITS[word] !== undefined) {
      words.push(String(UNITS[word]));
    } else if (ORDINAL_UNITS[word] !== undefined) {
      words.push(String(ORDINAL_UNITS[word]));
    } else if (ORDINAL_TENS[word] !== undefined) {
      words.push(String(ORDINAL_TENS[word]));
    } else if ((word === "oh" || word === "o") && words.length > 0 && next !== undefined && (/^\d$/.test(next) || (UNITS[next] ?? 10) < 10)) {
      // "nine oh five": the minutes after an hour.
      words.push(`0${UNITS[next] ?? next}`);
      i++;
    } else if (word === "hundred" && words.length > 0 && /^\d{1,2}$/.test(words.at(-1)!)) {
      // "fifteen hundred" (hours): 1500.
      words.push(`${words.pop()!.padStart(2, "0")}00`);
    } else {
      words.push(word);
    }
  }
  return words;
}

// ---- Reading the date and time ---------------------------------------------------

/** What a text gave as the date. */
type SpokenDate = { kind: "days"; days: number } | { kind: "date"; day: number; month: number; year?: number };

/** What a text gave as the time, before working out am or pm. */
interface SpokenTime {
  hour: number;
  minute: number;
  /** Said with am or pm. */
  meridiem?: "am" | "pm";
  /** A 24-hour time ("15:00", "09:30", "1500"), so no am or pm is assumed. */
  twentyFour?: boolean;
  /** "quarter to": this many minutes before the hour, once am or pm is worked out. */
  before?: number;
  midnight?: boolean;
}

/** The date and time read from a text, or why it couldn't be. */
export type SpokenDue =
  | { ok: true; dueDateTime: string }
  | { ok: false; reason: "unclear" }
  | { ok: false; reason: "past"; dueDateTime: string };

const isNumber = (word: string | undefined): word is string => word !== undefined && /^\d+$/.test(word);

/**
 * Reads what was dictated after "App due" as a due date and time, in UK time (GMT or BST), e.g.
 * "tomorrow at 3pm", "Friday 15:00", "25th December", "9:30", "tonight". The rules:
 * - a date with no time is due at 20:00; a part of the day with no time at 09:00 (morning), 15:00
 *   (afternoon) or 20:00 (evening, night, tonight);
 * - a time with no date is today, or tomorrow if that time has passed today;
 * - an hour up to 12 with no am or pm is taken to be between 7am and 6pm (7–11 am, 12 noon, 1–6 pm);
 *   0 and 13–23, and times written with a leading 0 ("09:30") or as four digits ("1500"), are the 24-hour clock;
 * - a day of the week is the next one (a week today if it's today); a date with no year is the next one;
 * - "midnight" is the end of the day it names (with no day, the coming one).
 * A date and time that has already passed is refused ("past"), as is anything with words it doesn't know ("unclear").
 */
export function readSpokenDue(text: string, now: Date = new Date()): SpokenDue {
  const words = spokenDueWords(text);
  const unclear: SpokenDue = { ok: false, reason: "unclear" };
  let date: SpokenDate | undefined;
  /** A day of the week: the next one, or (with a date as well) a check that it's that date's. */
  let weekday: number | undefined;
  let time: SpokenTime | undefined;
  let partOfDay: keyof typeof PART_OF_DAY_HOURS | undefined;

  const setDate = (value: SpokenDate) => {
    if (date) return false;
    date = value;
    return true;
  };
  const setTime = (value: SpokenTime) => {
    if (time) return false;
    time = value;
    return true;
  };
  /** After a time: "o'clock", "am"/"pm", or both. Returns how many words were used. */
  const meridiemAfter = (at: number, value: SpokenTime): number => {
    let used = 0;
    if (words[at] === "oclock") used++;
    const word = words[at + used];
    if (word === "am" || word === "pm") {
      value.meridiem = word;
      used++;
    }
    return used;
  };
  /** A year after a date ("25 December 2027"): 4 digits from 2000. Returns how many words were used. */
  const yearAfter = (at: number, value: { year?: number }): number => {
    const word = words[at];
    if (isNumber(word) && word.length === 4 && Number(word) >= 2000 && Number(word) <= 2099) {
      value.year = Number(word);
      return 1;
    }
    return 0;
  };

  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const next = words[i + 1];
    if (FILLERS.has(word)) continue;

    if (word === "today" || word === "tonight") {
      if (!setDate({ kind: "days", days: 0 })) return unclear;
      if (word === "tonight") partOfDay ??= "evening";
      continue;
    }
    if (word === "tomorrow" || word === "tmrw" || word === "tomorrows") {
      if (!setDate({ kind: "days", days: 1 })) return unclear;
      continue;
    }
    if (word === "day" && next === "after" && words[i + 2] === "tomorrow") {
      if (!setDate({ kind: "days", days: 2 })) return unclear;
      i += 2;
      continue;
    }
    if (PARTS_OF_DAY[word]) {
      if (partOfDay && partOfDay !== PARTS_OF_DAY[word]) return unclear;
      partOfDay = PARTS_OF_DAY[word];
      continue;
    }
    if (WEEKDAYS[word] !== undefined) {
      if (weekday !== undefined) return unclear;
      weekday = WEEKDAYS[word]!;
      continue;
    }
    if (MONTHS[word] !== undefined) {
      // "December 25", "December the 25th".
      let at = i + 1;
      while (words[at] === "the") at++;
      const day = words[at];
      if (!isNumber(day) || day.length > 2) return unclear;
      const value: SpokenDate & { kind: "date" } = { kind: "date", day: Number(day), month: MONTHS[word]! };
      i = at + yearAfter(at + 1, value);
      if (!setDate(value)) return unclear;
      continue;
    }
    if (word === "noon" || word === "midday") {
      if (!setTime({ hour: 12, minute: 0, twentyFour: true })) return unclear;
      continue;
    }
    if (word === "midnight") {
      if (!setTime({ hour: 0, minute: 0, twentyFour: true, midnight: true })) return unclear;
      continue;
    }
    // "half past 3", "quarter past 3", "quarter to 4", "20 past 3", "10 to 4".
    const minutesWord = word === "half" ? 30 : word === "quarter" ? 15 : isNumber(word) && Number(word) >= 1 && Number(word) <= 30 ? Number(word) : undefined;
    if (minutesWord !== undefined && (next === "past" || next === "to") && isNumber(words[i + 2]) && words[i + 2]!.length <= 2) {
      if (word === "half" && next === "to") return unclear;
      const hour = Number(words[i + 2]);
      if (hour < 1 || hour > 12) return unclear;
      const value: SpokenTime = next === "past" ? { hour, minute: minutesWord } : { hour, minute: 0, before: minutesWord };
      i += 2 + meridiemAfter(i + 3, value);
      if (!setTime(value)) return unclear;
      continue;
    }
    // "25/12", "25/12/26", "25/12/2026": UK order, day first.
    const slashed = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(word);
    if (slashed) {
      const year = slashed[3] === undefined ? undefined : Number(slashed[3].length === 2 ? `20${slashed[3]}` : slashed[3]);
      if (!setDate({ kind: "date", day: Number(slashed[1]), month: Number(slashed[2]), year })) return unclear;
      continue;
    }
    // "3:30", "15.00", "09:30".
    const clock = /^(\d{1,2})[:.](\d{2})$/.exec(word);
    if (clock) {
      const value: SpokenTime = { hour: Number(clock[1]), minute: Number(clock[2]), twentyFour: clock[1]!.length === 2 && clock[1]!.startsWith("0") };
      i += meridiemAfter(i + 1, value);
      if (!setTime(value)) return unclear;
      continue;
    }
    if (isNumber(word)) {
      // A day before a month: "25 December", "25th of December".
      let at = i + 1;
      while (words[at] === "of" || words[at] === "the") at++;
      if (word.length <= 2 && words[at] !== undefined && MONTHS[words[at]!] !== undefined) {
        const value: SpokenDate & { kind: "date" } = { kind: "date", day: Number(word), month: MONTHS[words[at]!]! };
        i = at + yearAfter(at + 1, value);
        if (!setDate(value)) return unclear;
        continue;
      }
      let value: SpokenTime;
      if (word.length === 4) {
        // "1500", "0930": the 24-hour clock.
        value = { hour: Number(word.slice(0, 2)), minute: Number(word.slice(2)), twentyFour: true };
      } else if (word.length === 3) {
        // "930", "330": an hour and minutes.
        value = { hour: Number(word.slice(0, 1)), minute: Number(word.slice(1)) };
      } else {
        value = { hour: Number(word), minute: 0, twentyFour: word.length === 2 && word.startsWith("0") };
        // "9 30", "3 05": minutes after the hour.
        if (isNumber(next) && next.length === 2) {
          value.minute = Number(next);
          i++;
        }
      }
      i += meridiemAfter(i + 1, value);
      if (!setTime(value)) return unclear;
      continue;
    }
    return unclear;
  }
  if (!date && weekday === undefined && !time && !partOfDay) return unclear;

  // The hour, on the 24-hour clock.
  let hour: number;
  let minute: number;
  if (time) {
    if (time.minute > 59 || time.hour > 23) return unclear;
    const meridiem = time.meridiem ?? (partOfDay === undefined || time.twentyFour ? undefined : partOfDay === "morning" ? "am" : "pm");
    if (time.midnight || (time.twentyFour && time.meridiem === undefined)) {
      hour = time.hour;
    } else if (meridiem !== undefined) {
      if (time.hour === 0 || (time.hour > 12 && meridiem === "am")) return unclear;
      hour = time.hour > 12 ? time.hour : meridiem === "am" ? time.hour % 12 : (time.hour % 12) + 12;
    } else if (time.hour === 0 || time.hour >= 13) {
      hour = time.hour;
    } else {
      // No am or pm: between 7am and 6pm.
      hour = time.hour >= 7 && time.hour <= 11 ? time.hour : time.hour === 12 ? 12 : time.hour + 12;
    }
    minute = time.minute;
    if (time.before !== undefined) {
      hour = (hour + 23) % 24;
      minute = 60 - time.before;
    }
  } else {
    hour = partOfDay ? PART_OF_DAY_HOURS[partOfDay] : DEFAULT_HOUR;
    minute = 0;
  }

  // The day.
  const today = ukClock(now);
  let day: { year: number; month: number; day: number };
  if (!date) {
    day = weekday === undefined ? today : addDays(today, (weekday - today.weekday + 7) % 7 || 7);
  } else if (date.kind === "days") {
    day = addDays(today, date.days);
  } else {
    let year = date.year ?? today.year;
    if (date.year === undefined && (date.month < today.month || (date.month === today.month && date.day < today.day))) year++;
    if (!isRealDate(year, date.month, date.day)) return unclear;
    day = { year, month: date.month, day: date.day };
  }
  // "Friday 27 November" must be a Friday.
  if (date && weekday !== undefined && new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay() !== weekday) return unclear;
  // "Midnight" ends the day it names.
  if (time?.midnight) day = addDays(day, 1);

  let due = fromUkClock(day.year, day.month, day.day, hour, minute);
  // A time with no date that has passed today means tomorrow.
  if (!date && weekday === undefined && due.getTime() <= now.getTime() && !time?.midnight) {
    const tomorrow = addDays(today, 1);
    due = fromUkClock(tomorrow.year, tomorrow.month, tomorrow.day, hour, minute);
  }
  const dueDateTime = due.toISOString();
  if (due.getTime() <= now.getTime()) return { ok: false, reason: "past", dueDateTime };
  return { ok: true, dueDateTime };
}

// ---- The command -------------------------------------------------------------------

/**
 * "App due <when>", "App note due <when>" or "App last note due <when>" (any case and punctuation, with
 * "date" allowed after "due"): sets the due date of the note the person added last. Returns the text
 * after the command words (empty when nothing follows), or undefined if the text isn't this command.
 */
export function dueCommand(text: string): string | undefined {
  const trimmed = text.trim();
  const words = [...trimmed.matchAll(/[\p{L}\p{N}]+/gu)];
  const word = (i: number) => words[i]?.[0].toLowerCase();
  if (word(0) !== "app") return undefined;
  let at = 1;
  if (word(at) === "last" && word(at + 1) === "note") at += 2;
  else if (word(at) === "note") at += 1;
  if (word(at) !== "due") return undefined;
  if (word(at + 1) === "date") at++;
  const last = words[at]!;
  return trimmed.slice(last.index + last[0].length).replace(/^[\s,:;.\-–—]+/u, "").trim();
}
