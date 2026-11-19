# Tags and categories

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
Categories and tabs can both be reordered.  On the settings page, in both the Categories and Tabs sections, there are up and down buttons to the right of each row; clicking them moves that item up or down.  The updated order is sent to the server on each click.
A category can be changed from multi-select to single-select.  If/when making this change, then any notes that have more than one tag from this category should auto-pick just the first/highest-ordered tag from the category and lose any other tags from this category.

### When a note's tags last changed
For each note, store the date and time when its tags were last set or changed. It isn't shown in the app for now.

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
Whilst selecting multiple notes, the dynamic Tag filter dropdowns (and the reset-all button) are hidden rather than greyed out, and replaced by 2 small buttons with text "All" and "None".  Clicking "All" causes all notes in the tab to become selected; clicking "None" causes all notes in the tab to become unselected.

## Colours
It should be possible for tags to be assigned a Hue value.
I want to use Hue values (in degrees) so that I can show different shades of the same colour by varying the Saturation and Value.
The main settings page should display any assigned Hue values (using Saturation 100% and Value 100%) in a small box alongside each tag name.
The edit category page should show the Hue value in a larger box next to the tag name.  Clicking the box should bring up a modal dialog graphically displaying possible hues.  The user should be able to click to select a Hue.  Updates to selected Hues should be saved when the Category is saved.

In the main notes list, when a note is displayed with a tag that has a Hue assigned, then that hue should be used to set the background colour of the note.
If the note has multiple tags-with-hue, then take the hue from the first such tag.
The hue-specific background colour should override the default colour for notes that are New, Active, Waiting, Archived.  Notes with tag "Bin" should always have the Bin colouring.
New/Active tags should have background using the selected hue and: Value 100%, Saturation: 18%.
Waiting tags should have background using the selected hue and: Value 85%, Saturation: 25%.
Archived tags should have background using the selected hue and: Value 55%, Saturation: 30%.

## Agreed technical decisions

### Tags
- Shared types in `shared/`: `Tag { id, name }`, `Category { id, name, multiSelect, tags: Tag[] }`, and `Note` gains `tagIds: number[]`. The name and tag rules are checked by shared functions used by both the website and the server, like the note title.
- Ids: a new category gets the highest category id + 1; a new tag gets the highest tag id across all categories + 1. Both start at 1.
- Category and tag names are trimmed, can't be empty and are at most 40 characters. Category names must be unique, and tag names unique within their category; both checks ignore upper/lower case ("Work" and "work" count as the same).
- A tag can't have the same name as its own category (ignoring upper/lower case), as the category name is what an unset dropdown shows. Tags in other categories may share it. Categories saved before this rule still load and work; saving one that breaks it is refused, with a message naming the clashing tag, until the tag or the category is renamed.
- No user category can be called "Lifetime" (ignoring upper/lower case); that name belongs to the built-in category.
- `multiSelect` can be changed either way. A note's `tagIds` must all exist, with at most one from each single-select category.
- **Changing to single-select:** when a category is saved as single-select after being multi-select, each note with more than one of its tags keeps only the first, in the category's tag order as saved, and loses the others, in the same save.
  - Before saving, the category page says how many notes this affects, in the app's own pop-up ("Change to single-select? 3 notes with more than one of these tags will keep only the first one in the list."), with "Change and save" and Cancel. If tags are being deleted too, both messages show together, with "Save".
  - While the checkbox is unticked on a saved multi-select category, a hint under it says so.
  - Like deleting a tag, this is tidying up: the notes' modified and tags-changed times aren't changed.
  - Tab filters with several of its tags still work, since a filter matches any of its tags.
  - A new-note dropdown still holding several of its tags (chosen while it was multi-select) shows and uses only the first.
- Categories and their dropdowns appear in the categories' order, which is set on the settings page (new categories go at the end; see "Ordering categories and tabs"). Tags within a category appear in the category's tag order (see "Tag sort order" below). A note's pills appear in category order, then tag order.
- Renaming a tag changes it on every note that has it, because notes store only the tag id.

