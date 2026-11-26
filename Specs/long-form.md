# Long-form notes

## Long-form Notes

A long-form note has "details" (text or image) as well as a title.  The title of a long-form note must always be text (i.e. never an image).  Long-form notes can have "child" notes, regular or long-form (see "Parent notes" below).
When creating or editing a long-form note, the long-form note editing area takes up all of the screen apart from the create/edit regular note section (which takes up the bottom 150px or 250px).  In other words, the long-form editing area covers over both header strips and the whole note list area.
While creating or editing a long-form note with typed details, the create/edit regular note section can still be collapsed or expanded. While creating or editing a long-form note with handwritten details, that section switches to collapsed mode and can't be expanded.
The button to create a new long-form note appears when the create-regular-note section is expanded to 250px height.  When this happens, a new "create long form note" button should appear underneath the create-note button (or underneath the "clear" button in stylus mode).  The new button should be the same size as the create-note button, and should have icon fa-file-lines, in its outline style (Font Awesome "regular").
After clicking "create long form note", the long-form note editing area should be shown, and the long-form-note workflow begins (see below).  The chevron to collapse the create-regular-note section should be disabled whilst creating or editing a long-form note.

The long-form note editing area contains the following:
A textbox to type the title, across most of the top of the screen.
An "accept title" icon button (fa-check) in the top-right.
A set of dropdowns for setting tags.  These appear underneath the title textbox.
A large textarea (multiline text accepted) or canvas for entering the details of this note (canvas if in stylus-mode, textarea otherwise).
A "Finish" icon button at the right-hand end of the strip below the textarea/canvas.  The textarea/canvas should occupy all the vertical space between the dropdowns and that strip.

### Exporting handwritten details
When creating or editing a long-form note whose details are handwritten, there is an export button in the bottom strip. It exports the handwriting (not the title) as an image, using the device's share options (so it can be saved or sent to another app).

### Pages of handwritten details
Handwritten details can have several pages (at most 10), each its own image. In the bottom strip, between the pen-thickness buttons and the export button: the page number and count (e.g. "2/5", always shown, "1/1" for a single page), Previous page and Next page buttons (hidden when the screen is too narrow for them; on narrower screens still, the pen-thickness buttons are hidden too), and a page-options button (`fa-copy`, outline style) that opens a menu: Previous page, Next page, Add page after this one, Delete this page.
Next page on the last page asks "This is the last page. Add a new page?"; Yes adds a page and moves to it. Deleting a page asks first. Export joins all the pages into one long image.

### Eraser
When creating/editing a long-form note in stylus mode, alongside the Finish button (and maybe Cancel button), right at the left-hand edge of the page, there should be an icon button with icon fa-eraser.
This button can be in 2 states: unselected (default), and selected.  Pressing the button toggles between the states.  In selected state, the button colours should be inverted.
Whilst this button is selected: if/when the stylus is touched down within the details-editing area, then instead of drawing a new line, the stylus acts as an eraser, wiping out any lines underneath it, within a circle of diameter 20 pixels centered on the point the stylus is touching.


### Workflow
Details of a long form note can only be created / edited after the title has been set.  The title has to be non-empty.
Clicking "accept title" causes the new long form note to be created (details initially empty) and makes the details available to be edited.
Once the title is set, the "accept title" button changes to become an "edit title" button (icon fa-pen).  If the title is being edited then the details are locked and uneditable - the details can only be edited whilst the title is locked and uneditable.
When "edit title" is clicked then the title becomes editable and the details locked.  The "edit title" button reverts to being "accept title".  Clicking "accept title" for a note that has already been created causes the new title to be sent to the server, the title becomes locked again, the details editable, and "accept title" once again becomes "edit title".
Once the long form note details are being edited: if the details are changed then an updated version of the note should be sent to the server.  Wait for 30 seconds before sending an updated note to the server, and send new updates at most once every 30 seconds.
The tags for a long-form note can be updated either when the title is being set/edited, or when the details are being edited.
Tags for a long-form note are not limited to the tags matching the current Tab.  In other words, once finished, this new long-form note might not appear in the current tab.

