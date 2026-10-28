## Introduction and high-level

I want to create an app for managing my notes.
This app will be delivered as a website.
I have created a VM in DigitalOcean to host the server side of my website.
The VM should serve the static content of my website and also include a rest API which the website can call.
The server side API will be coded in typescript and will execute using nodejs.
The browser code should be written in typescript and should use React.
This site will be for a single user (me).  I should need a password to log in, this should be a string of 32 random characters.
The site should be delivered over HTTPS - I have a domain "nwsnotes.duckdns.org" which has a DNS entry pointing to my VM.
Use fontawesome icons.
The app should always be rendered with black/dark text on white/light backgrounds.  In other words, ignore if the device is set to "dark mode".

The website should have the necessary attributes to be useable as an Android Progressive Web App.

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

The main app screen will show:
A list of all notes occupying most of the page.  Notes should appear in created-date order with the most recently created at the bottom of the list.  Each row should show the note title.  Rows should be separated by a thin horizontal line.
If there isn't enough space to show all notes, then scroll vertically to see the rest.
There will be an area to enter a new note at the bottom of the page - always visible even if there are more notes than fit.  This area at the bottom should not scroll when the list of notes scrolls.  This area should be fixed height, 150px tall.
There should be no "New note" heading.
Horizontal padding in the "New note" area should be very small, to maximise the horizontal space for note content.
The Add button (in the New note area) should have an icon (fa-circle-plus) and no text.  The button should be the same size as the cog icon Settings button in the top header.
For now, phone layout is not important, I will make changes later to address that use-case.

## Settings and lifecycle