### Category editing
- The settings page has a Categories section listing each category's name with its tags, and an "Add category" button. The built-in Lifetime category is listed too, marked "Built-in", and isn't clickable.
- **Ordering categories and tabs:** each user category's row on the settings page, and each tab's row, has an up arrow (`fa-arrow-up`) and a down arrow (`fa-arrow-down`) at its right. They're the same 24px buttons as the note buttons.
  - Clicking one swaps the row with its neighbour. The list shows the new order straight away, and it's sent to the server on each click: `PUT /api/categories/order` or `PUT /api/tabs/order`, with `{ "ids": [...] }` listing every user category's or tab's id once, in the new order.
  - The server checks that every id is listed exactly once, saves, and tells other pages to reload. If a save fails, the error shows under that list and the saved order is reloaded.
  - The first row's up arrow and the last row's down arrow are greyed out. After a move the focus stays on the same arrow, so pressing it again keeps moving that row.
  - The built-in Lifetime category is always last, and "All" is always the first tab. Neither can move, and their rows have no arrows (the space is kept, so the rows line up).
  - The order is used everywhere: the new-note dropdowns and pills, the filter row, the tab editor, the pills on notes, and the tab strip in the header.
  - New categories and tabs are added at the end.
- Adding and editing use the same page, at `/settings/categories/new` and `/settings/categories/<id>`, so the back button works. It has a name text box, a "Multi-select" checkbox (tapping its text toggles it), one text box per tag for renaming with a bin button (`fa-trash-can`) beside it, and an "Add tag" button that adds an empty tag row.
- Empty new tag rows are ignored when saving. Emptying an existing tag's name is an error; its bin button deletes it instead.
- **Deleting tags:** the bin removes the row; nothing changes until Save. A category must keep at least one tag (the last bin is disabled). If deleted tags are on any notes, Save first asks, in the app's own pop-up, "Delete the tag "X"? It will be removed from N notes.". On save the server takes deleted tags off every note and out of every tab's filter; a filter left with no tags is dropped, and a tab left with no filters shows every note (its editor will ask for a tag next time it's saved). Notes' modified times aren't changed by this.
- "Save" sends the whole category in one call and returns to the settings page. If saving fails, the error is shown on the page and the edits are kept so you can retry.
- "Cancel" discards the edits and returns to the settings page; for a new category nothing is created.
- If another page saves the same category while it is being edited, the last Save wins. An open edit form isn't changed by live updates.

### Tag colours (hues)
- **Stored on the tag:** an optional `hue`, a whole number of degrees from 0 to 359. It's saved with the category: `POST` and `PUT /api/categories` send it for each tag, and the server checks it. A tag without one has no colour. The save-file stays version 2.
- **Only your own categories:** the built-in Lifetime category can't be edited, so its tags never have a hue.
- **Colours from a hue:** worked out as HSV (hue, saturation, value) and drawn with the matching CSS `hsl()`:
  - the settings and category page boxes: saturation 100%, value 100%;
  - New and Active notes: saturation 18%, value 100%;
  - Waiting notes: saturation 25%, value 85%;
  - Archived notes: saturation 30%, value 55%.
- **Settings page:** in the Categories section, each tag with a hue has a small box (0.75rem square) of its colour just before its name.
- **Category page:** each tag row has a larger box (about 2rem square) before its name box. It's empty, with a thin border, when the tag has no hue. Tapping it opens the hue picker.
- **Hue picker:** the app's own pop-up, titled with the tag's name.
  - It shows 36 colour swatches, one every 10°, in a ring.
  - Tapping a swatch selects it, with a ring around it, and shows a preview of the three note shades: New/Active, Waiting and Archived.
  - Buttons: "Set colour" (the green main button), "No colour" (only when the tag has a hue) and "Cancel". Escape counts as Cancel.
  - The chosen hue is only saved when the category is saved, like the other edits on the page.
- **Note rows:** a note takes its colour from the first of its tags that has a hue, going by category order, then tag order within the category.
  - It's shaded by its Lifetime: New/Active, Waiting or Archived, as above. Bin notes always keep the Bin colour.
  - On a coloured row the buttons stay dark, Archived rows included, as the background is light enough.
  - Handwritten notes on coloured rows have transparent "paper", so the colour shows behind the ink.
  - A note being edited still shows the pale green edit highlight instead of its colour. A note selected in multi-select keeps its colour, and its selection circle shows it's selected.
- **Not coloured:** tag pills, the tag dropdowns and the tab editor are unchanged.

### When a note's tags last changed
- **Stored on the note:** `tagsChangedDateTime` (ISO 8601, UTC), next to `createdDateTime` and `lastModifiedDateTime`. It's in the API's notes and in the save-files. Nothing in the app shows it yet.
- **When it's set:** when a note is created (its tags are first set then), and whenever its tags really change:
  - saving an edited note, including converting it to long-form;
  - a bulk tag update in multi-select, for each note it changes;
  - Lifetime changes, since Lifetime is stored as a tag: Waiting, Archive, Reinstate and Bin on a note, and the "Reset New" and "Archived to Bin" buttons.
- **Only a real change counts:** the server compares the note's tags before and after, ignoring their order. A save that leaves them the same, such as a title-only edit or a long-form autosave, keeps the old time. So does a bulk update that doesn't alter a note.
- **Not counted:** deleting a tag on the category page also takes it off notes, but that's tidying up, so their times stay.
- **Existing notes:** a note loaded from a save-file without it gets its `createdDateTime`, stored with the next save. The save-file format stays version 2.
- **Offline changes keep their own time:** a tag change made offline is sent with the time it was made, as `tagsChangedDateTime` in the body of `POST /api/notes`, `PUT /api/notes/:id` or `PUT /api/notes/:id/lifetime`. The server uses it if it's a valid time that isn't in the future; otherwise it uses its own time.
  - Online changes don't send it, so the server's time is used.
  - If several offline edits are merged into one change, the time is that of the latest edit that changed the tags.
  - A note created offline gets its offline creation time, or the time of a later offline tag change made before it was sent.
  - The server still only counts a real change, so tags changed offline and then changed back keep the old time.

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
- If there are more dropdowns than fit, the new-note area scrolls inside itself (see New-note area in [notes.md](notes.md)).
- The text in the new-note dropdowns (their buttons and the lists they open) can't be selected, so a drag or long press doesn't highlight it.
- The buttons (Add/Update, Cancel, Clear, long-form) have their own column at the right of the area. The text box or canvas, any message, and the dropdowns (or the pills in full-tag-list mode) share the column to its left, so the dropdowns and pills start straight under the title rather than below the last button. The title text box is 40px high, the same as the Add button beside it.
- Changing tab resets every dropdown (see "Tabs on the notes page" in [tabs.md](tabs.md)); adding a note still keeps the selections.

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
- **The list-check button** (`fa-list-check`) appears only in full-tag-list mode. It's in the right-hand button column, below the long-form button. It's hidden while a note is being edited, where the "Convert to long-form note" button takes its place (see [long-form.md](long-form.md)).
  - **When it can be turned on:** only while the new-note title box is empty or the canvas has no ink, no note or long-form note is being edited, and edit-order mode is off. Otherwise it's greyed out, with a hint saying why.
  - **Two modes never overlap:** while list-check is on, the Edit order button is greyed out too.
  - **While it's on:** its colours are inverted (accent background, light icon) and it's marked as pressed. The title box or canvas, and the Add, Clear and long-form buttons, are hidden, so it's the only button in the column until Accept appears.
- **Turning it off:** clicking it again, or pressing Escape, always turns it off with no changes. Note selections and pill clicks are discarded, and the next time starts with nothing selected. The normal new-note tag choices come back as they were.
- **While it's on, the page is held still, as during an edit:** the tabs and the expand/collapse toggle are blocked. So selected notes can't disappear from the list, and the pills can't be collapsed away.
- **The filter row** keeps its filters as they are, but hides its dropdowns and "reset filters" button. In their place are two small text buttons, "All" and "None". The Edit order button stays at the far right, greyed out.
  - "All" selects every note listed (the notes in the tab, as narrowed by the filters), and "None" unselects them all.
  - Like tapping rows, they only work until a pill has been clicked. Then they're greyed out, with the hint "Selection is fixed once a tag has been clicked".
  - Turning list-check off brings the dropdowns back, with the same choices.
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
