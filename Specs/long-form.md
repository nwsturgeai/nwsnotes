# Long-form notes

## Long-form Notes

A long-form note has "details" (text or image) as well as a title.  The title of a long-form note must always be text (i.e. never an image).  Long-form notes can have "child" regular notes.
When creating or editing a long-form note, the long-form note editing area takes up all of the screen apart from the create/edit regular note section (which takes up the bottom 150px or 250px).  In other words, the long-form editing area covers over both header strips and the whole note list area.
The button to create a new long-form note appears when the create-regular-note section is expanded to 250px height.  When this happens, a new "create long form note" button should appear underneath the create-note button (or underneath the "clear" button in stylus mode).  The new button should be the same size as the create-note button, and should have icon fa-file-lines.
After clicking "create long form note", the long-form note editing area should be shown, and the long-form-note workflow begins (see below).  The chevron to collapse the create-regular-note section should be disabled whilst creating or editing a long-form note.

The long-form note editing area contains the following:
A textbox to type the title, across most of the top of the screen.
An "accept title" icon button (fa-check) in the top-right.
A set of dropdowns for setting tags.  These appear underneath the title textbox.
A large textarea (multiline text accepted) or canvas for entering the details of this note (canvas if in stylus-mode, textarea otherwise).
A button with text "Finish" centred below the textarea/canvas.  The textarea/canvas should occupy all the vertical space between the dropdowns and the Finish button.

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

When initially creating a new long-form note (not when editing one), there is a "Cancel" button to the left of the "Finish" button.
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
On the far right of this bar there is an icon button (the same size as the single-note edit button), with icon fa-rectangle-list.  Clicking this button causes the tag dropdown selections to be updated to match the current Tab: within this Tab, any filters that have single values cause that Tag to be selected within the corresponding Category dropdown.

### Regular notes whilst creating / editing a long-form note
Whilst a long-form note is being created / edited, after the long-form-note title has been set for the first time, then new regular notes can be created, using the standard new note area at the bottom of the screen.
New regular notes created whilst creating/editing a long-form note can have any Tags.  By default, when a long-form note is being created/edited, the new-regular-note tags should be preselected to match the currently-active Tab, but they can subsequently be clicked to be changed to any different set of Tags.

Any regular note created whilst creating/editing a long-form note:
These new regular notes should have their "parentId" field populated with the id of the long-form-note.
When these regular notes are shown in the notes-list: after any pills for their tags, the regular note should have an additional final pill with the title of the long-form note, truncated to at most 20 characters.  This final pill should have the same colour as the "Long Form" pill described above.

## Agreed technical decisions

### Long-form notes
- **Data:** a long-form note has a text title (`titleText`, never `titleImage`) and exactly one of `detailsText` (at most 10,000 characters) or `detailsImage` (a PNG data URL). Having one of these fields is what makes a note long-form. The kind is chosen when the note is created, from stylus mode at that moment (canvas → `detailsImage`, otherwise `detailsText`), and never changes afterwards, like a regular note's title type. A new long-form note starts with empty details (`detailsText: ""` or `detailsImage: ""`).
- **Child notes:** regular notes created while a long-form note is open get `parentId` set to its id. The server checks that `parentId` names an existing long-form note; long-form notes can't have a parent, and a child can't be long-form. If the parent is later deleted (Empty Bin), the child keeps its `parentId` but its parent pill no longer shows.
- **Titles** follow the usual title rules (trimmed, not empty, at most 500 characters). They don't need to be unique.
- **Image size:** handwritten details fill a much larger canvas than a title, so `detailsImage` may be up to 2 MB (counting the data URL's characters), and the server's request size limit rises to 3 MB. Like titles, the drawing is cropped to what's written plus a margin, and stored at 2× pixel density.
- **API:** `POST /api/notes` with `{ "titleText": "...", "detailsText": "" | "detailsImage": "", "tagIds": [...] }` creates a long-form note (New, like any new note). `PUT /api/notes/:id` updates it with the same fields; the details kind can't change. Child notes are created with `POST /api/notes` plus `"parentId": <id>`.
- **Converting a regular note:** while a regular note is being edited in the expanded (full-tag-list) area, a "Convert to long-form note" button (`fa-maximize`) takes the list-check button's place.
  - Clicking it saves the note with its title and tags as they are in the edit, plus empty details, using `PUT /api/notes/:id` with `detailsText: ""`, or `detailsImage: ""` in stylus mode. The details kind is chosen from stylus mode, as when creating one.
  - It then opens in the long-form editor with the title accepted, ready for the details (typed details get the focus), like editing an existing long-form note: no Cancel button, and new regular notes become its children.
  - The note keeps its id, created time, Lifetime and place in the list.
  - The server allows a regular note to gain details only if it could have been created as a long-form note: a typed title, and no parent. Otherwise the button is greyed out, with the hint "Only typed notes can become long-form notes" (handwritten notes) or "This note belongs to a long-form note, so it can't become one" (child notes).
  - A long-form note can't be turned back into a regular one.
  - Offline, it's queued like any other edit.
- **Opening the editor:** the "create long-form note" button (`fa-file-lines`, 40px like Add) appears under Add (or under Clear in stylus mode) only while the bottom area is at 250px. The pen on a long-form note in the list opens the same editor with the title locked and the details editable. While the editor is open, the bottom area's chevron is disabled.
- **Editor layout:** it covers the header, the filter row and the note list, leaving only the bottom add-note area. Top: the title box with the accept-title (`fa-check`) / edit-title (`fa-pen`) button at the top right; the box is 40px high, the same as that button. Under it: the tag dropdowns (the normal kind; no Lifetime dropdown and no tab rules). Then the details textarea or canvas filling the space down to a centred "Finish" button.
- **Tags band:** so the note's tags stand out, the dropdowns sit in a full-width band between the title and the details.
  - The band has the header's background colour and a thin line above and below. It has no text label (it's labelled "Tags" for screen readers).
  - Its dropdown buttons have a 2px border: dark grey when no tag is chosen, and accent green, with dark text, once one is.
  - This is only in the long-form editor; the new-note area's dropdowns are unchanged.
