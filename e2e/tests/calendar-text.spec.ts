import { expect, test } from "@playwright/test";
import {
  descriptionText,
  hashtagOf,
  hashtagText,
  isTagsLine,
  joinDescription,
  splitDescription,
  tagForHashtag,
  takeTitleHashtags,
} from "../../shared/src/calendarText";

// Unit tests of the Google Calendar text code: no browser or server needed, so they run once (desktop).
test.beforeEach(() => {
  test.skip(test.info().project.name !== "desktop", "Unit tests: once is enough.");
});

const tags = [
  { id: 1, name: "Shopping" },
  { id: 2, name: "Garden ideas" },
  { id: 3, name: "Home" },
  // Same name as tag 3, in a later category: never chosen by a hashtag.
  { id: 4, name: "home" },
];

test("a tag's hashtag has underscores for spaces, and matches in any case", () => {
  expect(hashtagOf("Garden ideas")).toBe("#Garden_ideas");
  expect(hashtagOf("Shopping")).toBe("#Shopping");
  expect(tagForHashtag("garden_ideas", tags)?.id).toBe(2);
  expect(tagForHashtag("SHOPPING", tags)?.id).toBe(1);
  // Two tags with the same name: the first.
  expect(tagForHashtag("Home", tags)?.id).toBe(3);
  expect(tagForHashtag("Shoping", tags)).toBeUndefined();
});

test("a hashtag is # and then no spaces or #, without a comma or full stop at the end", () => {
  expect(hashtagText("#Shopping")).toBe("Shopping");
  expect(hashtagText("#Shopping,")).toBe("Shopping");
  expect(hashtagText("#Shopping.")).toBe("Shopping");
  expect(hashtagText("#Garden_ideas")).toBe("Garden_ideas");
  // A highlight, not a hashtag.
  expect(hashtagText("#urgent#")).toBeUndefined();
  expect(hashtagText("#")).toBeUndefined();
  expect(hashtagText("Shopping")).toBeUndefined();
});

test("a tags line is a line of nothing but hashtags", () => {
  expect(isTagsLine("#Shopping #Home")).toBe(true);
  expect(isTagsLine("  #Shopping  ")).toBe(true);
  expect(isTagsLine("#Shopping list for Saturday")).toBe(false);
  expect(isTagsLine("#urgent# today")).toBe(false);
  expect(isTagsLine("")).toBe(false);
});

test("a description is split into its tags line and its body", () => {
  expect(splitDescription("#Shopping #Home\n\nOat milk\nBread")).toEqual({ tagWords: ["#Shopping", "#Home"], body: "Oat milk\nBread" });
  expect(splitDescription("#Shopping")).toEqual({ tagWords: ["#Shopping"], body: "" });
  expect(splitDescription("#Shopping\nNo blank line")).toEqual({ tagWords: ["#Shopping"], body: "No blank line" });
  expect(splitDescription("Just details\n#Home")).toEqual({ tagWords: [], body: "Just details\n#Home" });
  expect(splitDescription("")).toEqual({ tagWords: [], body: "" });
  // Windows line ends.
  expect(splitDescription("#Home\r\n\r\nText")).toEqual({ tagWords: ["#Home"], body: "Text" });
});

test("a description is the tags line, a blank line, then the body, and splits back the same", () => {
  expect(joinDescription(["#Shopping", "#Home"], "Oat milk")).toBe("#Shopping #Home\n\nOat milk");
  expect(joinDescription(["#Shopping"], "")).toBe("#Shopping");
  expect(joinDescription([], "Oat milk")).toBe("Oat milk");
  expect(joinDescription([], "")).toBe("");
  // No tags, and details starting with what looks like a tags line: a blank line first, so it isn't read as tags.
  const awkward = joinDescription([], "#Home\nDetails");
  expect(awkward).toBe("\n#Home\nDetails");
  expect(splitDescription(awkward)).toEqual({ tagWords: [], body: "#Home\nDetails" });
  for (const [words, body] of [
    [["#A", "#B_c"], "Line one\n\nLine three"],
    [[], "Plain"],
    [["#A"], ""],
  ] as const) {
    expect(splitDescription(joinDescription(words, body))).toEqual({ tagWords: [...words], body });
  }
});

test("hashtags naming a tag are taken out of a title; others stay", () => {
  const isTag = (text: string) => tagForHashtag(text, tags) !== undefined;
  expect(takeTitleHashtags("Oat milk #Shopping", isTag)).toEqual({ title: "Oat milk", tagWords: ["#Shopping"] });
  expect(takeTitleHashtags("#garden_ideas Plant bulbs #home", isTag)).toEqual({ title: "Plant bulbs", tagWords: ["#garden_ideas", "#home"] });
  expect(takeTitleHashtags("Ring #1 priority", isTag)).toEqual({ title: "Ring #1 priority", tagWords: [] });
  expect(takeTitleHashtags("#Shopping", isTag)).toEqual({ title: "", tagWords: ["#Shopping"] });
});

test("a description edited on Google's website (HTML) becomes plain text with its line breaks", () => {
  expect(descriptionText("Plain <3 text & more")).toBe("Plain <3 text & more");
  expect(descriptionText("#Home<br><br><b>Bold</b> and <i>italic</i><br>Next")).toBe("#Home\n\nBold and italic\nNext");
  expect(descriptionText("<p>One</p><p>Two</p>")).toBe("One\nTwo");
  expect(descriptionText("<ul><li>Eggs</li><li>Milk</li></ul>")).toBe("Eggs\nMilk");
  expect(descriptionText('<a href="https://example.com">a link</a> &amp; &lt;b&gt; &#39;x&#39; &nbsp;y')).toBe("a link & <b> 'x'  y");
});
