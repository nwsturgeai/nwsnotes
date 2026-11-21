# Notes

## Notes and main screen

Each note will have the following attributes:
id - a unique integer id.  Should be auto-created on the server, starting at 1, each new note takes the next id value.  Ids should never be reused even after notes get deleted.
titleText - a string.  May not be empty - notes with empty title should be rejected.  Trim leading/trailing whitespace.  Max length 500 characters.
titleImage - a string containing the base64 image data if the note has been created from stylus handwriting.  Exactly one of titleText and titleImage should be populated on each note.
createdDateTime
lastModifiedDateTime
timestamps should be set by the server.  Dates should be stored in ISO 8601 format, UTC timezone.
Tags - can have multiple.  More details below.  The note should reference/store the ids of the tags it is tagged with.
detailsText (string, max length 10000 character)
detailsImage - a string containing base64 image data.  Exactly One of detailsText or detailsImage will be populated for long-form notes
parentId - an integer, nullable.  When this note is a child of a long-form note, then parentId gives the id of that associated long-form note.
dueDateTime - an optional date-time value for when this note is due to be resolved.  May only be populated for regular notes, not long-form notes.

The main app screen will show:
A list of all notes occupying most of the page.  Notes should appear in created-date order with the most recently created at the bottom of the list, apart from notes put in order (see "Setting the order of notes").  Each row should show the note title.  Rows should be separated by a thin horizontal line, dark enough to show clearly between notes of any colour.
If there isn't enough space to show all notes, then scroll vertically to see the rest.
There will be an area to enter a new note at the bottom of the page - always visible even if there are more notes than fit.  This area at the bottom should not scroll when the list of notes scrolls.  This area should be fixed height, 150px tall.
There should be no "New note" heading.
Horizontal padding in the "New note" area should be very small, to maximise the horizontal space for note content.
The Add button (in the New note area) should have an icon (fa-circle-plus) and no text.  The button should be the same size as the cog icon Settings button in the top header.
For now, phone layout is not important, I will make changes later to address that use-case.

### Columns

The Settings page should have a "Columns" setting, where a number between 1 and 4 can be chosen (default: 1).
This setting should appear alongside the "Stylus mode" setting at the top of the list of Settings.
The value for this setting should be saved into browser local storage so that it is remembered / retained on this device.
This setting controls how notes are shown within the notes list.  Notes should be shown in vertical columns, the number of columns being specified by this setting.
The order of notes should be: top to bottom in the first column, then continuing top to bottom in the second column, and so on (columns go from left to right).

## Setting the order of notes
In the second header (with the additional filter dropdowns): to the far right of the screen, have a new button with icon fa-arrow-down-wide-short.  This is the "edit order" button.
When this button is clicked, editing-order mode is activated.  The "edit order" button should change to icon fa-clipboard-check.  Clicking the button again deactivates editing-order mode.
Whilst the notes-list page is in editing-order mode, each note should have an icon on its left: fa-grip-vertical.
Whilst in editing-order mode, the edit / set-waiting / set-archived buttons on each note are hidden. In their place are two buttons: fa-angles-up and fa-angles-down. Clicking angles-up moves the note to the top of the list; clicking angles-down moves it to the bottom.
Clicking and holding on one of the fa-grip-vertical icons causes that note to start dragging.  It can be dragged up or down.  When the note-being-dragged is hovered over the gap between two other notes, then a gap opens up between those notes ready to accept the note-being-dragged.  If the mouse/finger/stylus is then released, the note is dropped into this new location.  This updated ordering is then sent to the server and should be reflected in all other browsers that have this tab open.
There is one shared order of all notes, rather than one per Tab. Every Tab, including "All", lists its notes in that shared order, so notes that show on several tabs are always in the same order relative to each other, whichever tab is showing. Moving a note within a tab moves it relative to the notes that tab shows, and notes the tab doesn't show keep their places. Notes not yet in the shared order (such as newly added ones) appear below the ordered ones, oldest first.
The "All" tab can be ordered too, and supports adding a note at the top.

### Adding a note at the top
When adding a new regular note, adding it with Ctrl+Enter puts it at the top of the list in the current tab, instead of at the bottom as usual.
A long press on the Add button (instead of a normal short click) does the same. Once the press has lasted long enough, the button changes so it's clear that the long press has been detected. This must be easy to see while a finger covers the button: an animation spreads out beyond it.
The long press must work with a finger on an Android phone too, with the keyboard open: letting go adds the note at the top, and the keyboard is ready for the next note.

