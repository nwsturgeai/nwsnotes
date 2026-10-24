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
id - a unique integer id.  Should be auto-created on the server, starting at 1, each new note takes the next id value.
titleText - a string.  May not be empty - notes with empty title should be rejected.  Trim leading/trailing whitespace.  Max length 500 characters.
titleImage - a string containing the base64 image data if the note has been created from stylus handwriting.  Exactly one of titleText and titleImage should be populated on each note.
createdDateTime
lastModifiedDateTime - for now I will not yet add note-editing or note-deleting capability, those will come in future.
timestamps should be set by the server.  Dates should be stored in ISO 8601 format, UTC timezone.
Tags - can have multiple.  More details below.  The note should reference/store the ids of the tags it is tagged with.

The main app screen will show:
A list of all notes occupying most of the page.  Notes should appear in created-date order with the most recently created at the bottom of the list.  Each row should show the note title.  Rows should be separated by a thin horizontal line.
If there isn't enough space to show all notes, then scroll vertically to see the rest.
There will be an area to enter a new note at the bottom of the page - always visible even if there are more notes than fit.  This area at the bottom should not scroll when the list of notes scrolls.  This area should be fixed height, 150px tall.
There should be no "New note" heading.
Horizontal padding in the "New note" area should be very small, to maximise the horizontal space for note content.
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
For now, it will not be possible to delete tags or categories.
For now, it will not be possible to change the tags a note has after the note has been created.
After a category has been saved as multi-select, it is not possible to revert it to single-select later.

On the main notes page:
Each note should also display its tags.  These should be shown in a list of pills underneath the note title.  If 2 categories have tags with the same name, there is a possibility that a note has 2 tags with the same text.  This is OK.
When adding a note, the user can set tags.  There should be a dropdown for each Category.  Single-select and multi-select categories both use the same kind of dropdown: a button that opens a list.  For single-select categories, the list's first option (which corresponds to "no tag selected within this category") is the category name, and choosing an option replaces any previous choice.  For multi-select categories, the list is a check-list.  In both cases, the button shows the category name when no tag is chosen.
The dropdowns should appear underneath the textbox where the note title is entered.  The dropdowns should not have any titles.
After adding a note, the dropdowns retain their selections so that if the dropdowns aren't changed then a second new note would be given the same tags.


## Stylus support

I will be using this website on an android device that has a stylus.
It should be possible to put the site into stylus mode.  This should be a toggle setting at the top of the settings page.
This new setting should be saved into browser local storage so that if the site is reloaded, this setting is remembered on this device.
When in stylus mode, a small icon (use fa-signature) should be displayed next to the settings cog at the right of the top header.
When in stylus mode, instead of typing a new note, I want to write the note onto an HTML canvas element.  In other words, when in stylus mode, whilst the stylus is "touched down" within the canvas, the website should capture the points that the stylus tip moves over, and should colour those black.  This should give the user the sense that they are writing onto the canvas.
Saving the note should capture the image data from the canvas and store that as the note's titleImage.  The canvas should be 80 pixels high.  When saving the image, crop down to just the area of the canvas that has anything written.
When displaying the list of notes, if a note has a title image (and no title text) then the image should be displayed, and no title text should be displayed.
Handwritten notes can still have tags the same as typed notes.

The "Clear" button should be shown underneath the "Add" button - this gives more horizontal space for handwriting.
Considering the "Add" and "Clear" buttons, and all of the new note tag dropdowns: when in stylus mode, these controls should not respond to touch inputs - they should only respond to stylus or mouse inputs. Touch inputs should continue to work when not in stylus mode.


## Tabs

A Tab is a definition of a filter; when viewing a Tab you only see the notes that match the filter.

A Tab has the following attributes:
Name: unique string, max length 20 characters.
Categories: an array of structures, each containing a category id and one or more tag ids.