- **Match the tab:** at the far right of the tags band, an `fa-rectangle-list` icon button, the same 24px size as the note buttons.
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
  - "Finish" sends any pending change straight away, then closes the editor. A pending change is also sent straight away if the app goes into the background.
  - Outside stylus mode, Ctrl+Enter, Alt+Enter or Cmd+Enter (Mac) anywhere in the editor does the same as clicking "Finish" (plain Enter still adds a line in the details, or accepts the title).
  - **Cancel (new notes only):** a "Cancel" button left of "Finish", shown only when the editor was opened to create a note (and still shown after its title is accepted), never when editing an existing one. Details count as empty when the typed text is only spaces or the canvas has no ink. With empty details it closes straight away. Otherwise it first asks "Are you sure you want to delete this note?" in the app's own pop-up, with Yes (red, focused) and No (Escape counts as No; the editor stays open). Closing drops any unsent change; if the title had been accepted, the note is deleted on the server (`DELETE /api/notes/:id`, a normal save) and the list reloads. If the delete fails, the error shows in the editor and it stays open. Child notes added while it was open are kept, and lose their parent pill, as when a parent is emptied from the Bin. In stylus mode, finger taps on Cancel are ignored, like Finish.
  - If a save fails, a small notice shows and it's retried at the next window.
  - Each save tells other open pages to reload. If two pages edit the same note, the last save wins; an open editor isn't changed by live updates.
- **Fewer save-files while editing:** the server remembers what caused its last save. When a long-form note is updated and the previous save-file was also an update of that same note, the previous file is deleted after the new one is written. So a long editing session leaves one save-file, not one per 30 seconds. A note's creation, other changes in between (e.g. a child note being added) and server restarts all break the run, so those files are kept.
- **Stylus mode:** fingers don't draw on the details canvas, and finger taps on "Finish", "Cancel" and the eraser button are ignored (a stylus or mouse works). The editor's other buttons respond to touch. There's no Clear button for the details canvas; the eraser is used instead (see below). If the canvas changes size (e.g. the device is rotated), the current drawing (including anything not yet saved) is kept at the top-left, cut off if it no longer fits; the next save stores what's visible.
- **Eraser:**
  - **When it shows:** whenever a long-form note's details are a canvas, whatever the stylus-mode setting. Handwritten details stay a canvas even with stylus mode off.
  - **Button:** an `fa-eraser` icon button (the same 40px icon style as the editor's other buttons). It sits at the far left of the row with Cancel and Finish, which stay centred.
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
- **In the list:** long-form notes show their title and tag pills, then a "Long Form" pill in a distinct colour (amber); their details aren't shown. Child notes show, after their tag pills, a pill with the parent's title cut to at most 20 characters, in the same amber. Long-form notes get the usual buttons (edit, waiting, archive and so on).