## Editing Notes

On the Notes page, in the notes-list area: each note should have an "edit" icon.  The icon should be shown on the right-hand side of the screen.  The icon should be 16px wide by 16px high, inside a 24px-square tap area.  This is small, I am making a trade-off between ease of tapping versus retaining maximum area for note content.
When the edit icon is clicked for a note, the Add-Note section changes into edit-mode.  For text-notes, the text control is shown with the current title of the note.  For image-notes, the canvas needs to be shown and the image needs to be loaded into the canvas.  Text-editing or image-editing becomes enabled according to the type of the note being edited and disregards whether stylus-mode is enabled or not.
In edit-mode, the "Add" button becomes an "Update" button (with icon fa-circle-check, size remains the same, no text), and a new "Cancel" button also appears.  The Cancel button uses icon fa-x and has no text.  It is the same size as the Add button.
Pressing Update causes any changes to the note to be saved to the server and the notes list updated to reflect the changes.  The Add-Note section reverts to its normal "Add" behaviour.
Pressing Cancel causes any changes to be discarded and the Add-Note section reverts to its normal "Add" behaviour.
Whilst in edit mode it should not be possible to switch to a different Tab.
Tag selections for a note can be updated in edit mode to have any new tag values.  Updating a note with new Tag selections can therefore cause the note to disappear from the current Tab - this is correct and wanted.

## Agreed technical decisions

### Lines between notes
- Each note row has a 1px line under it in black at 20% strength (`rgb(0 0 0 / 0.2)`), rather than the app's pale border colour. Being see-through, it shows as a darker shade of whatever colour the row has, so it's clear on every tag colour, mid grey on plain rows, and subtle on dark (archived) rows. The app's other borders keep the pale colour.

### New-note area
- The area is a fixed 150px high (including its padding and border) at the bottom of the page and never scrolls with the note list; the list fills the rest of the page below the header. Padding is reduced so the canvas, buttons and one row of dropdowns fit. If more appears than fits (an error message, or dropdowns wrapping onto a second row), the area scrolls inside itself; it never grows.
- A single-line text box and an "Add" button. Pressing Enter also adds the note. There is no "New note" heading; the text box keeps its placeholder text and an accessible label.
- **Side padding** is very small (about 4px), to give note content as much width as possible.
- **Icon buttons:** Add (`fa-circle-plus`), Update (`fa-circle-check`), Cancel (`fa-x`) and Clear (`fa-delete-left`) show only an icon, with a tooltip and screen-reader label giving the action. All four are the same size as the Settings cog (40px square). Add and Update are filled in the accent colour; Cancel and Clear are outlined.
- After a successful save the text box clears and keeps focus, and the list scrolls to the bottom so the new note is visible. (The box is made read-only, not disabled, while saving, since disabling it would take the focus away.)
- When the page loads, the list starts scrolled to the bottom.
- **Keeping the scroll position:** the list only jumps to the bottom when the page opens, when a note is added (here or on another device), or when the tab, the filter row or the search changes. When a note leaves the list (archived, waiting or moved to the bin where the tab hides it, or changed on another device), the list stays where it was. The browser's scroll anchoring keeps the notes in view from moving.
- In stylus mode the text box is replaced by the writing canvas (see Stylus mode in [stylus.md](stylus.md)).

### Columns
- **Setting:** "Columns" sits beside the Stylus mode switch at the top of the settings page, as four small buttons labelled 1 to 4 (default 1). It's remembered on this device in local storage. A device that saved 5 (allowed before) is treated as 4.
- **Layout:** the note list is split into that many balanced columns (CSS multi-column), and the whole list scrolls up and down as now. Notes flow top to bottom down the first column, then the second, and so on from left to right, so the newest note is at the bottom of the last column. A note is never split across two columns.
- A handwritten note wider than its column is shrunk to fit.
- **Balanced columns (accepted):** adding a note can move other notes between columns, as the columns even out. If this feels jumpy in use, an alternative is to fill each column to the screen's height and scroll sideways.

