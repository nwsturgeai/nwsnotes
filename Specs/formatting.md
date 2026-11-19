# Text formatting

## Text formatting
Typed note titles and typed long-form note contents support a simple kind of markdown:
*text* renders as bold, with the asterisks disappearing.
_text_ renders as underline, with the underscores disappearing.
/text/ renders as italic, with the slashes disappearing.
Formatting resets at the start of a new line.
In the long-form editor's text box, the formatting should show while typing (the markers can stay visible there).

The whole app should use the font Atkinson Hyperlegible.

## Agreed technical decisions

### Text formatting
- **Stored as typed:** the markers are kept in the text as typed. The server and the save-files don't change. Formatting is only how the app shows the text.
- **No library:** a small parser in the app turns each line into React elements, with no HTML strings, so nothing typed can inject code into the page.
- **When a marker counts** (the rule Org-mode uses), so everyday text like "and/or", "12/11/2026", web addresses, `file_name` and "2*3*4" stays as typed:
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
  - Every letter must stay the same width in both layers, so nothing can drift. In the display layer, bold is drawn as the upright letters with a thin outline (`-webkit-text-stroke`) instead of a bolder weight, and italic is the slanted upright letters (the font has no italic version). Underline doesn't change widths.
  - Both layers use the same font, size, line height, padding and wrapping, and scroll together.
- **In the list:** bold uses the font's real bold weight, as nothing needs to line up there.
- **Search** matches the text as typed, so searching "bold" finds `*bold*`.
- **Handwritten titles and drawn details** aren't affected.
