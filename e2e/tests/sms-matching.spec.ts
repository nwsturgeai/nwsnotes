import { expect, test } from "@playwright/test";
import {
  emailTabTarget,
  emailedReply,
  fitsOneSms,
  formatPhoneNumber,
  matchSpokenTab,
  normaliseSpoken,
  notSavedReply,
  readSmsCommand,
  resetNewReply,
  savedReply,
  spokenNameError,
  dueSetReply,
  dueNotUnderstoodReply,
} from "../../shared/src/sms";
import { formatSpokenDue, readSpokenDue } from "../../shared/src/spokenDue";

// Unit tests of the shared text-message code: no browser or server needed, so they run once (desktop).
test.beforeEach(() => {
  test.skip(test.info().project.name !== "desktop", "Unit tests: once is enough.");
});

const tabs = [
  { id: 1, name: "Shopping" },
  { id: 2, name: "Home" },
  { id: 3, name: "Home jobs" },
  { id: 4, name: "DIY", spokenName: "do it yourself" },
  { id: 5, name: "Kids' stuff", spokenName: "kids" },
  { id: 6, name: "Work" },
  { id: 7, name: "Garden" },
];

/** The tab id (or undefined) and title a text gives. */
const match = (text: string) => {
  const result = matchSpokenTab(text, tabs);
  return { tab: result.tab?.id, title: result.title };
};

test("a tab's name at the start puts the note in that tab, with punctuation taken off", () => {
  expect(match("Shopping, oat milk and bin bags")).toEqual({ tab: 1, title: "Oat milk and bin bags" });
  expect(match("shopping oat milk")).toEqual({ tab: 1, title: "Oat milk" });
  expect(match("Shopping: oat milk.")).toEqual({ tab: 1, title: "Oat milk." });
  expect(match("  SHOPPING - oat milk")).toEqual({ tab: 1, title: "Oat milk" });
});

test("a spoken name works as well as the tab's own name", () => {
  expect(match("Do it yourself, buy wall plugs")).toEqual({ tab: 4, title: "Buy wall plugs" });
  expect(match("DIY buy wall plugs")).toEqual({ tab: 4, title: "Buy wall plugs" });
  expect(match("Kids, school trip money")).toEqual({ tab: 5, title: "School trip money" });
  expect(match("kids stuff school trip money")).toEqual({ tab: 5, title: "School trip money" });
});

test("the longest name wins, and only whole words match", () => {
  expect(match("Home jobs fix the gate")).toEqual({ tab: 3, title: "Fix the gate" });
  expect(match("Home, ring mum")).toEqual({ tab: 2, title: "Ring mum" });
  expect(match("Workshop leaflets")).toEqual({ tab: undefined, title: "Workshop leaflets" });
});

test("small dictation slips still match, but only when they point to one tab", () => {
  expect(match("Shoppings, eggs")).toEqual({ tab: 1, title: "Eggs" });
  expect(match("Shoping eggs")).toEqual({ tab: 1, title: "Eggs" });
  expect(match("Gardens weed the beds")).toEqual({ tab: 7, title: "Weed the beds" });
  // Short words don't allow a letter out ("Hom" isn't "Home"), as too much would match.
  expect(match("Hom ring mum").tab).toBeUndefined();
  // Exact beats a slip: "Home" exactly, rather than "Homes".
  expect(match("Home homes to view").tab).toBe(2);
});

test('"Tab" can come first, and "All" is never a tab', () => {
  expect(match("Tab shopping, milk")).toEqual({ tab: 1, title: "Milk" });
  expect(match("All the best ideas")).toEqual({ tab: undefined, title: "All the best ideas" });
});

test("with no tab, the whole text is the title; only a tab's name leaves nothing", () => {
  expect(match("Call the garage about the tyres")).toEqual({ tab: undefined, title: "Call the garage about the tyres" });
  expect(match("Shopping.")).toEqual({ tab: 1, title: "" });
});

test("text after the tab keeps its own case and accents", () => {
  expect(match("Shopping, café crème from M&S")).toEqual({ tab: 1, title: "Café crème from M&S" });
  expect(normaliseSpoken("Fish & chips")).toBe("fish and chips");
});