### Note ordering
- **One shared order:** a single `noteOrder`, an array of note ids, for all notes and every tab ("All" included). It's kept as a small setting on the server, in the database's `meta` table (like the All tab's placement), and in the save-file as a top-level `"noteOrder": [...]` (still version 2; a file without it has none, or gets one made from its tabs' orders, below).
  - `GET /api/notes` includes it as `noteOrder`. It's set with `PUT /api/notes/order` and `{ noteOrder: number[] }`; the server keeps only ids of existing notes, drops duplicates, saves, and tells other pages to reload. If two browsers reorder at the same time, the last save wins.
  - Changing it is one change in the History ("Changed the order of the notes"), with a "before" copy (a `setting` item, id 2), so going back undoes it.
- **List order:** every tab, "All" included, lists notes in `noteOrder` first, in that order. Notes that aren't in it (such as new ones) follow in creation order, so a normal add still appears at the bottom. Notes in `noteOrder` that a tab or its filters don't show are simply not listed there.
- **Deleted notes:** when notes are deleted (Empty Bin, or cancelling a new long-form note), the server removes their ids from `noteOrder` in the same save.
- **Switching from per-tab orders (once):** tabs used to keep their own `noteOrder`. When the server loads data with no shared order (the database the first time, or an older save-file), it makes one from the tabs' orders, then drops the tabs' own:
  - Tabs are taken in their Settings order. Each tab's notes are placed in its order wherever that doesn't conflict with a tab above it; where two tabs disagree, the higher tab wins. In practice: each of the tab's notes not yet placed goes straight after the nearest note before it in that tab's order that is already placed (or before the first placed one, if none is).
  - Notes in no tab's order aren't in the shared order, so they follow, oldest first.
  - This isn't a change in the History. The tab editor never changes the order, and a tab's `noteOrder` sent to the server is ignored.
- **"All" can be ordered:** it has the edit-order button like any tab, and adding at the top works there.
- **Edit-order button:** in the filter row, at the far right, the same 24px size as the note buttons. It shows `fa-arrow-down-wide-short` ("Edit order") when ordering is off and `fa-clipboard-check` ("Finish ordering") when it's on. If a tab already filters on every category, the row has no dropdowns. The row (and its reset button) is then still shown, just to hold the edit-order button. On "All", the row only shows its dropdowns and reset button.
- **Edit-order mode:**
  - It isn't remembered: it's off when the app opens.
  - It stays on when switching tabs, "All" included.
  - It can't be turned on while a note or long-form note is being edited. The button is greyed out, with the hint "Finish or cancel the edit first".
  - The note buttons (edit, Waiting or Reinstate, Archive or Move to bin) are hidden while it's on. In their place each note has two buttons of the same size: `fa-angles-up` ("Move to top") and `fa-angles-down` ("Move to bottom"), which move the note to the top or bottom of the list as shown (the same as dragging it there, so the rules under "Under extra filters" apply) and save the order. "Move to top" is greyed out on the first note and "Move to bottom" on the last, and both are while a note is being dragged.
- **Grips:** in edit-order mode each note shows an `fa-grip-vertical` icon at its left, in a 24px-wide handle.
- **Dragging:**
  - Pressing on a grip starts the drag straight away, with no hold delay. Mouse, stylus and finger all work, in stylus mode too, as the grips only appear in this mode.
  - The note follows the pointer up or down, and a gap the note's height opens between the two notes it's over. Releasing drops it there.
  - Escape, or releasing it where it started, changes nothing.
  - The list scrolls by itself when the pointer is near its top or bottom edge.
  - The grip has `touch-action: none`, so a finger drag doesn't scroll the page.
- **Columns:** with several columns, the order runs down the first column and then on down the next, and a note can be dropped into any column. The drop point is worked out from where the notes were when the drag started, so the columns re-balancing as the gap opens doesn't make it jump.
- **Moving within the shared order:** the moved note goes straight after the visible note it was dropped below, or straight before the first visible note if dropped at the top. "Move to top" and "Move to bottom" put it straight before the first visible note or straight after the last. Notes the tab or its filters don't show keep their places, so a move changes the note's place in every tab that shows it, but only among the notes it was near. Each move saves the whole order of every note (unordered ones are added at the end, oldest first), so after the first move nothing is unordered.
- **Live updates:** the list shows the new order as soon as the note is dropped, and the save is sent in the background. If it fails, the list returns to the saved order and a notice shows the error. If another page changes something mid-drag, the reload waits until the drag ends.