When "Finish" is clicked, then:
the current version of the note is saved i.e. don't wait for the 30-second timer to complete.
the screen reverts to the regular notes-list view, including the 2 header strips.

When initially creating a new long-form note (not when editing one), there is a "Cancel" icon button just to the left of the "Finish" button.
If Cancel is clicked and the details are empty, then the new long-form note page closes and the screen reverts to the notes list.  If the new long-form note had already been saved (because the title had been set), then it is deleted.
If Cancel is clicked and the details are non-empty, then a confirmation modal opens: "Are you sure you want to delete this note?", with options "Yes" and "No".

On the server, when receiving an update for a long-form-note (either because of the timer, or a click of the Finish button):
If the most recent previous save file was also created because of an edit of this same long-form note, then after creating the new save file, delete the previous save file.

New long-form notes should start with the "New" lifetime tag (the same as regular notes).
Long-form notes are displayed in the notes list the same as regular notes.  The only difference: after any tag pills, there should be an extra pill with text "Long Form".  This final pill should have a different colour.


### Editing a long-form note
Within the notes list, when the Edit button is clicked on a long-form note:
The main page area should switch into long-form note editing mode.  The current title and details of the note should be populated into the appropriate controls.  The title is initially locked so that the details can be edited.  The button "edit title" is shown (i.e. not "accept title").

### Converting a regular note to a long-form note
When editing a regular note with the new-note area expanded, the "go into select mode" (list-check) button should be hidden instead of just being greyed out.
In its place there should be a new "Convert to long-form note" button, icon fa-maximize.  Clicking this causes the note to open into the long-form note editor with the title accepted.

### Matching the tab's tags in the long-form editor
In the long-form note editor's tag dropdowns bar (just under the title), there is no "Tags" text label.
On the far right of this bar there is an icon button (the same size as the single-note edit button), with icon fa-tags.  Clicking this button causes the tag dropdown selections to be updated to match the current Tab: within this Tab, any filters that have single values cause that Tag to be selected within the corresponding Category dropdown.

### Regular notes whilst creating / editing a long-form note
Whilst a long-form note is being created / edited, after the long-form-note title has been set for the first time, then new regular notes can be created, using the standard new note area at the bottom of the screen.
New regular notes created whilst creating/editing a long-form note can have any Tags.  By default, when a long-form note is being created/edited, the new-regular-note tags should be preselected to match the currently-active Tab, but they can subsequently be clicked to be changed to any different set of Tags.

Any regular note created whilst creating/editing a long-form note:
These new regular notes should have their "parentId" field populated with the id of the long-form-note.
When these regular notes are shown in the notes-list: after any pills for their tags, the regular note should have an additional final pill with the title of the long-form note, truncated to at most 20 characters.  This pill has a different colour from the "Long Form" pill described above.

## Parent notes

Long-form notes can be children of other long-form notes, so notes form a tree.