test("spoken names can't clash with any tab's name or spoken name, or be All or tab", () => {
  const others = tabs.filter((tab) => tab.id !== 1);
  expect(spokenNameError("shops", "Shopping", others)).toBeUndefined();
  expect(spokenNameError("home", "Shopping", others)).toMatch(/Another tab already uses that name/);
  expect(spokenNameError("Do it, yourself!", "Shopping", others)).toMatch(/Another tab already uses that name/);
  expect(spokenNameError("all", "Shopping", others)).toMatch(/can't be "All"/);
  expect(spokenNameError("Tab", "Shopping", others)).toMatch(/can't be "tab"/);
  expect(spokenNameError("shopping", "Shopping", others)).toMatch(/same as the tab's name/);
  expect(spokenNameError("!!", "Shopping", others)).toMatch(/at least one letter or digit/);
  expect(spokenNameError("x".repeat(41), "Shopping", others)).toMatch(/maximum is 40/);
});

test("a not-saved reply fits in one text, cutting the quoted note short", () => {
  const short = notSavedReply("Oat milk", "you've reached your limit of 1000 notes.");
  expect(short).toBe(`Not saved: "Oat milk" - you've reached your limit of 1000 notes.`);
  const long = notSavedReply("word ".repeat(100), "you've reached your limit of 1000 notes.");
  expect(fitsOneSms(long)).toBe(true);
  expect(long).toMatch(/^Not saved: "word word .*\.\.\." - you've reached your limit of 1000 notes\.$/);
  // An emoji means the larger alphabet, where only 70 fit; cut before it, the reply is in the usual one.
  expect(fitsOneSms(`Not saved: "${"🎉".repeat(30)}"`)).toBe(false);
  const emoji = notSavedReply("🎉 Party ".repeat(20), "too many texts. Wait a few minutes and try again.");
  expect(fitsOneSms(emoji)).toBe(true);
  expect(emoji).toContain("🎉");
  expect(emoji.length).toBeLessThanOrEqual(70);
});

test("confirmations texted back fit in one text", () => {
  expect(savedReply("Shopping", "Oat milk", false)).toBe(`Saved to Shopping: "Oat milk"`);
  expect(savedReply("Shopping", "Oat milk", true)).toBe(`Saved to Shopping, cut short: "Oat milk"`);
  const long = savedReply("Shopping", "word ".repeat(100), true);
  expect(fitsOneSms(long)).toBe(true);
  expect(long).toMatch(/^Saved to Shopping, cut short: "word word .*\.\.\."$/);
  // A tab name too long to quote anything after it.
  expect(savedReply("x".repeat(150), "Oat milk", false)).toBe(`Saved to ${"x".repeat(150)}.`);
  expect(savedReply("x".repeat(200), "Oat milk", false)).toBe("Saved.");

  expect(emailedReply("Work", 1, "pat@example.com")).toBe("Emailed Work (1 note) to pat@example.com.");
  expect(emailedReply("Work", 3, "pat@example.com")).toBe("Emailed Work (3 notes) to pat@example.com.");
  expect(emailedReply("Work", 3, `${"p".repeat(150)}@example.com`)).toBe("Emailed Work (3 notes).");
});

test("UK numbers are shown in the usual form", () => {
  expect(formatPhoneNumber("+447700900123")).toBe("07700 900123");
  expect(formatPhoneNumber("+12025550123")).toBe("+12025550123");
});

test("every text starts with a command word: Add, New, Due, Reset New or Email tab, however it's dictated", () => {
  expect(readSmsCommand("Add Shopping, oat milk")).toEqual({ command: "add", rest: "Shopping, oat milk" });
  expect(readSmsCommand("add: tab home jobs fix the gate")).toEqual({ command: "add", rest: "tab home jobs fix the gate" });
  expect(readSmsCommand("Add")).toEqual({ command: "add", rest: "" });
  expect(readSmsCommand("New, call the garage")).toEqual({ command: "new", title: "Call the garage" });
  expect(readSmsCommand("new")).toEqual({ command: "new", title: "" });
  expect(readSmsCommand("Due tomorrow 3pm")).toEqual({ command: "due", when: "tomorrow 3pm" });
  expect(readSmsCommand("due date: Friday")).toEqual({ command: "due", when: "Friday" });
  expect(readSmsCommand("Due.")).toEqual({ command: "due", when: "" });
  expect(readSmsCommand("Reset New")).toEqual({ command: "reset-new" });
  expect(readSmsCommand("reset, new.")).toEqual({ command: "reset-new" });
  expect(readSmsCommand("Email tab Shopping")).toEqual({ command: "email-tab", named: "Shopping" });
  expect(readSmsCommand("e-mail tab shopping.")).toEqual({ command: "email-tab", named: "shopping." });
  expect(readSmsCommand("E mail, tab: Home jobs")).toEqual({ command: "email-tab", named: "Home jobs" });
  expect(readSmsCommand("Email tab")).toEqual({ command: "email-tab", named: "" });
  // Anything else is a note with no tags: the old "App" commands, a tab's name on its own, a command
  // word inside another word or later on, "Reset New" with more after it, and "Email" without "tab".
  for (const text of [
    "App email tab Shopping",
    "App due tomorrow",
    "Shopping, oat milk",
    "Address the envelopes",
    "Newspapers to recycle",
    "Buy a new kettle",
    "Reset new boiler timer",
    "Reset the clocks",
    "Email the plumber",
    "Duet practice",
  ]) {
    expect(readSmsCommand(text)).toEqual({ command: "none" });
  }
});

test('the "Reset New" confirmation says how many notes it changed', () => {
  expect(resetNewReply(0)).toBe("Reset New: there were no New notes.");
  expect(resetNewReply(1)).toBe("Reset New: 1 note made Active.");
  expect(resetNewReply(12)).toBe("Reset New: 12 notes made Active.");
});

test("the email command names a tab by its name or spoken name, or All", () => {
  const target = (named: string) => {
    const tab = emailTabTarget(named, tabs);
    return tab === "all" ? "all" : tab?.id;
  };
  expect(target("tab Shopping")).toBe(1);
  expect(target("Shopping")).toBe(1);
  expect(target("tab shoping.")).toBe(1);
  expect(target("tab home jobs")).toBe(3);
  expect(target("tab home")).toBe(2);
  expect(target("tab do it yourself")).toBe(4);
  expect(target("tab kids")).toBe(5);
  expect(target("tab all")).toBe("all");
  expect(target("All")).toBe("all");
  // No such tab, no name, or more words after the name.
  expect(target("tab holidays")).toBeUndefined();
  expect(target("tab")).toBeUndefined();
  expect(target("")).toBeUndefined();
  expect(target("tab shopping and work")).toBeUndefined();
});

// ---- "Due": reading a dictated date and time --------------------------------------

/** Tuesday 24 November 2026, 10:00 in the UK (GMT). */
const NOW = new Date("2026-11-24T10:00:00Z");

/** What a dictated date and time comes to, as replies show it, or why it was refused. */
const due = (text: string, now = NOW) => {
  const read = readSpokenDue(text, now);
  return read.ok ? formatSpokenDue(read.dueDateTime, now) : read.reason;
};

test("today and tomorrow, with am/pm or the 24-hour clock", () => {
  expect(due("tomorrow at 3pm")).toBe("Wed 25/11 15:00");
  expect(due("tomorrow at 3 p.m.")).toBe("Wed 25/11 15:00");
  expect(due("Tomorrow, 3 PM.")).toBe("Wed 25/11 15:00");
  expect(due("tomorrow 15:00")).toBe("Wed 25/11 15:00");
  expect(due("tomorrow 15.30")).toBe("Wed 25/11 15:30");
  expect(due("today 1500 hours")).toBe("Tue 24/11 15:00");
  expect(due("today 11:45 am")).toBe("Tue 24/11 11:45");
  expect(due("today 12 pm")).toBe("Tue 24/11 12:00");
  expect(due("tomorrow 12 am")).toBe("Wed 25/11 00:00");
  expect(due("tomorrow 00:30")).toBe("Wed 25/11 00:30");
  expect(due("today 9 o'clock pm")).toBe("Tue 24/11 21:00");
});

test("a date with no time is 20:00; a time with no date is today, or tomorrow once it has passed", () => {
  expect(due("today")).toBe("Tue 24/11 20:00");
  expect(due("tomorrow")).toBe("Wed 25/11 20:00");
  expect(due("3pm")).toBe("Tue 24/11 15:00");
  expect(due("9am")).toBe("Wed 25/11 09:00");
  expect(due("10:00")).toBe("Wed 25/11 10:00");
  expect(due("10:01")).toBe("Tue 24/11 10:01");
});

test("an hour up to 12 with no am or pm is between 7am and 6pm", () => {
  expect(due("tomorrow 7")).toBe("Wed 25/11 07:00");
  expect(due("tomorrow 11")).toBe("Wed 25/11 11:00");
  expect(due("tomorrow 12")).toBe("Wed 25/11 12:00");
  expect(due("tomorrow 1")).toBe("Wed 25/11 13:00");
  expect(due("tomorrow 6:30")).toBe("Wed 25/11 18:30");
  expect(due("tomorrow 0")).toBe("Wed 25/11 00:00");
  expect(due("tomorrow 13")).toBe("Wed 25/11 13:00");
  expect(due("tomorrow 23:15")).toBe("Wed 25/11 23:15");
  // A leading 0 or four digits is the 24-hour clock.
  expect(due("tomorrow 06:30")).toBe("Wed 25/11 06:30");
  expect(due("tomorrow 0600")).toBe("Wed 25/11 06:00");
  // A part of the day settles it.
  expect(due("tonight at 7")).toBe("Tue 24/11 19:00");
  expect(due("tomorrow 6 in the morning")).toBe("Wed 25/11 06:00");
});

test("numbers in words, as dictation may write them", () => {
  expect(due("tomorrow at three pm")).toBe("Wed 25/11 15:00");
  expect(due("tomorrow at nine thirty")).toBe("Wed 25/11 09:30");
  expect(due("tomorrow nine oh five pm")).toBe("Wed 25/11 21:05");
  expect(due("tomorrow fifteen hundred hours")).toBe("Wed 25/11 15:00");
  expect(due("tomorrow at half past three")).toBe("Wed 25/11 15:30");
  expect(due("tomorrow at quarter to seven pm")).toBe("Wed 25/11 18:45");
  expect(due("tomorrow twenty past eleven")).toBe("Wed 25/11 11:20");
  expect(due("the twenty fifth of December")).toBe("Fri 25/12 20:00");
  expect(due("December the first at noon")).toBe("Tue 01/12 12:00");
});

test("other days and dates: weekdays, day and month, UK numeric dates", () => {
  expect(due("Friday")).toBe("Fri 27/11 20:00");
  expect(due("on Friday at 10am")).toBe("Fri 27/11 10:00");
  expect(due("next Friday")).toBe("Fri 27/11 20:00");
  // Today's weekday is a week today.
  expect(due("Tuesday")).toBe("Tue 01/12 20:00");
  expect(due("Friday 27th November")).toBe("Fri 27/11 20:00");
  expect(due("Thursday 27th November")).toBe("unclear");
  expect(due("day after tomorrow 9")).toBe("Thu 26/11 09:00");
  expect(due("25th December 9am")).toBe("Fri 25/12 09:00");
  expect(due("Dec 25 at 9")).toBe("Fri 25/12 09:00");
  expect(due("25/12")).toBe("Fri 25/12 20:00");
  expect(due("5/1 14:00")).toBe("Tue 05/01/27 14:00");
  expect(due("1 March 2027 10:00")).toBe("Mon 01/03/27 10:00");
  // A date that has passed this year is next year's.
  expect(due("3rd of January")).toBe("Sun 03/01/27 20:00");
  expect(due("midnight")).toBe("Wed 25/11 00:00");
  expect(due("tomorrow midnight")).toBe("Thu 26/11 00:00");
  expect(due("tomorrow morning")).toBe("Wed 25/11 09:00");
  expect(due("tomorrow afternoon")).toBe("Wed 25/11 15:00");
  expect(due("tonight")).toBe("Tue 24/11 20:00");
});

test("UK time: GMT in winter, BST in summer", () => {
  const summer = readSpokenDue("25th May 3pm", NOW);
  expect(summer).toEqual({ ok: true, dueDateTime: "2027-05-25T14:00:00.000Z" });
  const winter = readSpokenDue("tomorrow 3pm", NOW);
  expect(winter).toEqual({ ok: true, dueDateTime: "2026-11-25T15:00:00.000Z" });
  // Sent at 23:30 BST on Saturday 24 October 2026, the night the clocks go back: 9am on Sunday is GMT.
  expect(readSpokenDue("tomorrow 9am", new Date("2026-10-24T22:30:00Z"))).toEqual({ ok: true, dueDateTime: "2026-10-25T09:00:00.000Z" });
});

test("past dates and times, and anything not understood, are refused", () => {
  expect(due("today 9am")).toBe("past");
  expect(due("today 10:00")).toBe("past");
  expect(due("1/1/2026")).toBe("past");
  expect(due("yesterday")).toBe("unclear");
  expect(due("")).toBe("unclear");
  expect(due("soon")).toBe("unclear");
  expect(due("tomorrow at 3pm please")).toBe("unclear");
  expect(due("31st April")).toBe("unclear");
  expect(due("tomorrow 25:00")).toBe("unclear");
  expect(due("tomorrow 15 am")).toBe("unclear");
  expect(due("today tomorrow")).toBe("unclear");
  expect(due("3pm 4pm")).toBe("unclear");
});

test("due-date replies fit in one text", () => {
  expect(dueSetReply("Wed 25/11 15:00", "Ring the bank")).toBe('Due Wed 25/11 15:00: "Ring the bank"');
  const long = dueSetReply("Wed 25/11 15:00", "word ".repeat(60));
  expect(long).toMatch(/^Due Wed 25\/11 15:00: "word word .*\.\.\."$/);
  expect(fitsOneSms(long)).toBe(true);
  expect(dueNotUnderstoodReply("soon")).toBe(`Not set: couldn't understand "soon" as a date and time.`);
  expect(fitsOneSms(dueNotUnderstoodReply("whenever ".repeat(30)))).toBe(true);
});