### Adding a note at the top
- **How:** the note is added as usual, then the shared order is saved with the new note straight before the first note listed in the tab (as filtered), or at the very front if the tab lists none. It's then at the top of this tab, and in the same place relative to those notes on every other tab.
- **Ctrl+Enter:** in the new-note title box (Cmd+Enter on a Mac). In stylus mode there's no text box, so only the long press applies.
- **Long press:** holding the Add button for 1 second (mouse, finger or stylus).
  - From then on, while it's still held, the button's icon changes from `fa-circle-plus` to `fa-circle-up`, and it gets a darker background and a ring. Letting go then adds the note at the top.
  - **While holding:** a thin ring in the accent colour fills round the button, clockwise from the top, over the second, so it's clear how long is left.
  - **At 1 second:** rings burst out from the button to about 3½ times its size, fading as they grow, two every second, until it's let go. They're drawn over the note list, outside the add area, so they show well beyond the finger.
  - **And a short buzz** (40 ms) where the device can vibrate (Android; iPhones can't).
  - **Reduced motion:** on devices set to reduce motion, there's no filling ring, and a steady ring round the button replaces the bursts.
  - Sliding off the button or letting go removes the rings straight away.
  - Letting go sooner is a normal add. Sliding off the button before letting go adds nothing, as with any button.
  - The browser's own long-press menu and text selection are suppressed on the button.
  - **Added on letting go, not on the click:** Chrome on Android sends no click when a finger is lifted after a long hold, so the long press acts when the finger (or mouse or stylus) is let go on the button. If a click follows anyway (mouse, stylus, some tablets), it's ignored, so the note is never added twice. Quick taps, clicks and Enter still add through the click as before.
  - **The keyboard comes back:** after a typed note is added, by a tap or a long press, the title box gets focus again, ready for the next note. Chrome closes the keyboard during a long hold and the app can't stop that, so it may close and then reopen.
- **Where it applies:** only when adding a new note, while online, on any tab, "All" included. Otherwise Ctrl+Enter and a long press do a normal add, and a long press shows no change on the button:
  - Offline, note ordering isn't available. The note is added at the bottom, with the notice "Added at the bottom: adding at the top isn't available offline."
  - While a note is being edited, the button is "Update", and Ctrl+Enter or a long press just saves.
  - While a long-form note is open, its new child notes can be added at the top too.
- **Shown at once:** the note appears at the top straight away, and the list scrolls to the top so it can be seen. If saving the order fails, the note stays added, moves to the bottom, and a notice says "The note was added at the bottom: <error>".

### Editing notes
- **Edit icon:** each note in the list has an `fa-pen` icon at the right-hand side, which responds to touch as normal (it's in the list, not the new-note controls). The icon is 16px inside a 24px-square tap area, a deliberate trade-off to leave more room for note content. The note being edited is highlighted in the list.
- **Lifetime while editing:** there's no Lifetime dropdown; editing keeps the note's Lifetime tag.
- **Edit mode:** clicking the icon turns the bottom area into edit mode for that note. A typed note shows the text box with its title; a handwritten note shows the canvas with its image, whatever stylus mode is set to. "Add" becomes "Update" and a "Cancel" button appears (for handwritten notes, "Clear" stays too). Enter updates a typed note; Escape cancels.
- **Loading an image:** the note's image is drawn at its original size at the top-left of the canvas. If it's wider than the canvas (e.g. written in landscape, edited in portrait), it's shrunk to fit, so nothing is lost on Update. Editing a handwritten note means writing more on it or using "Clear" to start again; there's no eraser.
- **Draft:** pressing edit while part-way through a new note discards that draft (typed text or writing). The new-note tag choices are kept and come back after Update or Cancel.
- **Tags while editing:** the dropdowns show the note's own tags and can be changed to anything; the selected tab's locked and required rules don't apply. If the new tags no longer match the selected tab, the note disappears from it after Update, as intended.
- **Update:** saves with `PUT /api/notes/:id` and updates the list in place, without scrolling it. An empty title is refused ("The note title can't be empty" / "Nothing has been written yet"), since notes can't be deleted yet. If saving fails, the error is shown and the edits are kept for a retry.
- **Cancel** discards the changes. After Update or Cancel the area returns to adding notes, empty, with the earlier tag choices.
- **What's blocked while editing:** changing tab, the additional tab filters, every note's edit, archive, reinstate and bin buttons, and the Settings cog, so nothing is left half-edited.