The Settings page will have a new section "Tabs".  This allows Tab definitions to be added, edited and deleted.  WIthin the section will be a list of existing tabs, and a button to create a new tab.
Existing tabs should show their name and the associated tag ids (rendered as pills the same as for notes in the Notes page).
When creating or editing a tab, dropdowns for all the Categories are shown, the same as the dropdowns shown when adding a new Note.
After the user begins to add or edit a tab, there should be "Save" and "Cancel" buttons.

Tab definitions should be stored in the same json file as notes and Category definitions.
Tab updates should cause other instances of the website to reload their data.

On the Notes page, towards the left of the header strip, the tabs should render.  They should be styled similarly to the tabs at the top of a typical web browser.  One tab is always selected - the All tab is selected when the page first opens.

Clicking on one of the Tabs causes that tab to become selected and appear to be in the foreground.
The only notes that are shown on the page are the notes that match the filter for the currently-selected Tab.  For each Category specified in the Tab definition, a note matches the filter if the note is tagged with at least one of the Tags in that filter definition Category object.
Notes that are "filtered out" remain in the system, they are just hidden.  They will be shown again when one of the other Tabs is selected.  The All tab will always show all notes.

When the currently-selected Tab has a Category filter containing a single Tag: the new-note area should have that one Tag automatically selected in the corresponding dropdown.  It should not be possible to change this selection.
Changing tab should cause all new-note dropdowns to reset, either to "unselected", or to the single value from the corresponding Tab Category filter.

### "*" Tab

Before any user-defined Tabs, there should be a system-defined Tab with name text "*", known as the Dynamic Tab.  This tab cannot be edited or deleted.
The Dynamic tab does not have any statically-defined Category/Tag filters.
When the Dynamic Tab is selected, a second header area is shown within the tab but above the list of notes.  This second header area should not scroll with the notes.
The second header area should show a set of dropdowns, one for each Category, the same as when defining a Tab.
When a selection is made in any of these dropdowns, the notes shown in the list should be filtered using these selections as if the Tab definition contained these selections.
The selections within the dropdowns in the Dynamic tab should be saved into Local Storage so that the next time this tab is opened on this device, the same selections will be preselected.
At the right of the dropdowns, there should be a "reset filters" button (same size as edit/archive/reinstate) (using icon fa-reply-all).  Clicking this button should clear the selections from all the dropdowns so that the Tab then shows all Notes.



## Editing Notes

On the Notes page, in the notes-list area: each note should have an "edit" icon.  The icon should be shown on the right-hand side of the screen.  The icon should be 16px wide by 16px high.
When the edit icon is clicked for a note, the Add-Note section changes into edit-mode.  For text-notes, the text control is shown with the current title of the note.  For image-notes, the canvas needs to be shown and the image needs to be loaded into the canvas.  Text-editing or image-editing becomes enabled according to the type of the note being edited and disregards whether stylus-mode is enabled or not.
In edit-mode, the "Add" button becomes an "Update" button, and a new "Cancel" button also appears.  All 3 buttons should be arranged vertically one above the other.  If necessary, padding should be reduced to make these buttons fit in the available space.
Pressing Update causes any changes to the note to be saved to the server and the notes list updated to reflect the changes.  The Add-Note section reverts to its normal "Add" behaviour.
Pressing Cancel causes any changes to be discarded and the Add-Note section reverts to its normal "Add" behaviour.
Whilst in edit mode it should not be possible to switch to a different Tab.
Tag selections for a note can be updated in edit mode to have any new tag values.  Updating a note with new Tag selections can therefore cause the note to disappear from the current Tab - this is correct and wanted.


## Note Lifetime

### "Lifetime" system Category

There should be a system-controlled Category with name "Lifetime".
This category cannot be edited in the Settings page.
This is a single-select Category.
This category should have possible Tags: "New", "Active", "Archived".  I suggest these tags be given negative ids.
When creating or editing a note, this system category should not have a drop-down.
New notes are always given the "New" tag from this Category.
The "Active" tag in this category should never be displayed as a pill in the notes-list.
When this Category is first introduced, all existing notes should be tagged with the "Active" tag.
Tab filter definitions can specify values for this system Category.

### Archiving

