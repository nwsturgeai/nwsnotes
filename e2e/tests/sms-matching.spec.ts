import { expect, test } from "@playwright/test";
import {
  appCommandOf,
  fitsOneSms,
  formatPhoneNumber,
  isAppCommand,
  matchSpokenTab,
  normaliseSpoken,
  notSavedReply,
  spokenNameError,
  unknownCommandReply,
} from "../../shared/src/sms";

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

test('"top" straight after the tab\'s name adds at the top, and isn\'t part of the note', () => {
  const top = (text: string) => {
    const result = matchSpokenTab(text, tabs);
    return { tab: result.tab?.id, title: result.title, top: result.top ?? false };
  };
  expect(top("Shopping top, oat milk")).toEqual({ tab: 1, title: "Oat milk", top: true });
  expect(top("Shopping, top: oat milk")).toEqual({ tab: 1, title: "Oat milk", top: true });
  expect(top("shopping Top oat milk")).toEqual({ tab: 1, title: "Oat milk", top: true });
  expect(top("Do it yourself top. Buy wall plugs")).toEqual({ tab: 4, title: "Buy wall plugs", top: true });
  // Only the whole word, and nothing left is an empty title.
  expect(top("Shopping topsoil")).toEqual({ tab: 1, title: "Topsoil", top: false });
  expect(top("Shopping top")).toEqual({ tab: 1, title: "", top: true });
  // Only after a tab's name.
  expect(top("Top of the list: milk")).toEqual({ tab: undefined, title: "Top of the list: milk", top: false });
  expect(top("Call the garage top priority")).toEqual({ tab: undefined, title: "Call the garage top priority", top: false });
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

test('a text whose first word is "App" is a command, whatever its case and punctuation', () => {
  expect(appCommandOf("App reset new")).toBe("reset new");
  expect(appCommandOf("app: Reset New.")).toBe("reset new");
  expect(appCommandOf("APP, reset  new!")).toBe("reset new");
  expect(appCommandOf("App")).toBe("");
  expect(appCommandOf("Apple juice")).toBeUndefined();
  expect(appCommandOf("Shopping, app store voucher")).toBeUndefined();
  expect(isAppCommand("reset new")).toBe(true);
  // No slips in commands.
  expect(isAppCommand("reset news")).toBe(false);
});

test("an unknown command's reply lists the commands, in one text", () => {
  expect(unknownCommandReply("reset news")).toBe('Unknown command "reset news". Commands: reset new.');
  expect(unknownCommandReply("")).toBe("That isn't a command. Commands: reset new.");
  const long = unknownCommandReply("word ".repeat(60));
  expect(fitsOneSms(long)).toBe(true);
  expect(long).toMatch(/^Unknown command "word word .*\.\.\."\. Commands: reset new\.$/);
  expect(notSavedReply("App reset new", "your nwsnotes account is turned off.", "Not done")).toBe(
    'Not done: "App reset new" - your nwsnotes account is turned off.',
  );
});

test('spoken names can\'t start with "app", as texts starting "App" are commands', () => {
  expect(spokenNameError("app", "Phone apps", [])).toMatch(/can't start with "app"/);
  expect(spokenNameError("App ideas", "Phone apps", [])).toMatch(/can't start with "app"/);
  expect(spokenNameError("apps", "Phone apps", [])).toBeUndefined();
});

test("UK numbers are shown in the usual form", () => {
  expect(formatPhoneNumber("+447700900123")).toBe("07700 900123");
  expect(formatPhoneNumber("+12025550123")).toBe("+12025550123");
});