There will be a header strip across the top of the app.  The app will have a settings page, accessible by clicking a cog icon located on the right-hand edge of the top header strip.
The settings page will contain the option to log out (that won't be shown on the main notes page).
The settings page will contain an option to download the latest json file from the server containing all the notes data.  I will use this to manually take backups every few days.
The header strip should have the same background colour as the "New note" area at the bottom of the page.
There should be no app title shown at the left of the header - this area will be used for a different feature coming soon.

Any time a new note is entered, the website will send to the API a json blob containing all attributes of the new note.  The API will save a JSON blob to the local disk containing the current state of all notes - previously-added notes and also this new one.  Each save-file should include the timestamp in its filename.  Any and all note files created in the last week should be kept; files older than 1 week apart from the most-recent save-file should be deleted automatically.

Any errors on saving the note should be displayed under the new note title, leaving the typed title available so that retry is possible.

When the website is opened for the first time or refreshed, the site should make a call to the API to retrieve the most recently saved json blob containing all the note data.

The website should open a websocket connection to the server.  Whenever any data is changed by a particular website connection, the server should use the websocket to notify any other website connections to refresh their data. 

Whilst the page is loading, show text "Loading...".  If there is an error on startup (e.g. the API is unavailable) then show a page with all the details of the error.

### Columns

The Settings page should have a "Columns" setting, where a number between 1 and 4 can be chosen (default: 1).
This setting should appear alongside the "Stylus mode" setting at the top of the list of Settings.
The value for this setting should be saved into browser local storage so that it is remembered / retained on this device.
This setting controls how notes are shown within the notes list.  Notes should be shown in vertical columns, the number of columns being specified by this setting.
The order of notes should be: top to bottom in the first column, then continuing top to bottom in the second column, and so on (columns go from left to right).


## Tags

Tags will be arranged into Categories.  Each Category will have the following attributes:
id - a unique integer id.  Should be auto-created, starting at 1, each new category takes the next id value.
name - required, trimmed, at most 40 characters, unique
multiSelect - a boolean.  If true then a note can be tagged with multiple tags from this category.  If false then a note can be tagged with at most one tag from this category.
tags - a list of all the available tags within this category.  Each tag has a unique integer id (auto-generated) and a string giving the tag name.  Tag names can be at most 40 characters long.  Tag names must be unique within their category.  Tag ids should be unique across all categories, so the note only needs to store the tag id, not the category id.

All the categories (including all the tags within them) will also be saved into the same one json file (which also contains the note data) on the vm local disk.  Every time any category is added or changed, a new copy of the json file should be saved.

The settings page will have a Categories section showing a list of Categories.  There will also be a button to add a new Category.
Clicking on one of the Categories in the list will allow that Category to be edited.
Adding or editing a Category should share the same user-interface.
When adding or editing a Category, the user should be shown a list of all the tags available in that category.  The user can add new tags and rename existing tags.
Have a "Save" button to save all changes to a category in one go.  And a "Cancel" button to cancel any category edits and return to the last saved state.
If/when a category is saved, that should cause other tabs viewing the website to be sent the latest data (including the latest categories and tags).
Categories must contain at least one tag to be able to be saved.
It should not be allowed to have a tag with the same text as the category name.
When editing a category, there should be bin icons alongside each Tag allowing Tags to be deleted.  If, when a category is saved, any Tags have been deleted, then that tag-id should be removed from any notes that currently have it.
For now, it will not be possible to delete categories.
After a category has been saved as multi-select, it is not possible to revert it to single-select later.

### Tag sort order
The tags within each category have a sort order.
When editing a category, there should be up and down arrows alongside each tag, which can be clicked to move that tag up or down the list and so change the order.
The tag dropdowns (everywhere they appear) and the lists of tags in the expanded new-note section should all show the tags in this order.

### On the main notes page:
Each note should also display its tags.  These should be shown in a list of pills underneath the note title.  If 2 categories have tags with the same name, there is a possibility that a note has 2 tags with the same text.  This is OK.

### Tagging a new note / whilst editing a note:
When adding a note, the user can set tags.
There should be a dropdown for each Category.
Single-select and multi-select categories both use the same kind of dropdown: a button that opens a list.
For single-select categories, the list's first option (which corresponds to "no tag selected within this category") is the category name, and choosing an option replaces any previous choice.
For multi-select categories, the list is a check-list.  In both cases, the button shows the category name when no tag is chosen.
The dropdowns should appear underneath the textbox where the note title is entered.  The dropdowns should not have any titles.
After adding a note, the dropdowns retain their selections so that if the dropdowns aren't changed then a second new note would be given the same tags.

### Full-tag-list mode:
The add/edit-note area should be able to be toggled between standard mode and full-tag-list mode.
Full-tag-list mode will use more vertical space.  Toggling into full-tag-list mode should cause the add/edit note area to "grow" to be 250px high.
The button to toggle between these modes should appear over the divider separating the add/edit note area from the notes-list area.
When in full-tag-list mode, instead of showing dropdowns for each Category:
All of the available tags in each category should be shown as pills.  Each new Category's pills should start on a new horizontal line.
A pill shows a dark background if the new/editing note has that Tag.  A pill shows a light background if the new/editing note does not have this tag.
Clicking/tapping on the pill toggles whether the new/editing note has this Tag or not.  In stylus mode, finger touches on these pills does not cause them to toggle.
For a single-select category, clicking on one of the tag pills in this category automatically deselects/un-tags any other tag pills from this category.
The Lifetime Category continues to be not-shown in full-tag-list mode.
If the 250px area is too short to show all of the available tags, then the part of this area showing the tags should scroll vertically.  The textbox/canvas for typing the note title should never scroll.

### Multi-select
When in full-tag-list mode, an extra button should appear on the right of the edit-note area.  This button has icon fa-list-check.
Whilst the new-note title (text or details) is empty, this button can be clicked and toggled on.  Whilst switched on, the button colours are inverted.
The list-check button can also only be clicked whilst drag-mode is off.
Once this button is toggled on, it is no longer possible to enter a new note title - the text-box/canvas controls for entering a new note title should be hidden.
The add-note, clear-canvas, and new-long-form-note buttons should also be hidden whilst list-check is active.
Whilst the list-check button is on: all the notes in the notes-list gain an icon to their left.  This icon can either be unselected (fa-circle) or selected (fa-circle-check).  Clicking the note causes the note selection state to be toggled between unselected and selected.
Whilst the list-check button is on, it is not possible to edit / wait / archive / bin any notes.
Whilst the list-check button is on but no notes have been selected or no tag pills have been clicked, then clicking the list-check button again just toggles it off and the page returns to regular behaviour.
Any note-selections are lost when list-check mode is ended - restarting list-check mode always starts with no notes selected.

The point of multi-selecting notes is to be able to bulk-edit their tags.
The tag pill statuses (selected or unselected) in the new-note area should be updated to reflect which tags are set on the notes that have been selected.
This means that the tag pills in the new-note area now need to have a third "partially selected" state, to indicate that some of the selected notes have this tag, and others do not.

Once one or more notes have been selected, it is possible to click on any of the tag pills in the new-note area.  Clicking on a tag pill toggles it between selected and unselected (as before).  If a tag pill is partially-selected, clicking it sets it to fully-selected, and further clicks toggle between selected and unselected.
Once any tag pills have been clicked, it is no longer possible to select or deselect any notes in the notes list.
Once any tag pills have been clicked, a new "accept bulk tag updates" icon-button (fa-check) appears above the list-check button.
At this point, clicking "accept bulk tag updates" causes the selected notes' tags to be updated.  Tags should be added and removed only according to which tag pills were clicked on.  Any tag pills that weren't clicked on retain their state - i.e. an untouched tag-pill in partially-selected state means that selected notes retain whether they have that tag or not.
Clicking the list-check button still turns list-check mode off without making any changes, effectively discarding any note selections and tag-update selections.


## Stylus support

I will be using this website on an android device that has a stylus.
It should be possible to put the site into stylus mode.  This should be a toggle setting at the top of the settings page.
This new setting should be saved into browser local storage so that if the site is reloaded, this setting is remembered on this device.
When in stylus mode, a small icon (use fa-signature) should be displayed next to the settings cog at the right of the top header.
When in stylus mode, instead of typing a new note, I want to write the note onto an HTML canvas element.  In other words, when in stylus mode, whilst the stylus is "touched down" within the canvas, the website should capture the points that the stylus tip moves over, and should colour those black.  This should give the user the sense that they are writing onto the canvas.
Saving the note should capture the image data from the canvas and store that as the note's titleImage.  The canvas should be 80 pixels high.  When saving the image, crop down to just the area of the canvas that has anything written.
When displaying the list of notes, if a note has a title image (and no title text) then the image should be displayed, and no title text should be displayed.
Handwritten notes can still have tags the same as typed notes.

In stylus mode, the add-note area has a "Clear" button (as well as the Add button).  The Clear button should be the same size as the Add button and should use icon fa-delete-left and have no text.
The "Clear" button should be shown underneath the "Add" button - this gives more horizontal space for handwriting.
Considering the "Add" and "Clear" buttons, and all of the new note tag dropdowns: when in stylus mode, these controls should not respond to touch inputs - they should only respond to stylus or mouse inputs. Touch inputs should continue to work when not in stylus mode.

### Pen thickness

In the settings page, underneath the Stylus-mode/Columns section, and before the Lifetime section, add a new section for Pen controls.
For now the only control is for Pen thickness.  There are 3 possible pen thicknesses: 1.5px, 2.5px, 4.5px.  Show a set of buttons for these, with exactly one selected (colour inverted) at any time.  Clicking on one of the buttons selects that thickness.
The selected thickness should be remembered in browser local storage so that it persists on this device.
When creating/editing a canvas-based note, also when creating/editing the details of a canvas-based long-form note: when the pen is in writing mode (i.e. not eraser mode), then touching down with the pen should cause a line to be drawn on the canvas with a width given by the current pen thickness setting.


## Tabs

A Tab is a definition of a filter; when viewing a Tab you only see the notes that match the filter.

A Tab has the following attributes:
Name: unique string, max length 20 characters.
Categories: an array of structures, each containing a category id and one or more tag ids.

The Settings page will have a new section "Tabs".  This allows Tab definitions to be added, edited and deleted.  WIthin the section will be a list of existing tabs, and a button to create a new tab.
Existing tabs should show their name and the associated tag ids (rendered as pills the same as for notes in the Notes page).
When a tab has a filter that includes more than one possible tag for a particular category, any tags in that category should still show as pills under each note title in the list.
When creating or editing a tab, dropdowns for all the Categories are shown, the same as the dropdowns shown when adding a new Note.
After the user begins to add or edit a tab, there should be "Save" and "Cancel" buttons.

The first Tab should be called "All" and should have no filters.  This Tab cannot be edited or deleted.

Tab definitions should be stored in the same json file as notes and Category definitions.
Tab updates should cause other instances of the website to reload their data.

On the Notes page, towards the left of the header strip, the tabs should render.  They should be styled similarly to the tabs at the top of a typical web browser.  One tab is always selected - the All tab is selected when the page first opens.

Clicking on one of the Tabs causes that tab to become selected and appear to be in the foreground.
The only notes that are shown on the page are the notes that match the filter for the currently-selected Tab.  For each Category specified in the Tab definition, a note matches the filter if the note is tagged with at least one of the Tags in that filter definition Category object.
Notes that are "filtered out" remain in the system, they are just hidden.  They will be shown again when one of the other Tabs is selected.  The All tab will always show all notes.

When the currently-selected Tab has a Category filter containing a single Tag: the new-note area should have that one Tag automatically selected in the corresponding dropdown.  It should not be possible to change this selection.
Changing tab should cause all new-note dropdowns to reset, either to "unselected", or to the single value from the corresponding Tab Category filter.

### Additional Tab filters

Underneath the main "Tabs" header, a second header area is shown within the tab but above the list of notes.  This second header area should not scroll with the notes.
The second header area should show a set of dropdowns, one for each Category that is not specified in the Tab definition. These dropdowns behave the same way as when defining a Tab.
When a selection is made in any of these dropdowns, the notes shown in the list should be filtered using these selections in addition to any filtering from the Tab definition, using the same filtering logic as in the Tab definition.
The selections within the dropdowns should be saved into Browser Local Storage.  The selections should be linked to the Tab in which they were made. The next time this tab is opened on this device, the same selections that were there the last time should be preselected.
Just to the right of these dropdowns (i.e. not all the way to the right of the screen), there should be a "reset filters" button (same size as edit/archive/reinstate) (using icon fa-reply-all).  Clicking this button should clear the selections from all the dropdowns so that the Tab then shows notes filtered just by the Tab definition.


## Setting the order of notes
In the second header (with the additional filter dropdowns): to the far right of the screen, have a new button with icon fa-arrow-down-wide-short.  This is the "edit order" button.
When this button is clicked, editing-order mode is activated.  The "edit order" button should change to icon fa-clipboard-check.  Clicking the button again deactivates editing-order mode.
Whilst the notes-list page is in editing-order mode, each note should have an icon on its left: fa-grip-vertical.
Clicking and holding on one of the fa-grip-vertical icons causes that note to start dragging.  It can be dragged up or down.  When the note-being-dragged is hovered over the gap between two other notes, then a gap opens up between those notes ready to accept the note-being-dragged.  If the mouse/finger/stylus is then released, the note is dropped into this new location.  This updated ordering is then sent to the server and should be reflected in all other browsers that have this tab open.
The note ordering should be saved as an integer-array attribute on each Tab.  Any notes shown in a Tab that are not listed in the ordering should appear below any notes that have an ordering specified.



## Editing Notes

On the Notes page, in the notes-list area: each note should have an "edit" icon.  The icon should be shown on the right-hand side of the screen.  The icon should be 16px wide by 16px high, inside a 24px-square tap area.  This is small, I am making a trade-off between ease of tapping versus retaining maximum area for note content.
When the edit icon is clicked for a note, the Add-Note section changes into edit-mode.  For text-notes, the text control is shown with the current title of the note.  For image-notes, the canvas needs to be shown and the image needs to be loaded into the canvas.  Text-editing or image-editing becomes enabled according to the type of the note being edited and disregards whether stylus-mode is enabled or not.
In edit-mode, the "Add" button becomes an "Update" button (with icon fa-circle-check, size remains the same, no text), and a new "Cancel" button also appears.  The Cancel button uses icon fa-x and has no text.  It is the same size as the Add button.
Pressing Update causes any changes to the note to be saved to the server and the notes list updated to reflect the changes.  The Add-Note section reverts to its normal "Add" behaviour.
Pressing Cancel causes any changes to be discarded and the Add-Note section reverts to its normal "Add" behaviour.
Whilst in edit mode it should not be possible to switch to a different Tab.
Tag selections for a note can be updated in edit mode to have any new tag values.  Updating a note with new Tag selections can therefore cause the note to disappear from the current Tab - this is correct and wanted.


## Long-form Notes

A long-form note has "details" (text or image) as well as a title.  The title of a long-form note must always be text (i.e. never an image).  Long-form notes can have "child" regular notes.
When creating or editing a long-form note, the long-form note editing area takes up all of the screen apart from the create/edit regular note section (which takes up the bottom 150px or 250px).  In other words, the long-form editing area covers over both header strips and the whole note list area.
The button to create a new long-form note appears when the create-regular-note section is expanded to 250px height.  When this happens, a new "create long form note" button should appear underneath the create-note button (or underneath the "clear" button in stylus mode).  The new button should be the same size as the create-note button, and should have icon fa-chart-diagram.
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

### Regular notes whilst creating / editing a long-form note
Whilst a long-form note is being created / edited, after the long-form-note title has been set for the first time, then new regular notes can be created, using the standard new note area at the bottom of the screen.
New regular notes created whilst creating/editing a long-form note will be given the Tags matching the currently-active Tab (i.e. the same as when creating regular notes just from the notes list).

Any regular note created whilst creating/editing a long-form note:
These new regular notes should have their "parentId" field populated with the id of the long-form-note.
When these regular notes are shown in the notes-list: after any pills for their tags, the regular note should have an additional final pill with the title of the long-form note, truncated to at most 20 characters.  This final pill should have the same colour as the "Long Form" pill described above.


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

### Code and tooling
- One repository with npm workspaces: `client/` (React + TypeScript, built with Vite), `server/` (Express + TypeScript) and `shared/` (TypeScript types used by both, e.g. `Note`).
- Node.js 24 (LTS). No automated tests for now.
- Icons: Font Awesome Free (solid icons), installed from npm (`@fortawesome/fontawesome-svg-core`, `@fortawesome/free-solid-svg-icons`, `@fortawesome/react-fontawesome`) and bundled into the app, not loaded from a CDN, so the security headers and offline start-up keep working. All the app's icons use it, including the settings cog (`fa-gear`).

### API
- `GET /api/notes` - returns `{ "notes": [...], "categories": [...], "tabs": [...] }`: all notes, all categories with their tags, and all tabs (the most recent save-file's contents). `categories` also includes the built-in Lifetime category (see Note lifetime).
- `POST /api/notes` - body `{ "titleText": "...", "tagIds": [3, 7] }` (`tagIds` may be empty), or `{ "titleImage": "data:image/png;base64,...", "tagIds": [...] }` for a handwritten note. Exactly one of `titleText` and `titleImage` must be given. The server assigns the id and timestamps, saves a new save-file and returns the created note. The website sends its connection id in an `X-Connection-Id` header (see Live updates).
- `PUT /api/notes/:id` - same body as `POST /api/notes`, with the same checks; replaces the note's title and tags. A note keeps its type: a typed note must be given `titleText` and a handwritten one `titleImage`. The server updates `lastModifiedDateTime` (`id` and `createdDateTime` stay the same, so the note keeps its place in the list), saves a new save-file and returns the updated note.
- `PUT /api/notes/:id/lifetime` - body `{ "lifetime": "Active" | "Waiting" | "Archived" | "Bin" }`. Replaces the note's Lifetime tag, updates `lastModifiedDateTime`, saves a new save-file and returns the updated note.
- `POST /api/notes/reset-new`, `POST /api/notes/archived-to-bin` and `POST /api/notes/empty-bin` - the Settings Lifetime buttons. Each changes (or, for empty-bin, deletes) every matching note in one save and returns `{ "count": n }`.
- `POST /api/categories` - body `{ "name": "...", "multiSelect": false, "tags": [{ "name": "..." }] }`. The server assigns the category and tag ids, saves a new save-file and returns the created category.
- `PUT /api/categories/:id` - body as above, but existing tags include their `id` (`{ "id": 3, "name": "..." }`); tags without an `id` are new. Saves a new save-file and returns the updated category.
- `POST /api/tabs` - body `{ "name": "...", "categories": [{ "categoryId": 1, "tagIds": [1, 6] }] }`. The server assigns the id, saves a new save-file and returns the created tab.
- `PUT /api/tabs/:id` - same body; replaces the tab's name and filters. `DELETE /api/tabs/:id` deletes it. Both save a new save-file.
- Changes send the `X-Connection-Id` header too, and the server checks every rule in "Tags" and "Tabs" below, returning HTTP 400 with a clear message if one is broken.
- `GET /api/notes/download` - returns the most recent save-file exactly as it is on disk (including its `version` and `savedDateTime` fields), as a file download named with the save-file's own name, e.g. `notes-2026-10-24T09-40-12-345Z.json`. A backup can be put straight back into the data folder.
- `POST /api/login` - body `{ "password": "..." }`. On success sets the session cookie.
- `POST /api/logout` - clears the session cookie.
- All `/api/notes`, `/api/categories` and `/api/tabs` calls require a valid session; otherwise they return HTTP 401 and the website shows the login page.

### Login
- A login page with a single password field. On success the server sets a secure, HttpOnly session cookie that lasts 30 days.
- "Log out" is on the settings page only, not on the main notes screen.
- The 32-character password is generated once on the VM. Only a hash of it is stored, in `/etc/nwsnotes/config.json` on the VM, never in GitHub.
- The login endpoint is rate limited.

### Appearance
- Always light: dark text on light backgrounds, whatever the device's dark-mode setting (`color-scheme: light`, no dark-mode colours).
- **Width:** the app is at most 1280px wide. On a wider window it's centred, with the extra space split equally either side; the side areas are a slightly darker shade, with a thin line at the app's edges. The long-form editor stays within the same 1280px column.

### New-note area
- The area is a fixed 150px high (including its padding and border) at the bottom of the page and never scrolls with the note list; the list fills the rest of the page below the header. Padding is reduced so the canvas, buttons and one row of dropdowns fit. If more appears than fits (an error message, or dropdowns wrapping onto a second row), the area scrolls inside itself; it never grows.
- A single-line text box and an "Add" button. Pressing Enter also adds the note. There is no "New note" heading; the text box keeps its placeholder text and an accessible label.
- **Side padding** is very small (about 4px), to give note content as much width as possible.
- **Icon buttons:** Add (`fa-circle-plus`), Update (`fa-circle-check`), Cancel (`fa-x`) and Clear (`fa-delete-left`) show only an icon, with a tooltip and screen-reader label giving the action. All four are the same size as the Settings cog (40px square). Add and Update are filled in the accent colour; Cancel and Clear are outlined.
- After a successful save the text box clears and keeps focus, and the list scrolls to the bottom so the new note is visible. (The box is made read-only, not disabled, while saving, since disabling it would take the focus away.)
- When the page loads, the list starts scrolled to the bottom.
- In stylus mode the text box is replaced by the writing canvas (see Stylus mode).

### Stylus mode
- **Setting:** a "Stylus mode" switch at the top of the settings page, stored in the browser's local storage, so each device remembers its own setting. While it's on, an `fa-signature` icon sits just left of the cog in the header, the same size as the note buttons (a 16px icon in a 24px box). The icon only shows the mode (tooltip "Stylus mode is on"); clicking it does nothing.
- **Canvas:** while stylus mode is on, the title text box is hidden and a canvas takes its place, as wide as the text box would be and 80 CSS pixels high. To type a note instead, switch stylus mode off. Writing past the canvas edge is cut off.
- **What draws:** only a stylus (`pointerType` "pen") and, for testing on a computer, a mouse. Fingers and palms touching the canvas are ignored. The page doesn't scroll while writing on the canvas (`touch-action: none`).
- **Ink:** black, with rounded ends and joins, in the width chosen by the Pen thickness setting (1.5, 2.5 or 4.5 CSS pixels; default 2.5). No pressure sensitivity.
- **Pen thickness:**
  - **Settings:** a "Pen" section on the settings page, between Stylus mode/Columns and Lifetime. It's shown even when stylus mode is off, since handwritten notes can be edited without it.
  - **Buttons:** three buttons in a row, one per thickness. Each shows a short sample line drawn at that thickness, with its size in small text ("1.5px", "2.5px", "4.5px").
    - Exactly one is selected, shown with its colours inverted (accent background, light line and text) and marked as pressed for screen readers. Clicking one selects it.
  - **Remembered:** the choice is kept on this device in local storage (default 2.5px). An unknown stored value counts as 2.5.
  - **What it affects:** new strokes on every canvas, drawn with a stylus or mouse: the new-note canvas, editing a handwritten note, and long-form details. It doesn't change ink already drawn, or the eraser's size.
  - **Saved images:** cropping allows for the thickest pen, so thick lines aren't clipped at the edge.
- **Buttons:** "Clear" sits underneath "Add", leaving more width for the canvas; both buttons are the same width. "Add" saves the note and "Clear" wipes the canvas. Adding with nothing written shows "Nothing has been written yet." After a successful save the canvas clears. If saving fails, the error appears under the canvas and the writing is kept so you can retry. The tag dropdowns work exactly as for typed notes.
- **Saved image:** black ink on a transparent background, cropped to the written area plus a 4-pixel margin, as a PNG data URL (`data:image/png;base64,...`). The canvas always works at 2× pixel density, so ink is crisp on tablets and every image is shown at half its pixel size (the size it was written).
- **Paper:** the canvas and handwritten notes in the list sit on a light "paper" background. (The app is now always light, so this simply matches the page.)
- **Notes list:** a handwritten note shows its image at the size it was written, with the alt text "Handwritten note", and its tag pills underneath as usual. Every row in the list, typed or handwritten, has 0.2rem of padding above and below. A note's content (its title or handwriting, and its pills) is centred vertically in the row. The buttons and creation date stay at the top right, and the grip or selection circle stays the full height of the row.
- **Server checks:** exactly one of `titleText` and `titleImage`; the image must be a PNG data URL of at most 200 KB (counting the data URL's characters). The server's request size limit rises from 20 KB to 256 KB to allow for this.
- **Ignoring finger touches:** whenever the canvas is showing (stylus mode, or editing a handwritten note), finger taps on Add, Update, Cancel, Clear, the tag dropdown buttons and the lists they open do nothing, and fingers still don't draw or erase on the canvas; a stylus or mouse works as normal. Fingers can still scroll the new-note area if it overflows. Outside stylus mode, touch works everywhere as before. This can only be partly tested on a computer, so it is to be checked on the Android device: a palm or finger resting on the controls mustn't open a dropdown or add a note.
- **Screen rotation:** if the canvas size changes (e.g. the device is rotated), anything written but not yet added is cleared.
- **Image size (accepted):** every save writes all notes, images included, to a new save-file, and a week of save-files is kept. As a guide, 1,000 handwritten notes at about 4 KB each make each save-file about 4 MB. This is accepted for now; if it becomes a problem, images can later be stored as separate files.

### Tags
- Shared types in `shared/`: `Tag { id, name }`, `Category { id, name, multiSelect, tags: Tag[] }`, and `Note` gains `tagIds: number[]`. The name and tag rules are checked by shared functions used by both the website and the server, like the note title.
- Ids: a new category gets the highest category id + 1; a new tag gets the highest tag id across all categories + 1. Both start at 1.
- Category and tag names are trimmed, can't be empty and are at most 40 characters. Category names must be unique, and tag names unique within their category; both checks ignore upper/lower case ("Work" and "work" count as the same).
- A tag can't have the same name as its own category (ignoring upper/lower case), as the category name is what an unset dropdown shows. Tags in other categories may share it. Categories saved before this rule still load and work; saving one that breaks it is refused, with a message naming the clashing tag, until the tag or the category is renamed.
- No user category can be called "Lifetime" (ignoring upper/lower case); that name belongs to the built-in category.
- `multiSelect` can be changed from false to true, but not back. A note's `tagIds` must all exist, with at most one from each single-select category.
- Categories and their dropdowns appear in the order they were created (id order). Tags within a category appear in the category's tag order (see "Tag sort order" below). A note's pills appear in category order, then tag order.
- Renaming a tag changes it on every note that has it, because notes store only the tag id.

### Category editing
- The settings page has a Categories section listing each category's name with its tags, and an "Add category" button. The built-in Lifetime category is listed too, marked "Built-in", and isn't clickable.
- Adding and editing use the same page, at `/settings/categories/new` and `/settings/categories/<id>`, so the back button works. It has a name text box, a "Multi-select" checkbox (locked once the category has been saved as multi-select; tapping its text toggles it), one text box per tag for renaming with a bin button (`fa-trash-can`) beside it, and an "Add tag" button that adds an empty tag row.
- Empty new tag rows are ignored when saving. Emptying an existing tag's name is an error; its bin button deletes it instead.
- **Deleting tags:** the bin removes the row; nothing changes until Save. A category must keep at least one tag (the last bin is disabled). If deleted tags are on any notes, Save first asks, in the app's own pop-up, "Delete the tag "X"? It will be removed from N notes.". On save the server takes deleted tags off every note and out of every tab's filter; a filter left with no tags is dropped, and a tab left with no filters shows every note (its editor will ask for a tag next time it's saved). Notes' modified times aren't changed by this.
- "Save" sends the whole category in one call and returns to the settings page. If saving fails, the error is shown on the page and the edits are kept so you can retry.
- "Cancel" discards the edits and returns to the settings page; for a new category nothing is created.
- If another page saves the same category while it is being edited, the last Save wins. An open edit form isn't changed by live updates.

### Tag sort order
- **Stored as the list order:** a category's tag order is simply the order of its `tags` list in the save-file. No new field is needed, and the save-file stays version 2. Existing categories are already in creation (id) order, so they keep their current order until someone changes it. Tag ids no longer say anything about order.
- **Server:** saving a category keeps its tags in the order sent; it no longer sorts them by id. New tags get the next ids as before, wherever they sit in the list.
- **Editing page:** each tag row has, after its text box, an up arrow (`fa-arrow-up`) and a down arrow (`fa-arrow-down`), then the bin. They're the same 24px icon buttons as the bin, labelled "Move up"/"Move down" with the tag's name for screen readers.
  - Clicking one swaps the row with the one above or below. The first row's up arrow and the last row's down arrow are greyed out.
  - New, not-yet-saved rows can be moved too. "Add tag" still adds its row at the bottom.
  - Like renaming and deleting, nothing changes until Save, and Cancel discards a new order.
  - After a move, the focus stays on the same arrow (now on the moved row), so pressing it again keeps moving the tag.
- **Where the order is used:** everywhere tags are listed in a category's order:
  - the new-note, editing and long-form dropdowns, and the filter row and tab editor check-lists;
  - the full-tag-list pills and multi-select pills;
  - the pills on notes, and the tag pills on the settings page's category and tab lists.
  - A note's own `tagIds`, and a tab's filter tags, are also saved in this order, though nothing depends on that.
- **Lifetime:** the built-in Lifetime category's order is fixed (New, Active, Waiting, Archived, Bin) and can't be changed.
- **Live updates:** another page sees the new order after Save, as with other category changes. An open new-note selection keeps its chosen tags; only their display order changes.

### Tags on the notes page
- Each note shows its tags as small pills under the title, showing the tag name only.
- Under a tab whose own filter includes a single-select category (including Lifetime) with just one tag, that category's pills are left off the notes, as they only repeat the tab. If the tab's filter allows more than one tag in that category, the pills show, since they say which of those tags each note has. Pills from multi-select categories, from categories the tab doesn't filter on, and from the additional filters always show.
- Under the title text box there is one dropdown per category, with no visible title. Every dropdown is the app's own button-and-list control, not the browser's built-in dropdown, so single- and multi-select look and behave alike (and the app controls which inputs they respond to).
- The button shows the chosen tag names, or the category name in grey when no tag is chosen. Hovering shows the category name (useful once a tag is chosen), and screen readers announce it as the button's label.
- Single-select: the list shows the category name first (meaning no tag), then the tags, with the chosen one marked. Choosing an option replaces the previous choice and closes the list.
- Multi-select: the list is a check-list of the tags; it stays open while ticking, and closes when clicking elsewhere or pressing Escape.
- **List size:** an open list (in every dropdown and check-list) shows up to 15 rows before it scrolls.
  - It opens downwards if the whole list fits there. Otherwise it opens towards the side of the button with more room, which is upwards from the new-note area at the bottom.
  - It's never taller than the room on that side, leaving 8px to the window's edge, so in a short window it shows fewer rows and scrolls.
- After a note is added, the dropdowns keep their selections until the page is reloaded. A category added on another page appears as a new dropdown with no tag chosen.
- If there are more dropdowns than fit, the new-note area scrolls inside itself (see New-note area).
- The text in the new-note dropdowns (their buttons and the lists they open) can't be selected, so a drag or long press doesn't highlight it.
- The buttons (Add/Update, Cancel, Clear, long-form) have their own column at the right of the area. The text box or canvas, any message, and the dropdowns (or the pills in full-tag-list mode) share the column to its left, so the dropdowns and pills start straight under the title rather than below the last button. The title text box is 40px high, the same as the Add button beside it.
- Changing tab resets every dropdown (see "Tabs on the notes page"); adding a note still keeps the selections.

### Full-tag-list mode
- **Toggle:** a 24px round button centred on the divider between the note list and the add/edit area, with a chevron pointing up (expand) or down (collapse). It responds to touch as normal. The mode is remembered on this device in local storage, like stylus mode.
- **Size:** in full-tag-list mode the add/edit area is 250px high instead of 150px, and the list shrinks to match.
- **Scrolling:** the area itself never scrolls. The text box or canvas, any message under it, and the buttons stay put. If the pills don't fit, only the pills scroll up and down, in the space under the text box and beside the buttons.
  - The collapsed 150px area is unchanged: if it overflows, the whole area scrolls. This is because the dropdowns' lists open below them and would be cut off in a separately scrolling strip.
- **Layout:** the text box or canvas stays at the top, with the buttons in their column to its right; under the text box or canvas, instead of dropdowns, every user category gets its own line: its name in small grey text, then all its tags as pills. Lifetime isn't shown.
- **Pills:** a chosen tag is dark (accent green, white text); an unchosen tag is light (the usual pill colour). Tapping toggles it. In a single-select category, choosing a tag unchooses the others, and tapping the chosen one clears it.
- **Tab rules:** a tag the tab's filters lock in shows dark with a padlock and can't be turned off. In a single-select category where the filters require one of several tags, the other tags are greyed out and can't be chosen. Add shows the same "Choose a … tag" message if a required tag is missing. While editing a note there are no restrictions, as with the dropdowns.
- Both modes share the same choices, so switching mode keeps the chosen tags. It works the same when adding and when editing a note.
- **Stylus mode:** finger taps on the pills are ignored whenever the canvas is showing, like the other add/edit controls.

### Multi-select (bulk tag editing)
- **The list-check button** (`fa-list-check`) appears only in full-tag-list mode. It's in the right-hand button column, below the long-form button.
  - **When it can be turned on:** only while the new-note title box is empty or the canvas has no ink, no note or long-form note is being edited, and edit-order mode is off. Otherwise it's greyed out, with a hint saying why.
  - **Two modes never overlap:** while list-check is on, the Edit order button is greyed out too.
  - **While it's on:** its colours are inverted (accent background, light icon) and it's marked as pressed. The title box or canvas, and the Add, Clear and long-form buttons, are hidden, so it's the only button in the column until Accept appears.
- **Turning it off:** clicking it again, or pressing Escape, always turns it off with no changes. Note selections and pill clicks are discarded, and the next time starts with nothing selected. The normal new-note tag choices come back as they were.
- **While it's on, the page is held still, as during an edit:** the tabs, the filter row and the expand/collapse toggle are blocked. So selected notes can't disappear from the list, and the pills can't be collapsed away.
- **Selecting notes:**
  - Every note in the list shows a circle at its left: `fa-circle` when unselected, `fa-circle-check` (accent colour) when selected.
  - Tapping anywhere on a note row, or its circle, toggles it. Any listed note can be selected, long-form notes included.
  - The note buttons (edit, waiting, archive, reinstate, bin) stay in place but are greyed out and do nothing. The creation date still shows.
  - Once any pill has been clicked, selection is locked: the rows stop responding and the circles are dimmed.
- **Pills:**
  - Before any note is selected, they're greyed out and can't be clicked.
  - Once notes are selected, each pill shows whether all, some or none of the selected notes have that tag: chosen (dark), partly (a pale accent tint with an accent border, announced as "mixed"), or not chosen (light).
  - **Clicking:** a not-chosen or partly pill becomes chosen, and a chosen one becomes not chosen. Each click marks that tag as one to change.
  - **Single-select categories:** choosing a tag also makes the category's other tags not chosen, all counting as clicked. Unchoosing the chosen tag just removes it.
  - **Tab rules:** a tab's locked and required tags don't apply here, as when editing a note. Notes may leave the tab after Accept.
  - **Stylus mode:** the canvas is hidden in this mode, so finger taps work normally on the pills, the buttons and the note rows.
- **Accept** (`fa-check`, accent colour, "Accept bulk tag updates") appears above the list-check button once any pill has been clicked.
  - It sends `PUT /api/notes/bulk-tags` with `{ noteIds, addTagIds, removeTagIds }`: the clicked tags that ended chosen are added, and the clicked tags that ended not chosen are removed. Untouched tags, including partly ones, are left as each note has them.
  - The server checks the ids, applies everything in one save, and tells other pages to reload. Adding a single-select tag removes that category's other tags from the note. Lifetime tags can't be sent, and each note's Lifetime isn't touched.
  - **On success:** list-check turns off, the list shows the new tags, and a short notice says "Tags updated on 3 notes".
  - **On failure:** the mode stays on with the selections and clicks kept, and the error shows in the area.

### Columns
- **Setting:** "Columns" sits beside the Stylus mode switch at the top of the settings page, as four small buttons labelled 1 to 4 (default 1). It's remembered on this device in local storage. A device that saved 5 (allowed before) is treated as 4.
- **Layout:** the note list is split into that many balanced columns (CSS multi-column), and the whole list scrolls up and down as now. Notes flow top to bottom down the first column, then the second, and so on from left to right, so the newest note is at the bottom of the last column. A note is never split across two columns.
- A handwritten note wider than its column is shrunk to fit.
- **Balanced columns (accepted):** adding a note can move other notes between columns, as the columns even out. If this feels jumpy in use, an alternative is to fill each column to the screen's height and scroll sideways.

### Tabs
- Shared type: `Tab { id, name, categories: { categoryId, tagIds }[] }`, checked by a shared function used by both the website and the server, like categories.
- **"All" is built in:** it isn't stored, always comes first, has no filters, and can't be edited or deleted. No other tab can be called "All".
- **Ids:** a new tab gets the highest existing tab id + 1, starting at 1, like categories. Ids are only for the app's own use.
- **Names:** trimmed, can't be empty, at most 20 characters, and unique ignoring upper/lower case.
- **Filters:** each entry names an existing category and one or more of that category's tags, and no category can appear twice. A tab needs at least one tag in total; otherwise it would just repeat "All".
- **Matching:** a note is shown when, for every category the tab lists, it has at least one of that entry's tags. So categories combine with "and", and tags within one category combine with "or".
- **Order:** "All" first, then tabs in the order they were created. No reordering for now.
- Deleting a tab never changes any notes.

### Tab editing
- The settings page has a Tabs section listing "All" (not clickable, marked "Always shows every note") and then each tab's name with its tags as pills, plus an "Add tab" button.
- Adding and editing use the same page, at `/settings/tabs/new` and `/settings/tabs/<id>`, so the back button works. It has a name text box and one dropdown per category, like the new-note dropdowns, except that every one is a check-list (even for single-select categories), as a tab can match any of several tags from one category.
- "Save" and "Cancel" work as for categories. Editing an existing tab also has a "Delete" button, which first asks "Delete the tab "<name>"?".
- If another page saves the same tab while it is being edited, the last Save wins. An open edit form isn't changed by live updates.

### Tabs on the notes page
- The tabs sit at the left of the header, styled like browser tabs: the selected tab looks to be in front, joined to the note list below; the others look behind it. Each tab has 0.3rem of padding at its left and right.
- **Too many to fit:** all tabs shrink equally so they always fit in the header, and names that no longer fit are cut short with "…". Hovering a tab shows its full name. The icons on the right of the header keep their space.
- **Selected tab:** "All" is selected when the page opens or is reloaded. The selection is kept while moving around the app (e.g. to Settings and back). If another page deletes the selected tab, "All" is selected; if it edits it, the filter updates straight away.
- Only notes matching the selected tab are listed; an empty result shows "No notes in this tab yet." Changing tab scrolls the list to the bottom.
- Tabs respond to touch in stylus mode too; the touch-ignoring rule only covers the new-note controls.
- While a note is being edited, the tabs can't be changed: they look greyed out, and hovering explains "Finish or cancel the edit first".
- **New-note dropdowns under a tab,** for each category the selected tab lists, so that new notes always match the tab and stay visible:
  - *One tag in the filter:* that tag is chosen and locked. For a single-select category the whole dropdown is locked. For a multi-select category the tag is ticked and locked, and other tags can still be ticked.
  - *Several tags in the filter:* one of them must be chosen. A single-select dropdown offers only those tags, with no "no tag" option. A multi-select dropdown offers all the category's tags (extra tags don't stop the note matching), but at least one of the tab's tags must be ticked.
  - "Add" with a required tag missing shows "Choose a <category> tag: this tab only shows notes with one."
  - Categories the tab doesn't list work as before.
- Changing tab resets every dropdown: to no tag, or to the locked tag for one-tag filters.

### Additional tab filters
- **Filter row:** below the header, inside the selected tab and above the note list, a row that doesn't scroll with the notes. It has one dropdown per category the tab doesn't already filter on (for "All", every category), including Lifetime when the tab doesn't set it. Like the tab editor, every dropdown is a check-list, even for single-select categories. Just right of the dropdowns (not at the far right) is a "reset filters" button (`fa-reply-all`, the same 24px size as the note buttons), which clears every dropdown in the row.
- **Matching:** the row's choices combine with the tab's own filter using the same rules: every category must match, and any ticked tag within a category will do.
- **Remembered per tab, per device:** the choices are saved in the browser's local storage under the tab's id (or "all"), and are put back the next time that tab is opened on this device. Saved choices for a category the tab now filters on itself are ignored. Local storage is wrapped so the app still works when it isn't available.
- **New notes:** the row's choices set the new-note dropdowns exactly like a tab's own filter (one ticked tag is locked in; several mean one is required), so new notes stay visible.
- **Lifetime and new notes:** new notes are always New, and there's no Lifetime dropdown to change that. If the tab or the row hides New notes, the note is still added, and a short notice says "Note added, but this tab doesn't show New notes." for a few seconds.
- **While editing,** the row is blocked like the tabs, so the note being edited can't be filtered out mid-edit.

### Note ordering
- **Stored on the tab:** each tab has `noteOrder`, an array of note ids (empty or missing for tabs saved before this). The save-file format stays version 2, since a missing `noteOrder` simply means empty. The tab editor doesn't change it. It's set with `PUT /api/tabs/:id/order` and `{ noteOrder: number[] }`. The server keeps only ids of existing notes, drops duplicates, saves, and tells other pages to reload. If two browsers reorder at the same time, the last save wins.
- **"All" can't be ordered:** the edit-order button isn't shown on "All", which always lists notes in creation order.
- **List order:** within a tab, notes listed in `noteOrder` come first, in that order. Notes that aren't listed (including new ones) follow in creation order, so a new note still appears at the bottom. Notes in `noteOrder` that don't match the tab or the filters are simply not shown.
- **Deleted notes:** when notes are deleted (Empty Bin, or cancelling a new long-form note), the server removes their ids from every tab's `noteOrder` in the same save.
- **Edit-order button:** in the filter row, at the far right, the same 24px size as the note buttons. It shows `fa-arrow-down-wide-short` ("Edit order") when ordering is off and `fa-clipboard-check` ("Finish ordering") when it's on. If a tab already filters on every category, the row has no dropdowns. The row (and its reset button) is then still shown, just to hold the edit-order button. On "All", the row only shows its dropdowns and reset button.
- **Edit-order mode:**
  - It isn't remembered: it's off when the app opens.
  - It stays on when switching tabs, and turns off on "All".
  - It can't be turned on while a note or long-form note is being edited. The button is greyed out, with the hint "Finish or cancel the edit first".
  - Note buttons (edit, archive and so on) keep working while it's on. Editing a note turns ordering mode off.
- **Grips:** in edit-order mode each note shows an `fa-grip-vertical` icon at its left, in a 24px-wide handle.
- **Dragging:**
  - Pressing on a grip starts the drag straight away, with no hold delay. Mouse, stylus and finger all work, in stylus mode too, as the grips only appear in this mode.
  - The note follows the pointer up or down, and a gap the note's height opens between the two notes it's over. Releasing drops it there.
  - Escape, or releasing it where it started, changes nothing.
  - The list scrolls by itself when the pointer is near its top or bottom edge.
  - The grip has `touch-action: none`, so a finger drag doesn't scroll the page.
- **Columns:** with several columns, the order runs down the first column and then on down the next, and a note can be dropped into any column. The drop point is worked out from where the notes were when the drag started, so the columns re-balancing as the gap opens doesn't make it jump.
- **Under extra filters:** the moved note goes straight after the visible note it was dropped below, or straight before the first visible note if dropped at the top. Notes that are filtered out keep their places. Each drop saves the order of every note in the tab (all notes matching the tab's own filter, Bin included), so after the first drag nothing in that tab is unordered.
- **Live updates:** the list shows the new order as soon as the note is dropped, and the save is sent in the background. If it fails, the list returns to the saved order and a notice shows the error. If another page changes something mid-drag, the reload waits until the drag ends.

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

### Long-form notes
- **Data:** a long-form note has a text title (`titleText`, never `titleImage`) and exactly one of `detailsText` (at most 10,000 characters) or `detailsImage` (a PNG data URL). Having one of these fields is what makes a note long-form. The kind is chosen when the note is created, from stylus mode at that moment (canvas → `detailsImage`, otherwise `detailsText`), and never changes afterwards, like a regular note's title type. A new long-form note starts with empty details (`detailsText: ""` or `detailsImage: ""`).
- **Child notes:** regular notes created while a long-form note is open get `parentId` set to its id. The server checks that `parentId` names an existing long-form note; long-form notes can't have a parent, and a child can't be long-form. If the parent is later deleted (Empty Bin), the child keeps its `parentId` but its parent pill no longer shows.
- **Titles** follow the usual title rules (trimmed, not empty, at most 500 characters). They don't need to be unique.
- **Image size:** handwritten details fill a much larger canvas than a title, so `detailsImage` may be up to 2 MB (counting the data URL's characters), and the server's request size limit rises to 3 MB. Like titles, the drawing is cropped to what's written plus a margin, and stored at 2× pixel density.
- **API:** `POST /api/notes` with `{ "titleText": "...", "detailsText": "" | "detailsImage": "", "tagIds": [...] }` creates a long-form note (New, like any new note). `PUT /api/notes/:id` updates it with the same fields; the details kind can't change. Child notes are created with `POST /api/notes` plus `"parentId": <id>`.
- **Opening the editor:** the "create long-form note" button (`fa-chart-diagram`, 40px like Add) appears under Add (or under Clear in stylus mode) only while the bottom area is at 250px. The pen on a long-form note in the list opens the same editor with the title locked and the details editable. While the editor is open, the bottom area's chevron is disabled.
- **Editor layout:** it covers the header, the filter row and the note list, leaving only the bottom add-note area. Top: the title box with the accept-title (`fa-check`) / edit-title (`fa-pen`) button at the top right; the box is 40px high, the same as that button. Under it: the tag dropdowns (the normal kind; no Lifetime dropdown and no tab rules). Then the details textarea or canvas filling the space down to a centred "Finish" button.
- **Tags band:** so the note's tags stand out, the dropdowns sit in a full-width band between the title and the details.
  - The band has the header's background colour and a thin line above and below, with a small grey "Tags" label at its left.
  - Its dropdown buttons have a 2px border: dark grey when no tag is chosen, and accent green, with dark text, once one is.
  - This is only in the long-form editor; the new-note area's dropdowns are unchanged.
- **Before the title is first accepted,** the bottom add-note area is greyed out, with the hint "Set the long-form note's title first". After that, regular notes added there are children of the long-form note and follow the selected tab's rules as usual.
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

### Note lifetime
- **Built-in category:** Lifetime isn't stored in the save-file; the server adds it to `categories`. It's single-select with negative ids so it can never clash with user categories: category -1, and tags New -1, Active -2, Archived -3, Bin -4, Waiting -5 (added later, so it can't be renumbered; it's still listed in the order New, Active, Waiting, Archived, Bin). It can't be edited or renamed, and user categories can't use its name.
- **Every note has exactly one Lifetime tag.** The server always gives new notes New, ignoring any Lifetime tag sent, and keeps the existing one when a note is edited. Only the lifetime endpoints change it.
- **Introducing it:** when a save-file is loaded, any note without a Lifetime tag gets Active; the next save stores it.
- **Pills:** only New shows as a pill on notes, in the normal style; Active, Waiting, Archived and Bin never do, as the row colour already shows them. Tab definitions on the settings page still show every Lifetime tag they filter on.
- **Resetting New from the list:** the New pill on a note is a button (hover text "Reset the New tags"). It opens the app's own pop-up, "Do you want to reset the New tags?", with Yes (accent colour, focused) and No (Escape also counts as No). Yes does the same as the settings page's "Reset New" (every New note becomes Active, in one save) and reloads the list, with no other message. If it fails, the error shows as a notice over the list.
- **Tabs:** tab definitions and the additional tab filters can include Lifetime, as a check-list like any category.
- **Bin is hidden by default:** Bin notes are hidden in every tab, "All" included, unless the tab's filter or the additional filters tick Bin.
- **Creation date:** under each note's buttons, right-aligned, its creation date and time in the device's local time as "dd/MM HH:mm" (24-hour, e.g. "26/10 14:05"), in small grey text, the same grey on every row (it's deliberately hard to read on the dark Archived and Bin rows). Hovering shows the full date.
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
  - The confirmations are the app's own pop-up windows (not the browser's), with the count. If there's nothing to change, the button says so (e.g. "There are no archived notes.") instead of asking.
  - Emptied notes are gone from the app but remain in the past week's save-files, so they can be recovered from a backup.
- **Note ids are never reused:** the save-file stores `lastNoteId`, the highest id ever given, and new notes get `lastNoteId + 1`. Files without it start from the highest id present.
- **Live updates:** every lifetime change reloads other open pages, as for other changes.
- **Live updates:** if another page changes the note being edited, the last Update wins; the open edit isn't changed by live updates.

### Header and settings page
- The header strip has a fixed height and the same background colour as the new-note area. Below it, the note list fills the page above the fixed 150px new-note area.
- No app title is shown at the left of the header; on the notes page that space holds the tabs. The "← Notes" and "← Settings" links on the settings pages stay, and the browser tab is still titled "nwsnotes".
- The cog icon at the right of the header opens the settings page at its own address, `/settings`, so the browser's and Android's back button returns to the notes. The header on the settings page has a "← Notes" link.
- The settings page has, in order: Stylus mode and Columns (side by side), Pen, Lifetime, Categories, Tabs, Backup ("Download backup") and Account ("Log out"). "Download backup" is a plain link to `GET /api/notes/download`; the session cookie is sent with it automatically.

### Live updates (WebSocket)
- The website connects to `wss://nwsnotes.duckdns.org/ws`, on the same port (443) as the site.
- The server only accepts the connection if the session cookie is valid and the request's `Origin` is the site's own address, so other websites can't connect using the cookie.
- Each page load creates a random connection id and sends it with every change it makes (`X-Connection-Id` header). After a change is saved (a note added, a category added or edited, or a tab added, edited or deleted), the server sends `{ "type": "data-changed" }` to every other open connection; they reload the notes, categories and tabs with `GET /api/notes`. The same message will be used later for note editing and deleting.
- If the connection drops, the website reconnects automatically, waiting a little longer after each failed attempt. After any reconnect, and whenever the app comes back on screen, it reloads the notes in case it missed a message.
- These background reloads don't show "Loading...", don't clear a title being typed, and keep the list scrolled to the bottom. If one fails, a small notice is shown instead of the full error page.
- Logging out closes the connection.
- The server pings each connection regularly so idle connections aren't silently dropped.

### Android app (PWA)
- A web app manifest with the app name, theme and background colours, `display: standalone`, and PNG icons at 192×192 and 512×512, including a maskable icon.
- A service worker (built with `vite-plugin-pwa`) caches only the website's own files, never `/api` calls, so notes are always live. When offline, the app opens and shows the normal startup error page.
- The service worker updates itself automatically after each deployment.
- Check on the live site that the security headers (helmet's Content Security Policy) allow the manifest, service worker and WebSocket.

### Save files
- Folder: `/var/lib/nwsnotes/data` (outside the app's code folder, so deployments never touch it).
- Filename format: `notes-2026-10-24T09-40-12-345Z.json` (UTC timestamp, no colons).
- Files are written to a temporary name and then renamed, so a crash mid-save can't leave a corrupt file.
- Retention cleanup runs after each save and when the server starts.
- Contents: `{ "version": 2, "savedDateTime": "...", "notes": [...], "categories": [...] }`. A version 1 file (from before tags) loads with no categories and every note's `tagIds` empty; the next save writes version 2. Handwritten notes add `titleImage` in place of `titleText`; the file stays version 2, as existing files are still valid. Tabs are saved as a `"tabs": [...]` list in the same file (still version 2); a file without it loads with no tabs, so only "All" shows. A `"lastNoteId"` number is also stored (still version 2), so note ids are never reused after notes are deleted; the built-in Lifetime category itself isn't stored, only each note's Lifetime tag id.

### Hosting (Ubuntu VM)
- App code lives in `/opt/nwsnotes`, run by a dedicated `nwsnotes` user under pm2. pm2 starts the app on boot.
- Node serves the site directly: HTTPS on port 443; port 80 only redirects to HTTPS and answers Let's Encrypt certificate checks.
- The VM allows normal users to listen on ports 80 and up (`net.ipv4.ip_unprivileged_port_start=80`), so the app doesn't run as root.
- Certificate: Let's Encrypt via `certbot` (webroot mode), renewing automatically. On renewal a hook copies the certificate to `/etc/nwsnotes/certs` and restarts the app.
- Firewall (ufw) allows only ports 22, 80 and 443.

### Deployment
- On push to `main`, GitHub Actions builds the client and server, copies the build to the VM over SSH and reloads the app in pm2.
- GitHub secrets needed: `VM_HOST` and `VM_SSH_KEY` (a private key allowed to log in as the `nwsnotes` user).
- One-time VM setup is done with scripts in `deploy/`, described in `README.md`.