On the Notes screen, each note in the notes-list which is not tagged "Archived" should have an "archive" button (using icon fa-box-archive) alongside the edit button.  This button should be the same size as the edit button.
When the Archive button is clicked, the note is given the "Archived" tag (and Tag New or Active is removed).
Notes with the Archived tag should have a fairly dark grey background.
For Notes with the Archived tag: in place of the "archive" button, they should have a "reinstate" button (fa-rotate-left).
Pressing the reinstate button takes away the Archived tag and adds the Active tag.

### Lifetime changes

The Settings page should have a button "Reset New".  Clicking this button will update all notes tagged as "New" to switch to being tagged "Active".  This button should appear alongside the stylus-mode toggle.
The Settings page should have a second button "Delete Archived".  Clicking this button will delete all notes with the "Archived" tag.  There should be a confirmation modal asking if the user is sure, saying how many notes will be deleted.



## Agreed technical decisions

### Code and tooling
- One repository with npm workspaces: `client/` (React + TypeScript, built with Vite), `server/` (Express + TypeScript) and `shared/` (TypeScript types used by both, e.g. `Note`).
- Node.js 24 (LTS). No automated tests for now.
- Icons: Font Awesome Free (solid icons), installed from npm (`@fortawesome/fontawesome-svg-core`, `@fortawesome/free-solid-svg-icons`, `@fortawesome/react-fontawesome`) and bundled into the app, not loaded from a CDN, so the security headers and offline start-up keep working. All the app's icons use it, including the settings cog (`fa-gear`).

