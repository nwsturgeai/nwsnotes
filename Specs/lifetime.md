# Lifetime

## Note Lifetime

### "Lifetime" system Category

There should be a system-controlled Category with name "Lifetime".
This category cannot be edited in the Settings page.
This is a single-select Category.
This category should have possible Tags: "New", "Active", "Waiting", "Archived", "Bin".  I suggest these tags be given negative ids.
When creating or editing a note, this system category should not have a drop-down.
New notes are always given the "New" tag from this Category.
The "Active", "Waiting", "Archived" and "Bin" tags in this category should never be displayed as pills in the notes-list (the different background colour is sufficient to indicate those states).
In the notes-list, clicking/tapping on the "New" pill brings up a modal with text "Do you want to reset the New tags?" and options Yes/No.  If Yes is chosen then the New tag is removed from all notes that have it and replaced with the Active tag.
When this Category is first introduced, all existing notes should be tagged with the "Active" tag.
Tab filter definitions can specify values for this system Category.  Additional Tab filters can specify values for this system Category (if the Tab definition does not already do so).

### Archiving

On the Notes screen, each note in the notes-list which is not tagged "Archived" or "Bin" should have an "archive" button (using icon fa-box-archive) alongside the edit / waiting buttons.  This button should be the same size as the edit button.
When the Archive button is clicked, the note is given the "Archived" tag (and Tag New or Active is removed).
Notes with the Archived tag should have a background #606060.  Black text is quite hard to read against this colour - that is deliberate.  Handwriting notes should also have this same dark background.
For Notes with the Archived tag: in place of the "archive" button, they should have a "reinstate" button (fa-rotate-left).
Pressing the reinstate button takes away the Archived/Bin/Waiting tag and adds the Active tag.
If the current Tab definition filter (or additional tab filter) specifies that archived items should not be shown in this tab: in this case, when the user clicks to archive a note, the note should then disappear from the current list of notes.

### Waiting

On the Notes screen, each note which is New or Active should have a "waiting" button (using icon fa-hourglass).  This button should be the same size as the edit button.
Clicking the waiting button removes the New/Active tag and sets the Waiting tag.
Notes with the Waiting tag should have background #c0c0c0, this applies also to handwriting notes.
Notes with the Waiting tag should have a "reinstate" button just like Archived notes.  Similar to Archived notes, pressing reinstate removes the Waiting tag and adds the Active tag.

### Bin
Any notes with the Bin Tag should be hidden from the notes-list unless the Tab-filter-definition or additional-tab-filters explicitly indicate that Bin items should be shown.  In other words, if a Tab has no filter set for the Lifetime category, notes tagged with Bin should still be hidden.
Notes with the Archived tag should have an extra icon button to the right: "move to bin" (fa-trash-can).  Clicking this button removes the Archived tab from this note and adds the Bin tag to this note.  Usually this will cause the note to become hidden.
When a Bin-tagged note is shown in the Notes list, it should have a "reinstate" button (the same as for Archived notes).  Similar to Archived notes, clicking "reinstate" removes the "Bin" tag and sets the "Active" tag.  Bin-tagged notes should have a background #B00000 (same for handwriting notes).
Buttons for each note should be right-aligned.  It doesn't matter if they don't line up vertically, the important thing is to preserve as much space as possible for note content.


### Lifetime changes

The Settings page should have three new Lifetime buttons in a section at the top below the "Stylus mode" section.  The buttons are:
Reset New:  Clicking this button will update all notes tagged as "New" to switch to being tagged "Active".
Archived to Bin: Clicking this button will update all notes tagged as "Archived" to instead be tagged "Bin".  There should be a confirmation modal asking if the user is sure, saying how many notes will be put in the bin.
Empty Bin: Clicking this button will delete all notes with the "Bin" tag.  There should be a confirmation modal asking if the user is sure, saying how many notes will be deleted.

## Agreed technical decisions