### "Long-form" filter
A dropdown in the filter row, just before the Properties dropdown, titled "Long-form". It's only shown when the tab has any long-form notes (with the filter row cleared).
Its options are one tickbox per long-form note in the tab. A long-form note (Y) that is a child of another (X) is listed immediately under X, slightly indented.
Ticking an option filters the list to that long-form note and every note under it (its children, their children, and so on).
Ticking X also ticks Y, which stays ticked (and can't be unticked) while X is ticked. Unticking X always unticks Y.

### Pills
The "Long Form" pill is a different colour from the pill showing a child note's parent.
A long-form note with child notes (direct children only) shows another pill: the fa-chart-diagram icon, then the number of child notes. If some of them aren't shown in this tab (ignoring the filter row), the pill says "<icon> <shown in this tab> of <total>".

### Parent line and pop-up
When adding or editing a regular note (not while a long-form note is being created or edited), with the add area expanded, and when there's at least one long-form note not in the Bin: the add area has a last line after the categories (after "Shared with me"), titled "Parent", with a single pill in the parent pill's colour.
For new notes the pill starts as "(none)". When the note being added or edited has a parent, the pill is the same as the note's parent pill in the list.
Tapping the pill opens a pop-up for setting, changing or removing the note's parent: every long-form note in the system (not just those in the tab), with tickboxes laid out like the "Long-form" filter. Zero or one can be ticked.
When creating or editing a long-form note, the same "Parent" title and pill appear in the band between the title and the details, alongside the tag dropdowns, with the same pop-up.
Changing the parent isn't offered when bulk-editing tags.

## Agreed technical decisions

### Long-form notes
- **Data:** a long-form note has a text title (`titleText`, never `titleImage`) and exactly one of `detailsText` (at most 10,000 characters) or `detailsImage` (a PNG data URL). Handwritten details with more than one page keep the first page in `detailsImage` and the rest, in order, in `detailsMorePages` (see "Pages" below). Having one of these fields is what makes a note long-form. The kind is chosen when the note is created, from stylus mode at that moment (canvas → `detailsImage`, otherwise `detailsText`), and never changes afterwards, like a regular note's title type. A new long-form note starts with empty details (`detailsText: ""` or `detailsImage: ""`).
- **Child notes:** regular notes created while a long-form note is open get `parentId` set to its id. Any note, long-form ones included, can also be given a parent with the Parent pill (see "Parent notes" below).
  - The server checks that `parentId` names an existing long-form note in the same notebook: a child note always belongs to the same person as its parent, including for people a tag is shared with.
  - On `PUT /api/notes/:id`, `parentId` sets the parent, `null` takes the note out of its parent, and leaving it out keeps the parent it has (so other edits, like tapping the date, don't need to know it).
  - No loops: a note can't be its own parent, nor go inside one of its own descendants. The server refuses (400) and the pop-up greys those out.
  - If a parent is deleted (Empty Bin, or cancelling a new long-form note), its children lose their `parentId`, as part of the same change. Going back to before it in the History brings the links back with the parent.
  - The History describes a change of parent on its own as `Moved "Book flights" under "Holiday plans"` or `Took "Book flights" out of "Holiday plans"`; with other changes, it's added to "Edited …".
- **Titles** follow the usual title rules (trimmed, not empty, at most 500 characters). They don't need to be unique.
- **Image size:** handwritten details fill a much larger canvas than a title, so `detailsImage`, and each page in `detailsMorePages`, may be up to 2 MB (counting the data URL's characters). With up to 10 pages, the server's request size limit is 24 MB. Like titles, the drawing is cropped to what's written plus a margin, and stored at 2× pixel density.
- **API:** `POST /api/notes` with `{ "titleText": "...", "detailsText": "" | "detailsImage": "", "tagIds": [...] }` creates a long-form note (New, like any new note). `PUT /api/notes/:id` updates it with the same fields; the details kind can't change. Child notes are created with `POST /api/notes` plus `"parentId": <id>`.
- **Converting a regular note:** while a regular note is being edited in the expanded (full-tag-list) area, a "Convert to long-form note" button (`fa-maximize`) takes the list-check button's place.
  - Clicking it saves the note with its title and tags as they are in the edit, plus empty details, using `PUT /api/notes/:id` with `detailsText: ""`, or `detailsImage: ""` in stylus mode. The details kind is chosen from stylus mode, as when creating one.
  - It then opens in the long-form editor with the title accepted, ready for the details (typed details get the focus), like editing an existing long-form note: no Cancel button, and new regular notes become its children.
  - The note keeps its id, created time, Lifetime and place in the list.
  - The server allows a regular note to gain details only if it has a typed title. Otherwise the button is greyed out, with the hint "Only typed notes can become long-form notes". A child note keeps its parent.
  - A long-form note can't be turned back into a regular one.
  - Offline, it's queued like any other edit.
- **Opening the editor:** the "create long-form note" button (`fa-file-lines`, the outline ("regular") version, 40px like Add) appears under Add (or under Clear in stylus mode) only while the bottom area is at 250px. The pen on a long-form note in the list opens the same editor with the title locked and the details editable. While the editor is open:
  - **Typed details:** the bottom area's chevron works as usual, and changing it changes the remembered setting, as anywhere else.
  - **Handwritten details:** the bottom area collapses to 150px when the editor opens, giving the canvas more height, and its chevron is disabled. This doesn't change the remembered setting: when the editor closes, the area goes back to how it was before.
  - **The chevron is drawn above the editor** while it's open, so the whole round button shows on the divider, as it does over the note list, rather than its top half being hidden under the editor. It's in the middle of the editor's bottom edge, clear of the eraser, pens and page buttons at the left and Export, Cancel and Finish at the right. With handwritten details it shows in full but greyed out.
- **Editor layout:** it covers the header, the filter row and the note list, leaving only the bottom add-note area. Top: the title box with the accept-title (`fa-check`) / edit-title (`fa-pen`) button at the top right; the box is 40px high, the same as that button. Under it: the tag dropdowns (the normal kind; no Lifetime dropdown and no tab rules). Then the details textarea or canvas filling the space down to the bottom row, with the Finish button at its right-hand end.
- **Tags band:** so the note's tags stand out, the dropdowns sit in a full-width band between the title and the details.
  - The band has the header's background colour and a thin line above and below. It has no text label (it's labelled "Tags" for screen readers).
  - Its dropdown buttons have a 2px border: dark grey when no tag is chosen, and accent green, with dark text, once one is.
  - This is only in the long-form editor; the new-note area's dropdowns are unchanged.
- **Match the tab:** at the far right of the tags band, an `fa-tags` icon button, the same 24px size as the note buttons.
  - Clicking it chooses every tag that the selected tab's filters (and the additional filters) fix to a single value. These are the same tags the new-note area locks in.
  - In a single-select category the tag replaces whatever was chosen. In a multi-select category it's added to the tags already chosen.
  - Other categories, and filters that allow several tags, are left alone.
  - It's saved like any other tag change.
  - It's greyed out when there's nothing to match: under "All", or a tab whose filters all allow several tags. The hint says why.
- **Before the title is first accepted,** the bottom add-note area is greyed out, with the hint "Set the long-form note's title first". After that, regular notes added there are children of the long-form note. Their tags are free (see "Tags on child notes" below).
- **Tags on child notes:**
  - When the long-form editor opens, the new-note tag dropdowns start on the tab's tags, as before. From then on they aren't locked, any tags can be chosen, and the tab's required categories aren't enforced.
  - A child note that doesn't match the tab and the filters is saved but isn't shown in the list, with the notice "Note added, but it doesn't match this tab, so it isn't shown here."
  - When the editor closes, the dropdowns go back to the selections they had before it opened, and the tab's rules apply again.
- **Saving:**
  - Accepting the title (first time) creates the note; accepting it again saves the new title. Tag changes made while editing the title are saved with it. After accepting, typed details get the focus.
  - While the title is locked, clicking the title box does the same as "edit title".
  - Details and tag changes made while editing the details are saved at most every 30 seconds: the first change starts a 30-second timer, and when it runs out the latest version is sent; later changes wait for the next window.
  - **Finish and Cancel buttons:** 40px icon buttons, like the editor's other buttons, at the right-hand end of the bottom row: Finish (`fa-circle-check`, filled in the accent colour) at the far right, with Cancel (`fa-x`, plain) just to its left when shown. Their tooltips and accessible labels are "Finish (Ctrl+Enter)" (just "Finish" in stylus mode) and "Cancel".
  - "Finish" sends any pending change straight away, then closes the editor. A pending change is also sent straight away if the app goes into the background.
  - Outside stylus mode, Ctrl+Enter, Alt+Enter or Cmd+Enter (Mac) anywhere in the editor does the same as clicking "Finish" (plain Enter still adds a line in the details, or accepts the title).
  - **Cancel (new notes only):** a "Cancel" button left of "Finish", shown only when the editor was opened to create a note (and still shown after its title is accepted), never when editing an existing one. Details count as empty when the typed text is only spaces or the canvas has no ink. With empty details it closes straight away. Otherwise it first asks "Are you sure you want to delete this note?" in the app's own pop-up, with Yes (red, focused) and No (Escape counts as No; the editor stays open). Closing drops any unsent change; if the title had been accepted, the note is deleted on the server (`DELETE /api/notes/:id`, a normal save) and the list reloads. If the delete fails, the error shows in the editor and it stays open. Child notes added while it was open are kept, and lose their parent pill, as when a parent is emptied from the Bin. In stylus mode, finger taps on Cancel are ignored, like Finish.
  - If a save fails, a small notice shows and it's retried at the next window.
  - Each save tells other open pages to reload. If two pages edit the same note, the last save wins; an open editor isn't changed by live updates.
- **Fewer save-files while editing:** the server remembers what caused its last save. When a long-form note is updated and the previous save-file was also an update of that same note, the previous file is deleted after the new one is written. So a long editing session leaves one save-file, not one per 30 seconds. A note's creation, other changes in between (e.g. a child note being added) and server restarts all break the run, so those files are kept.
- **Stylus mode:** fingers don't draw on the details canvas, and finger taps on "Finish", "Cancel" and the eraser button are ignored (a stylus or mouse works). The editor's other buttons respond to touch. There's no Clear button for the details canvas; the eraser is used instead (see below). If the canvas changes size (e.g. the device is rotated), the current drawing (including anything not yet saved) is kept at the top-left, cut off if it no longer fits; the next save stores what's visible.
- **Eraser:**
  - **When it shows:** whenever a long-form note's details are a canvas, whatever the stylus-mode setting. Handwritten details stay a canvas even with stylus mode off.
  - **Button:** an `fa-eraser` icon button (the same 40px icon style as the editor's other buttons). It sits at the far left of the row, followed by the three pen-thickness buttons (see [stylus.md](stylus.md)) and the page buttons (see Pages below), with the export button (see Export below), Cancel and Finish at the far right.
    - Tapping it toggles it between unselected and selected. When selected its colours are inverted (accent background, light icon) and it's marked as pressed for screen readers.
    - It starts unselected each time the editor opens, and stays selected across strokes until tapped again.
    - It's greyed out while the details are locked, i.e. while the title is being edited.
    - In stylus mode, finger taps on it are ignored, like Finish.
  - **Erasing:**
    - While it's selected, a stylus or mouse on the canvas erases instead of drawing. Fingers still do nothing.
    - It rubs out the ink under a circle 20 CSS pixels across (40 canvas pixels at 2× density), centred on the pointer.
    - Dragging erases a continuous band, not just dots, and only the ink under the circle goes, so a line can be partly erased.
    - While erasing, a thin circle outline the size of the eraser follows the pointer, and while hovering if the pen reports hover.
  - **The pen's eraser end:** if the browser reports the stylus's eraser end or eraser button (`buttons` bit 32), that always erases, whether or not the button is selected. Whether a given tablet reports it can only be checked on the device.
  - **Saving:** erasing counts as a change and is autosaved like drawing. When each erase stroke ends, the remaining ink is re-measured, so the saved image is cropped tightly again. A fully erased canvas counts as empty, so Cancel closes without asking.
- **Pages:**
  - **Data:** `detailsImage` is the first page; `detailsMorePages` (only with `detailsImage`) lists the pages after it in order, each a PNG data URL or `""` for a blank page. It's left out when there's only one page, and has at most 9 entries (10 pages in all). The server refuses (400) more pages, `detailsMorePages` without `detailsImage`, or a page that isn't a PNG within the 2 MB limit. A `PUT` sets exactly the pages it sends: leaving `detailsMorePages` out means a single page. A note shared with you can be deleted by someone it's shared with only when every page is blank.
  - **Where:** in the bottom row after the pen-thickness buttons, with the same 16px gap: the page counter, Previous page (`fa-chevron-left`), Next page (`fa-chevron-right`) and the page-options button (`fa-copy`, the outline ("regular") version), 4px apart; all 40px buttons like the others. They show whenever the details are a canvas, like the eraser.
  - **Counter:** "2/5" (this page / pages), always shown, "1/1" for a single page. Plain text to the left of the buttons, not a button; its tooltip is "Page 2 of 5".
  - **Narrow screens:** when the bottom row is narrower than 560px, Previous and Next are hidden (they're in the menu too). Below 440px the pen-thickness buttons are hidden too (the setting is still in Settings), so everything else fits on a phone.
  - **Previous page:** greyed out on the first page.
  - **Next page:** on the last page, asks "This is the last page. Add a new page?" (the app's own pop-up, Yes and No). Yes adds a blank page after it and moves to it; No does nothing. With 10 pages it's greyed out on the last page, with the tooltip "10 pages is the most a note can have".
  - **Page options menu:** opens above its button, and closes on choosing an option, tapping elsewhere or Escape.
    - **Previous page** and **Next page:** as the buttons (greyed out in the same cases).
    - **Add page after this one:** adds a blank page straight after the current one and moves to it, without asking. Greyed out with 10 pages.
    - **Delete this page:** asks "Delete this page?" (Yes in red, No). Yes deletes it and moves to the page before it, or to the new first page if page 1 was deleted. Greyed out when there's only one page.
  - **Greyed out** while the details are locked (the title being edited), like the eraser. In stylus mode, finger taps on the buttons and menu options are ignored.
  - **Each page keeps its own canvas** while the editor is open (only the current one is shown), so turning the page never moves or redraws what's written. The eraser and pen thickness carry across pages.
  - **Saving:** adding or deleting a page counts as a change and is autosaved like drawing. Each page is cropped to its own ink, like a single page. Cancel counts the details as empty when no page has ink.
- **Export:**
  - **Button:** an `fa-share-from-square` icon button (40px, like the others) over at the right of the bottom row, 24px before Cancel and Finish (or before Finish alone when there's no Cancel). Tooltip and accessible label: "Export as image". It shows whenever the details are a canvas, like the eraser.
  - **Greyed out** while no page has ink, and while the details are locked (the title being edited). In stylus mode, finger taps on it are ignored.
  - **The image:** what's on the canvases at that moment, including strokes not yet autosaved, as one PNG of black ink on a white background (the stored image is transparent, which some apps show as black). Each page with ink is cropped to it with the usual margin, and the pages go one under another, lined up on the left, with a 32-pixel gap and a thin grey line between them; blank pages are left out. Only the handwriting: no title.
  - **File name:** the note's title and the date, e.g. `Garden plan 2026-11-19.png`, with characters not allowed in file names taken out (just the date if nothing is left).
  - **How it's handed over:** the device's share sheet (`navigator.share` with the file) where the browser can share files, as on Android, so it can be saved to Photos or Files or sent to another app. Elsewhere (most PC browsers) the file is downloaded instead. Closing the share sheet without choosing anything does nothing.
- **In the list:** long-form notes show their title and tag pills, then a "Long Form" pill in a distinct colour (amber); their details aren't shown. Child notes show, after their tag pills, a pill with the parent's title cut to at most 20 characters (19 and "…"), in purple (`--parent-pill-bg`, `--parent-pill-text`). Long-form notes get the usual buttons (edit, waiting, archive and so on).

### Parent notes
- **Pill order** after a note's tags: "Long Form", then the parent's pill, then the child-count pill.
- **Child-count pill** (long-form notes with children): purple like the parent pill, the `fa-chart-diagram` icon, then the count of direct children not in the Bin (Archived and Waiting ones count). "Shown in this tab" uses the tab's own filters, not the filter row. Tapping it ticks that note in the Long-form filter (not while selecting or ordering notes, nor while a note is being edited).
- **Long-form filter:**
  - **Options:** the long-form notes that match the tab's own filters, in the notes' shared order, each followed by the long-form notes under it (indented 1.25rem per level). A note whose parent isn't an option is at the top level. Titles are cut to 40 characters; other people's notes show whose, like shared tags.
  - **Ticks:** stored with the row's other choices (per tab, per device) under the made-up category id -1001, as the ticked notes' ids. A note under a ticked one is never stored: it shows ticked, greyed and locked ("Ticked because a note it's inside is ticked"), and unticking the parent unticks it.
  - **Matching:** while any are ticked, a note must be a ticked note or under one (any depth, through notes the tab doesn't show too), as well as passing the tab, the other dropdowns and the search.
  - **Like the other dropdowns:** it turns the row yellow, "reset filters" clears it, and each option shows how many notes ticking only it would list, with the TOTAL line. No "select all". The other dropdowns' counts take it into account.
  - **New notes:** while exactly one note is ticked, new notes (regular and long-form) start with it as their parent, so they stay in the list. Otherwise a note that doesn't match is still added, with the notice "Note added, but it doesn't match the Long-form filter." An empty list says "No notes match the Long-form filter."
- **Parent line:** the parent chosen for new notes is kept for the next note, like the tags. Changing tab goes back to the Long-form filter's default (above). While editing, the pill starts on the note's parent and the choice is saved with Update (or when converting to long-form).
- **Parent pop-up:** titled "Parent note", with "Set Parent" (primary) and "Cancel" (and Escape). It lists every long-form note not in the Bin, as a tree like the filter, with full titles.
  - **Folding:** a note with notes inside it in the list has an `fa-caret-down` button left of its tick box (expanded, the default). Clicking it hides every note inside it, at every depth, and it becomes `fa-caret-right`; clicking again shows them. Notes without any have a space the same width, so the tick boxes line up. The button is outside the tick box's label, so it never ticks it. Not remembered: every note starts unfolded each time the pop-up opens.
  - **Waiting and Archived notes:** a small pill after the title says so, in the list's colours for those notes (Waiting light grey `#c0c0c0` with black text, Archived `#606060` with white text), with the icon of the list's button for that state (`fa-hourglass`, `fa-box-archive`) and the hint "This note is Waiting" / "Archived". New and Active notes have none. It's outside the checkbox's name. On a note that can't be chosen it's faded with the rest of the row.
  - **Filter by tag:** under the sort buttons, a "Filter by tag" section that folds away (an accordion: a header button with a chevron, closed at first; open or closed is remembered on the device, `nwsnotes.parentTagsOpen`). Open, it has the add area's own tag controls: each category as pills or a dropdown (see [tags.md](tags.md)), with one saved pills/dropdown state for the pop-up on this device (`nwsnotes.collapsedCategories.parent-dialog`), wherever it's opened from, separate from the tabs' add areas. No tab rules apply.
    - The ticked tags start empty each time the pop-up opens. While any are ticked, the header says how many ("(2 ticked)", shown when folded too) and a "clear tags" link clears them.
    - **Matching:** like the filter row: any ticked tag within a category, and every category with ticks.
    - **The tree stays readable:** the notes that match are listed with every note they're inside, greyed and not choosable ("Doesn't have the ticked tags: shown because a note inside it has them"). The chosen parent is always listed, so it can be unticked. With nothing matching: "No long-form notes have the ticked tags."
    - Escape while a dropdown's list is open closes just the list.
  - **Sort:** radio buttons at the top, "Note order" (the default: the notes' shared order) or "Alphabetical" (by title, ignoring case and formatting markers, numbers in number order). Either way child notes stay under their parent, sorted the same way among themselves. The choice is remembered on the device (`nwsnotes.parentSort`). Greyed out, with the reason on hover: the note being changed itself, notes under it, and notes in someone else's notebook (a parent must belong to the same person: the note's owner, or for a new note the owner of the shared tags it has).
- **In the long-form editor:** the Parent pill sits in the tags band after the dropdowns, before the match-the-tab button, shown when there's another long-form note it could go inside. A change is saved like a tag change (with the 30-second autosave, or straight away with the title).