### API
- `GET /api/notes` - returns `{ "notes": [...], "categories": [...], "tabs": [...] }`: all notes, all categories with their tags, and all tabs (the most recent save-file's contents).
- `POST /api/notes` - body `{ "titleText": "...", "tagIds": [3, 7] }` (`tagIds` may be empty), or `{ "titleImage": "data:image/png;base64,...", "tagIds": [...] }` for a handwritten note. Exactly one of `titleText` and `titleImage` must be given. The server assigns the id and timestamps, saves a new save-file and returns the created note. The website sends its connection id in an `X-Connection-Id` header (see Live updates).
- `PUT /api/notes/:id` - same body as `POST /api/notes`, with the same checks; replaces the note's title and tags. A note keeps its type: a typed note must be given `titleText` and a handwritten one `titleImage`. The server updates `lastModifiedDateTime` (`id` and `createdDateTime` stay the same, so the note keeps its place in the list), saves a new save-file and returns the updated note.
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

### New-note area
- The area is a fixed 150px high (including its padding and border) at the bottom of the page and never scrolls with the note list; the list fills the rest of the page below the header. Padding is reduced so the canvas, buttons and one row of dropdowns fit. If more appears than fits (an error message, or dropdowns wrapping onto a second row), the area scrolls inside itself; it never grows.
- A single-line text box and an "Add" button. Pressing Enter also adds the note. There is no "New note" heading; the text box keeps its placeholder text and an accessible label.
- After a successful save the text box clears and keeps focus, and the list scrolls to the bottom so the new note is visible.
- When the page loads, the list starts scrolled to the bottom.
- In stylus mode the text box is replaced by the writing canvas (see Stylus mode).

### Stylus mode
- **Setting:** a "Stylus mode" switch at the top of the settings page, stored in the browser's local storage, so each device remembers its own setting. While it's on, an `fa-signature` icon sits just left of the cog in the header. The icon only shows the mode (tooltip "Stylus mode is on"); clicking it does nothing.
- **Canvas:** while stylus mode is on, the title text box is hidden and a canvas takes its place, as wide as the text box would be and 80 CSS pixels high. To type a note instead, switch stylus mode off. Writing past the canvas edge is cut off.
- **What draws:** only a stylus (`pointerType` "pen") and, for testing on a computer, a mouse. Fingers and palms touching the canvas are ignored. The page doesn't scroll while writing on the canvas (`touch-action: none`).
- **Ink:** black, a fixed width of about 2.5 CSS pixels, with rounded ends and joins. No pressure sensitivity.
- **Buttons:** "Clear" sits underneath "Add", leaving more width for the canvas; both buttons are the same width. "Add" saves the note and "Clear" wipes the canvas. Adding with nothing written shows "Nothing has been written yet." After a successful save the canvas clears. If saving fails, the error appears under the canvas and the writing is kept so you can retry. The tag dropdowns work exactly as for typed notes.
- **Saved image:** black ink on a transparent background, cropped to the written area plus a 4-pixel margin, as a PNG data URL (`data:image/png;base64,...`). The canvas always works at 2× pixel density, so ink is crisp on tablets and every image is shown at half its pixel size (the size it was written).
- **Paper:** the canvas and handwritten notes in the list sit on a light "paper" background. (The app is now always light, so this simply matches the page.)
- **Notes list:** a handwritten note shows its image at the size it was written, with the alt text "Handwritten note", and its tag pills underneath as usual.
- **Server checks:** exactly one of `titleText` and `titleImage`; the image must be a PNG data URL of at most 200 KB (counting the data URL's characters). The server's request size limit rises from 20 KB to 256 KB to allow for this.
- **Ignoring finger touches:** whenever the canvas is showing (stylus mode, or editing a handwritten note), finger taps on Add, Update, Cancel, Clear, the tag dropdown buttons and the lists they open do nothing, and fingers still don't draw or erase on the canvas; a stylus or mouse works as normal. Fingers can still scroll the new-note area if it overflows. Outside stylus mode, touch works everywhere as before. This can only be partly tested on a computer, so it is to be checked on the Android device: a palm or finger resting on the controls mustn't open a dropdown or add a note.
- **Screen rotation:** if the canvas size changes (e.g. the device is rotated), anything written but not yet added is cleared.
- **Image size (accepted):** every save writes all notes, images included, to a new save-file, and a week of save-files is kept. As a guide, 1,000 handwritten notes at about 4 KB each make each save-file about 4 MB. This is accepted for now; if it becomes a problem, images can later be stored as separate files.

### Tags
- Shared types in `shared/`: `Tag { id, name }`, `Category { id, name, multiSelect, tags: Tag[] }`, and `Note` gains `tagIds: number[]`. The name and tag rules are checked by shared functions used by both the website and the server, like the note title.
- Ids: a new category gets the highest category id + 1; a new tag gets the highest tag id across all categories + 1. Both start at 1.
- Category and tag names are trimmed, can't be empty and are at most 40 characters. Category names must be unique, and tag names unique within their category; both checks ignore upper/lower case ("Work" and "work" count as the same).
- A tag can't have the same name as its own category (ignoring upper/lower case), as the category name is what an unset dropdown shows. Tags in other categories may share it. Categories saved before this rule still load and work; saving one that breaks it is refused, with a message naming the clashing tag, until the tag or the category is renamed.
- `multiSelect` can be changed from false to true, but not back. A note's `tagIds` must all exist, with at most one from each single-select category.
- Categories, tags within a category, and the dropdowns all appear in the order they were created (id order). A note's pills appear in category order, then tag order.
- Renaming a tag changes it on every note that has it, because notes store only the tag id.

### Category editing
- The settings page has a Categories section listing each category's name with its tags, and an "Add category" button.
- Adding and editing use the same page, at `/settings/categories/new` and `/settings/categories/<id>`, so the back button works. It has a name text box, a "Multi-select" checkbox (locked once the category has been saved as multi-select), one text box per tag for renaming, and an "Add tag" button that adds an empty tag row.
- Empty new tag rows are ignored when saving. Emptying an existing tag's name is an error, as tags can't be deleted.
- "Save" sends the whole category in one call and returns to the settings page. If saving fails, the error is shown on the page and the edits are kept so you can retry.
- "Cancel" discards the edits and returns to the settings page; for a new category nothing is created.
- If another page saves the same category while it is being edited, the last Save wins. An open edit form isn't changed by live updates.

### Tags on the notes page
- Each note shows its tags as small pills under the title, showing the tag name only.
- Under the title text box there is one dropdown per category, with no visible title. Every dropdown is the app's own button-and-list control, not the browser's built-in dropdown, so single- and multi-select look and behave alike (and the app controls which inputs they respond to).
- The button shows the chosen tag names, or the category name in grey when no tag is chosen. Hovering shows the category name (useful once a tag is chosen), and screen readers announce it as the button's label.
- Single-select: the list shows the category name first (meaning no tag), then the tags, with the chosen one marked. Choosing an option replaces the previous choice and closes the list.
- Multi-select: the list is a check-list of the tags; it stays open while ticking, and closes when clicking elsewhere or pressing Escape.
- After a note is added, the dropdowns keep their selections until the page is reloaded. A category added on another page appears as a new dropdown with no tag chosen.
- If there are more dropdowns than fit, the new-note area scrolls inside itself (see New-note area).
- Changing tab resets every dropdown (see "Tabs on the notes page"); adding a note still keeps the selections.

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
- The tabs sit at the left of the header, styled like browser tabs: the selected tab looks to be in front, joined to the note list below; the others look behind it.
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

### Editing notes
- **Edit icon:** each note in the list has an `fa-pen` icon at the right-hand side, which responds to touch as normal (it's in the list, not the new-note controls). The note being edited is highlighted in the list.
- **Edit mode:** clicking the icon turns the bottom area into edit mode for that note. A typed note shows the text box with its title; a handwritten note shows the canvas with its image, whatever stylus mode is set to. "Add" becomes "Update" and a "Cancel" button appears (for handwritten notes, "Clear" stays too). Enter updates a typed note; Escape cancels.
- **Loading an image:** the note's image is drawn at its original size at the top-left of the canvas. If it's wider than the canvas (e.g. written in landscape, edited in portrait), it's shrunk to fit, so nothing is lost on Update. Editing a handwritten note means writing more on it or using "Clear" to start again; there's no eraser.
- **Draft:** pressing edit while part-way through a new note discards that draft (typed text or writing). The new-note tag choices are kept and come back after Update or Cancel.
- **Tags while editing:** the dropdowns show the note's own tags and can be changed to anything; the selected tab's locked and required rules don't apply. If the new tags no longer match the selected tab, the note disappears from it after Update, as intended.
- **Update:** saves with `PUT /api/notes/:id` and updates the list in place, without scrolling it. An empty title is refused ("The note title can't be empty" / "Nothing has been written yet"), since notes can't be deleted yet. If saving fails, the error is shown and the edits are kept for a retry.
- **Cancel** discards the changes. After Update or Cancel the area returns to adding notes, empty, with the earlier tag choices.
- **What's blocked while editing:** changing tab, the other notes' edit icons and the Settings cog, so nothing is left half-edited.
- **Live updates:** if another page changes the note being edited, the last Update wins; the open edit isn't changed by live updates.

### Header and settings page
- The header strip has a fixed height and the same background colour as the new-note area. Below it, the note list fills the page above the fixed 150px new-note area.
- No app title is shown at the left of the header; on the notes page that space holds the tabs. The "← Notes" and "← Settings" links on the settings pages stay, and the browser tab is still titled "nwsnotes".
- The cog icon at the right of the header opens the settings page at its own address, `/settings`, so the browser's and Android's back button returns to the notes. The header on the settings page has a "← Notes" link.
- The settings page has, in order: Stylus mode, Categories, Tabs, Backup ("Download backup") and Account ("Log out"). "Download backup" is a plain link to `GET /api/notes/download`; the session cookie is sent with it automatically.

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
- Contents: `{ "version": 2, "savedDateTime": "...", "notes": [...], "categories": [...] }`. A version 1 file (from before tags) loads with no categories and every note's `tagIds` empty; the next save writes version 2. Handwritten notes add `titleImage` in place of `titleText`; the file stays version 2, as existing files are still valid. Tabs are saved as a `"tabs": [...]` list in the same file (still version 2); a file without it loads with no tabs, so only "All" shows.

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
