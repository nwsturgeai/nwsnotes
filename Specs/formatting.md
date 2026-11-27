# Text formatting

## Text formatting
Typed note titles and typed long-form note contents support a simple kind of markdown:
*text* renders as bold, with the asterisks disappearing.
_text_ renders as underline, with the underscores disappearing.
/text/ renders as italic, with the slashes disappearing.
-text- renders as strikethrough, with the dashes disappearing.
#text# renders with a bright yellow background (highlighted), with the hashes disappearing.
Formatting resets at the start of a new line.
In long-form note details only (not titles), "[ ] " at the start of a line is a tickbox. "[x] " is a ticked one, and the rest of its line is struck through. Clicking or tapping a tickbox ticks or unticks it. Typing "[]" and then text spaces it out to "[ ] " once the text starts.
In the long-form editor's text box, the formatting should show while typing (the markers can stay visible there).

The whole app should use the font Atkinson Hyperlegible.

## Agreed technical decisions

### Text formatting
- **Stored as typed:** the markers are kept in the text as typed. The server and the save-files don't change. Formatting is only how the app shows the text.
- **No library:** a small parser in the app turns each line into React elements, with no HTML strings, so nothing typed can inject code into the page.
- **When a marker counts** (the rule Org-mode uses), so everyday text like "and/or", "12/11/2026", web addresses, `file_name`, "2*3*4", "well-known", "- a list item" and "C#" stays as typed:
  - An opening marker is at the start of a line, or after a space or one of `( [ { " '`, and is followed by a character that isn't a space.
  - The closing marker is the next same marker on that line that comes straight after a character that isn't a space, and is followed by the end of the line, a space, or punctuation (`. , ; : ! ? ) ] } " '` or another marker).
  - The text between the two markers needs at least one character.
  - A marker without a partner on the same line just shows as typed. Formatting never carries onto the next line.
- **Combining:** markers can be nested, e.g. `*_bold and underlined_*`.
- **Where it shows formatted** (with the markers hidden):
  - typed note titles in the notes list, long-form notes included.
  - Everywhere else a title is shown as plain text, the markers are removed: the child notes' parent pill, reminder notifications, and notices that name a note.
- **Where the markers show as typed:** the new-note and edit title boxes, and the long-form editor's title box.
- **The long-form editor's text box (typed details):** the formatting shows while typing, with the markers dimmed in grey.
  - It uses two exactly overlapping layers: a display layer underneath with the formatted text, and the real text box on top with invisible text, so typing, the cursor, selection, autocorrect, copy and paste and undo all work as before.
  - Every letter must stay the same width in both layers, so nothing can drift. In the display layer, bold is drawn as the upright letters with a thin outline (`-webkit-text-stroke`) instead of a bolder weight, and italic is the slanted upright letters (the font has no italic version). Underline, strikethrough and the highlight don't change widths.
  - Both layers use the same font, size, line height, padding and wrapping, and scroll together.
- **In the list:** bold uses the font's real bold weight, as nothing needs to line up there.
- **Highlight:** a bright yellow background (`#ffff00`) with black text, so it reads the same whatever the text colour around it. Underline and strikethrough together show both lines.
- **Search** matches the text as typed, so searching "bold" finds `*bold*`.
- **Handwritten titles and drawn details** aren't affected.

### Tickboxes
- **Only in long-form details:** in the long-form editor's text box. Titles (in the list or anywhere else) show "[ ]" as typed.
- **What counts:** "[ ]", "[]", "[x]" or "[X]" at the start of a line, after any spaces or tabs (so indented sub-items work). Anywhere else in a line, e.g. "list[]", it's just text. "[x]" and "[X]" are ticked.
- **Stored as typed,** like the other markers: ticking turns "[ ]" or "[]" into "[x]", and unticking turns "[x]" or "[X]" into "[ ]". Nothing else changes, so saving, syncing, the history and backups work as for any typing.
- **How it looks:** a box drawn over the tickbox's characters, whose letters are hidden, so no width changes and the cursor still lines up. A ticked box is filled in the accent colour with a white tick. The rest of a ticked line (after the space following the box) is struck through, on top of any other formatting.
- **Ticking:** the boxes to click are on a layer above the text box, laid over the drawn ones exactly (invisible plain text, so every letter is in the same place). Only the boxes take clicks, with a slightly bigger area to tap; anything else reaches the text box. A tickbox can't be ticked while the details are locked.
  - While the text box has the focus, the change is made as an edit of the text box, so Undo takes it back, and the cursor stays where it was (Undo puts it back there too).
  - Otherwise, e.g. a tap on a phone with the keyboard down, the text is just changed, without focusing the text box, so the keyboard doesn't come up. That tick isn't on the text box's Undo list.
- **Spacing a typed tickbox:** when the first character after a tickbox typed at the start of a line is typed, the tickbox is spaced out to have exactly one space after it: "[]H" becomes "[ ] H", "[] H" becomes "[ ] H", and "[ ]M" or "[x]D" get a space before the letter. Until then (e.g. "[]" on a line by itself), it's left as typed.
  - It only happens straight after the tickbox is typed. Something else typed, deleted or undone in between, pasted text, or a space deleted on purpose later, isn't changed.
  - One Undo straight after takes out just the added spaces, and puts the cursor back after the letter typed. Typing on doesn't add them again.
  - On a phone, while the keyboard is still working on the word being typed (for its suggestions and autocorrect), the spacing waits until the word is finished, as changing the text before it can upset the keyboard.
- **Placeholder:** the text box's formatting list includes "[ ] or [] at the start of a line for a tickbox".