### Note lifetime
- **Built-in category:** Lifetime isn't stored in the save-file; the server adds it to `categories`. It's single-select with negative ids so it can never clash with user categories: category -1, and tags New -1, Active -2, Archived -3, Bin -4, Waiting -5 (added later, so it can't be renumbered; it's still listed in the order New, Active, Waiting, Archived, Bin). It can't be edited or renamed, and user categories can't use its name.
- **Every note has exactly one Lifetime tag.** The server always gives new notes New, ignoring any Lifetime tag sent, and keeps the existing one when a note is edited. Only the lifetime endpoints change it.
- **Introducing it:** when a save-file is loaded, any note without a Lifetime tag gets Active; the next save stores it.
- **Pills:** only New shows as a pill on notes, in the normal style; Active, Waiting, Archived and Bin never do, as the row colour already shows them. Tab definitions on the settings page still show every Lifetime tag they filter on.
- **Resetting New from the list:** the New pill on a note is a button (hover text "Reset the New tags"). It opens the app's own pop-up, "Do you want to reset the New tags?", with Yes (accent colour, focused) and No (Escape also counts as No). Yes does the same as the settings page's "Reset New" (every New note becomes Active, in one save) and reloads the list, with no other message. If it fails, the error shows as a notice over the list.
- **Tabs:** tab definitions and the additional tab filters can include Lifetime, as a check-list like any category.
- **Bin is hidden by default:** Bin notes are hidden in every tab, "All" included, unless the tab's filter or the additional filters tick Bin.
- **Creation date:** under each note's buttons, right-aligned, its creation date and time in the device's local time as "dd/MM HH:mm" (24-hour, e.g. "26/10 14:05"), in small grey text, the same grey on every row (it's deliberately hard to read on the dark Archived and Bin rows). Hovering shows the full date. It's labelled "Cr. ", and a note with a due date shows that instead (see "Due dates" in [due-dates.md](due-dates.md)).
- **Note buttons:** right-aligned at the right of each note, all 16px icons in 24px tap areas; they don't need to line up between notes. Left to right:
  - New and Active: edit, waiting (`fa-hourglass`), archive (`fa-box-archive`).
  - Waiting: edit, reinstate (`fa-rotate-left`), archive.
  - Archived: edit, reinstate, move-to-bin (`fa-trash-can`).
  - Bin: edit, reinstate.
- **Actions:** waiting sets Waiting. Archive sets Archived (from New, Active or Waiting). Reinstate sets Active, from Waiting, Archived or Bin. Move-to-bin sets Bin. Each updates the list straight away; a note that no longer matches the tab or the filters disappears from it.
- **Colours:** Waiting notes have a `#c0c0c0` background, Archived notes `#606060` and Bin notes `#B00000`, handwritten notes included (their light paper is replaced). The text stays black, which is deliberately hard to read on Archived and Bin. The note buttons turn light (near-white) on Archived and Bin rows so they stay visible; Waiting rows keep the normal dark icons.
- **Settings Lifetime section,** directly below Stylus mode, with three buttons in a row:
  - "Reset New" changes every New note to Active straight away, then reports how many ("3 notes changed to Active").
  - "Archived to Bin" first asks "Move 5 archived notes to the bin?".
  - "Empty Bin" first asks "Permanently delete 4 notes in the bin?".
  - Each button ends with the number of notes it would change, in brackets: "Reset New (3)", "Archived to Bin (5)", "Empty Bin (4)". The counts come from the notes the page has loaded, so they update after each change, made here or on another page. A count of 0 shows as "(0)".
  - The confirmations are the app's own pop-up windows (not the browser's), with the count. If there's nothing to change, the button says so (e.g. "There are no archived notes.") instead of asking.
  - Emptied notes are gone from the app, but can be brought back from the History page for 30 days, within the last 500 changes (see "History and revert" in [data.md](data.md)).
- **Note ids are never reused:** new notes get their id from the database's note-id sequence, shared by all users (see "Global note and tag ids" in [sharing.md](sharing.md)).
- **Live updates:** every lifetime change reloads other open pages, as for other changes.
- **Live updates:** if another page changes the note being edited, the last Update wins; the open edit isn't changed by live updates.
