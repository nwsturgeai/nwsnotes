# Tabs, filters and search

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

When the browser window is too narrow, the rightmost tabs are replaced with an ellipsis button (fa-ellipsis).  Tabs that don't fit well in the limited width are hidden; clicking the ellipsis opens a dropdown listing all of the hidden tabs.  The user can click on one of those tabs: it becomes selected and appears in the visible list of tabs, bumping the previous rightmost visible tab so that it is no longer visible but instead appears in the ellipsis dropdown list.

### Note counts on tabs
A new on/off setting shows each tab's note count alongside its name, e.g. "All (153)". When it's on, the minimum tab width goes up to 95 pixels.
No tab should be narrower than 75 pixels; tabs that would be narrower than that go into the ellipsis dropdown.

The first Tab should be called "All" and should have no filters.  This Tab cannot be edited or deleted.

Tab definitions should be stored in the same json file as notes and Category definitions.
Tab updates should cause other instances of the website to reload their data.

On the Notes page, towards the left of the header strip, the tabs should render.  They should be styled similarly to the tabs at the top of a typical web browser.  One tab is always selected - the All tab is selected when the page first opens.

Clicking on one of the Tabs causes that tab to become selected and appear to be in the foreground.
The only notes that are shown on the page are the notes that match the filter for the currently-selected Tab.  For each Category specified in the Tab definition, a note matches the filter if the note is tagged with at least one of the Tags in that filter definition Category object.
Notes that are "filtered out" remain in the system, they are just hidden.  They will be shown again when one of the other Tabs is selected.  The All tab will always show all notes.

When the currently-selected Tab has a Category filter containing a single Tag: the new-note area should have that one Tag automatically selected in the corresponding dropdown.  It should not be possible to change this selection.
Changing tab should cause all new-note dropdowns to reset, either to "unselected", or to the single value from the corresponding Tab Category filter.

### Tabs on the left

Tabs can appear down the left-hand side of the main screen as well as along the top.
Each Tab has a new setting, "Top" or "Left". When editing a Tab, there is a toggle-switch to switch between these 2 settings. The All tab can also be set to Left.
Tabs set to "Left" appear down the left-hand side of the notes list screen, ordered from top to bottom.
Layout: the top tab strip stays at the top. The left tab strip runs down the side, from under the top tab strip all the way to the top of the new-note section. The dynamic tab filter dropdowns (the second header row) stay where they are, but the row is no longer full-width: it loses a bit on the left for the left tab strip.
The left tab strip is narrow: 40 pixels wide, the same as the height of the top tabs bar. While the left strip is visible, the first tab in the top bar starts further right, so that a selected top tab's white background lines up with the note list beside the strip.
The names of tabs on the left strip are in vertical text, reading from bottom to top: the same as regular text rotated 90 degrees to the left. Long tab names are truncated (on one line) rather than wrapping to a second line.

### Additional Tab filters

Underneath the main "Tabs" header, a second header area is shown within the tab but above the list of notes.  This second header area should not scroll with the notes.
The second header area should show a set of dropdowns, one for each Category that is not specified in the Tab definition. These dropdowns behave the same way as when defining a Tab.
At the top of each of these dropdowns, in small text, there should be a "select all" link. Clicking it ticks all of the tickboxes in that dropdown.
When any of these dropdowns has selections in it, or a search is active, the background of the second header area should become bright yellow, to make it clear that this tab now has some dynamic filters applied.
When a selection is made in any of these dropdowns, the notes shown in the list should be filtered using these selections in addition to any filtering from the Tab definition, using the same filtering logic as in the Tab definition.
The selections within the dropdowns should be saved into Browser Local Storage.  The selections should be linked to the Tab in which they were made. The next time this tab is opened on this device, the same selections that were there the last time should be preselected.
In each of these dropdowns, the list of options should contain each Tag name in this category.  After each tag name, in brackets, there should be a number showing how many notes would be visible after updating the filters if this tag were to be selected.  At the bottom of the list of options should be one unselectable option, with text "TOTAL: n", where n gives the number of notes currently shown.
Just to the right of these dropdowns (i.e. not all the way to the right of the screen), there should be a "reset filters" button (same size as edit/archive/reinstate) (using icon fa-reply-all).  Clicking this button should clear the selections from all the dropdowns so that the Tab then shows notes filtered just by the Tab definition.  This reset filters button should only appear / be visible when any of the dropdowns have had any tags selected.

### Search

To the right of the "reset filters" button (in the second header area showing the additional tab filters) there should be another icon button for search.
Clicking the search button causes it to become selected / active, clicking again causes it to become deselected / inactive.
Whilst the search button is active, the second header area is extended vertically downwards to make space for a new single-line textbox - the search box.
If any text is typed into the search box, the list of notes shown in the main area is additionally filtered just to show notes where the title contains the text typed (case insensitive).  This also causes all notes with a title image (i.e. no title text) to become hidden.

## Agreed technical decisions

### Tabs
- Shared type: `Tab { id, name, categories: { categoryId, tagIds }[] }`, checked by a shared function used by both the website and the server, like categories.
- **"All" is built in:** it isn't stored, always comes first, has no filters, and can't be edited or deleted. No other tab can be called "All".
- **Ids:** a new tab gets the highest existing tab id + 1, starting at 1, like categories. Ids are only for the app's own use.
- **Names:** trimmed, can't be empty, at most 20 characters, and unique ignoring upper/lower case.
- **Spoken names:** each tab can also have an optional `spokenName`, an easier name to say when adding notes by text message. Its rules, and the extra check it adds to names, are in "Spoken names" in [text-messages.md](text-messages.md).
- **Filters:** each entry names an existing category and one or more of that category's tags, and no category can appear twice. A tab needs at least one tag in total; otherwise it would just repeat "All".
- **Matching:** a note is shown when, for every category the tab lists, it has at least one of that entry's tags. So categories combine with "and", and tags within one category combine with "or".
- **Order:** "All" first, then tabs in the order they were created. No reordering for now.
- Deleting a tab never changes any notes.

### Tab editing
- The settings page has a Tabs section listing "All" (not clickable, marked "Always shows every note") and then each tab's name with its tags as pills, plus an "Add tab" button.
- Adding and editing use the same page, at `/settings/tabs/new` and `/settings/tabs/<id>`, so the back button works. It has a name text box and one dropdown per category, like the new-note dropdowns, except that every one is a check-list (even for single-select categories), as a tab can match any of several tags from one category.
- "Save" and "Cancel" work as for categories. Editing an existing tab also has a "Delete" button, which first asks "Delete the tab "<name>"?".
- If another page saves the same tab while it is being edited, the last Save wins. An open edit form isn't changed by live updates.
- **"Create Tab for this Tag":** when editing a category with Multi-select not ticked, each tag with a name that no tab's filters include (a new tag too) has a small link (0.8rem, the accent colour, underlined) under its name box. Clicking it first saves the category as it is on the page, exactly as Save does (the same checks, and the same "Delete the tag…" or "Change to single-select?" question first, where Save would ask; cancelling that saves nothing and makes no tab). Then it makes a tab (`POST /api/tabs`), named the same as the tag, whose only filter is that tag. The page stays open, showing the tags as saved, and the link gives way to 'Saved the category and made the tab "<name>".'. It isn't offered for "Shared with me", Lifetime, or a new category. The tab's name is checked before anything is saved: if the tab can't be made (a tab already has that name, the name is over 20 characters, or there are already 40 tabs), nothing is saved and it says why under the link, e.g. 'The tab wasn't made: There is already a tab called "Work".', until the name is changed. If the category is saved but the tab then fails, it says "The category was saved, but the tab wasn't made: <reason>".

### Tabs on the notes page
- The tabs sit at the left of the header, styled like browser tabs: the selected tab looks to be in front, joined to the note list below; the others look behind it. Each tab has 0.3rem of padding at its left and right.
- **Size:** the header is 40px tall (on the settings pages too). The tabs are 36px tall, with a 4px gap above them, and their names are 0.9rem. The Settings cog and stylus icon stay 40px squares, filling the header's height. The header has no padding on its right, so the cog's square reaches the right-hand edge of the screen (on every page).
- **Too many to fit:** all tabs shrink equally so they fit in the header, and names that no longer fit are cut short with "…". Hovering a tab shows its full name. The icons on the right of the header keep their space.
- **Note counts on tabs:**
  - **Setting:** a "Tab counts" on/off switch at the top of Settings, with Stylus mode and Columns. Off by default. Remembered on this device in local storage, like them.
  - **What shows:** while it's on, every tab's name is followed by its count in brackets, e.g. "All (153)", "Work (12)", "Home (0)": in the top strip, the left strip (in the same vertical text) and the "…" menu.
  - **What's counted:** the notes the tab's own filters show, as when it's opened with nothing ticked in the filter row and no search. Bin notes count only if the tab's own filters include Bin. The filter row and search never change the counts, so they stay steady while filtering. They update straight away when notes change, here or (by live update) elsewhere.
  - **Long names:** only the name is cut short ("…"); the count always shows, e.g. "Very long na… (12)".
  - **Width:** while it's on, no top tab is narrower than 95px (instead of 75px), so fewer may fit before the "…" menu.
- **Tabs menu:** no tab is narrower than 75px (95px with tab counts on; both were 20px less before tabs could show the sharing icons, see [sharing.md](sharing.md)). When the tabs can't all fit at that width, the app shows as many as fit, sharing the space, and puts the rest in a menu.
  - How many fit is worked out from the tab strip's actual width (measured whenever it changes), with no breakpoints.
  - The menu opens from a narrow "…" button (`fa-ellipsis`) in the last place on the right. It's a list like the tag dropdowns, with each hidden tab's full name, in the tabs' usual order.
  - Choosing a tab there selects it and closes the menu.
  - **The selected tab is always shown:** if it's one that wouldn't fit, it takes the last shown place, and the tab normally there moves into the menu. After a resize the tabs are worked out again from their usual order, with this same rule.
  - "All" comes first, so it stays visible, unless only one tab fits at all.
  - While a note is being edited (or in multi-select), the "…" button is greyed out like the tabs.
  - The menu closes on a click elsewhere, Escape, or a resize.
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
- **Filter row layout when it wraps:** the row has two parts.
  - On the left, one group that wraps like words: the dropdowns, then "reset filters" (when shown), then the search button. When the dropdowns need more than one line, the reset and search buttons follow straight after the last dropdown, on the same line as it, rather than on a line of their own.
  - On the right, fixed: the edit-order button, always at the top-right of the row, level with the first line of dropdowns. The group on the left wraps before reaching it.
  - The search box, when open, still takes a full line of its own under the group. When everything fits on one line, the row looks as before. In multi-select, "All" and "None" take the dropdowns' place in the same group.
- **"select all":** each of the row's dropdown lists starts with a small "select all" link (0.85rem, the accent colour, underlined), above the tags. It ticks every tag in that dropdown and leaves the list open. Once every tag is ticked, it's greyed out. Only the filter row has it, not the new-note dropdowns or the tab editor. Ticking every tag still filters: notes with none of the category's tags are hidden, and for Lifetime it includes Bin, so Bin notes show.
- **Yellow while filtering:** while any of the row's dropdowns has a tag ticked, or a search is typed in the search box, the row's background is bright yellow (`#ffe94d`, the `--filtered` colour), so it's clear the tab's list is narrowed. It goes back to white once nothing is ticked and the search is empty or closed (e.g. after "reset filters" and closing the search). An open but empty search box doesn't turn it yellow, as it doesn't narrow the list.
- **Matching:** the row's choices combine with the tab's own filter using the same rules: every category must match, and any ticked tag within a category will do.
- **Remembered per tab, per device:** the choices are saved in the browser's local storage under the tab's id (or "all"), and are put back the next time that tab is opened on this device. Saved choices for a category the tab now filters on itself are ignored. Local storage is wrapped so the app still works when it isn't available.
- **New notes:** the row's choices set the new-note dropdowns exactly like a tab's own filter (one ticked tag is locked in; several mean one is required), so new notes stay visible.
- **Lifetime and new notes:** new notes are always New, and there's no Lifetime dropdown to change that. If the tab or the row hides New notes, the note is still added, and a short notice says "Note added, but this tab doesn't show New notes." for a few seconds.
- **While editing,** the row is blocked like the tabs, so the note being edited can't be filtered out mid-edit.
- **Note counts in the dropdowns:** in the filter row's dropdowns only (not the new-note area or the tab editor), each tag is followed by a count in brackets, e.g. "High (4)".
  - **What it counts:** the notes that have that tag and pass every other filter: the tab's own filter, the other dropdowns in the row, and the search. The tag's own dropdown is left out, so a ticked tag is counted the same way.
  - So with nothing ticked in a category, a tag's count is exactly how many notes ticking it would show. The counts in a dropdown don't change as tags in that same dropdown are ticked.
  - Bin notes count only under a Lifetime "Bin" tag, or when the filters show Bin, as in the list.
  - A tag with no notes shows "(0)" in grey text, and can still be ticked.
  - The counts update with the list, e.g. after notes are added or changed, or the search changes.
- **TOTAL line:** the last line of each of these dropdowns, under a thin divider, is "TOTAL: n", the number of notes the list shows now (search included), in grey. It can't be clicked or chosen.
- **Reset filters only when needed:** the "reset filters" button is shown only while at least one tag is ticked in the row. When it's hidden, it takes no space, so the search button moves left into its place.

### Properties filter
- **Dropdown:** after the category dropdowns in the filter row (before "reset filters" and search) is a "Properties" check-list dropdown. It's on every tab, "All" included. Its options are rules about the note itself rather than its tags:
  - **Long-form:** long-form notes.
  - **Has a parent note:** child notes, i.e. notes added inside a long-form note.
  - **Due date set:** notes with a due date.
  - **Due today:** notes due before the next local midnight (so overdue ones too).
  - **Overdue:** notes whose due date has passed.
- **Matching:** like a tag dropdown: with nothing ticked it doesn't filter; otherwise a note must pass any one of the ticked rules, as well as the tab, the other dropdowns and the search. The due-date rules follow the clock (checked each minute), so e.g. a note joins "Due today" after midnight without a reload.
- **Counts and TOTAL:** each rule shows how many notes it would list if it were the only rule ticked, with every other filter as it is; the TOTAL line is the same as the other dropdowns'. The tag dropdowns' counts take the ticked rules into account.
- **Like the other filters:** ticking a rule turns the row yellow and shows "reset filters", which clears it too. The ticks are remembered per tab, per device, with the row's tag choices. There's no "select all".
- **New notes:** the rules don't change the new-note dropdowns. A new note that doesn't pass them is still added, with the notice "Note added, but it doesn't match the Properties filter." An empty list says "No notes match the Properties filter."

### Search
- **Button:** `fa-magnifying-glass`, the same 24px size, just right of the "reset filters" button. While search is on it's filled in green, like the list-check button. It's on every tab, "All" included.
- **Search box:** a single-line text box on its own line at the bottom of the filter row, shown while search is on. It gets the focus when search is turned on. While a note is being edited it's blocked, like the rest of the row.
- **Matching:**
  - The text is split into words, and a note matches if every word appears in it, in any order, ignoring case. So "tulip bulbs" finds "Buy bulbs for the tulips".
  - The title is searched, and for long-form notes, the typed details too.
  - Handwritten titles and drawn details can't be searched, so while there's text in the box, notes with a handwritten title are hidden.
  - Empty or blank text doesn't filter at all.
- **On top of the other filters:** search only narrows what the tab and the filter row already show, so Bin notes stay hidden unless the filters show them. When nothing matches, the list says "No notes match the search." A new note that doesn't match is still added, with the notice "Note added, but it doesn't match the search."
- **Turning it off:** clicking the button again, or Escape while in the search box, clears the text and closes the box.
- **Not remembered:** while it's on, the search and its text stay as they are when switching tabs. It isn't saved on the device, so it's off when the app opens.
- **Offline:** it works offline, since all the notes are already on the device.

### Tabs on the left
- **Stored on the tab:** a new `placement` field, `"top"` or `"left"`, sent and checked with the tab's name and filters (`POST` and `PUT /api/tabs`). Tabs without it are Top, so existing tabs stay where they are. It's called `placement` because the database already has a `position` column for the tabs' order.
- **The "All" tab:** it isn't a stored tab, so its placement is kept as a small setting on the server, `allTabPlacement` (`"top"` or `"left"`, default `"top"`), in the database's `meta` table. `GET /api/notes` includes it as `allTabPlacement`, and `PUT /api/tabs/all` with `{ "placement": "left" }` changes it and tells other pages to reload. Changing it is a change in the History ("Moved the All tab to the left"), so going back undoes it too: the history keeps a "before" copy of it, as for notes, categories and tabs.
- **The switch in the tab editor:** below the name, a toggle switch labelled "Top" on its left and "Left" on its right, off (Top) by default, saved with the tab. In Settings, the "All" row becomes a link too, to a short page with only that switch (its name and filters still can't be changed, and it can't be deleted).
- **Order:** the one tab order set with the arrows in Settings. Top tabs appear along the top in that order, and Left tabs down the side in that order. "All" is always first in whichever strip it's in. In Settings the list stays as one list, with a small "left" label on Left tabs.
- **Layout of the notes page:**
  - The top tab strip, full width, at the top, as now.
  - Below it, the left tab strip on the left, running down to the top of the new-note area.
  - To its right, the filter row and then the note list: the filter row now starts at the left strip's edge rather than the screen's.
  - The new-note area at the bottom stays full width.
  - With no Left tabs there's no left strip, and no space is kept: everything is full width, as now. With every tab set to Left (All included), the top strip is empty but keeps its height, as it holds the Settings cog.
- **The left strip's tabs:**
  - 40px wide, the same as the header's height. The tabs are 36px wide with a 4px gap on their left, matching the gap above the top tabs, and stacked from the top with a small gap between them. Names are 0.9rem, as at the top.
  - **Top tabs line up with it:** while the strip is showing, the top tabs start at its right-hand edge rather than 12px in, so a selected top tab's left border sits on the strip's dividing line, making one continuous line, and its white area joins the note list. Tabs that then don't fit go into the "…" menu as usual. With no Left tabs, the top tabs start 12px in as before.
  - Each name is vertical text reading from bottom to top: the same as normal text rotated 90 degrees to the left (anticlockwise), on one line. The letters are the usual ones, just turned, not stacked one above another. A tab is as tall as its name, from 48px up to at most 160px; a longer name is cut short with "…" at its top end. The full name shows on hover (its title).
  - It's drawn with `writing-mode: vertical-rl` turned half a turn (`transform: rotate(180deg)`), which every current browser supports.
  - The selected tab looks joined to the note list on its right-hand edge, the way the top tabs join the list below them. Only one tab is selected at a time, whichever strip it's in.
  - If there are more than fit, the strip scrolls by itself (it has no "…" menu; that stays for the top strip only).
- **Everything else is the same** whichever strip a tab is in: its filters, the filter row and its counts, search, edit order, multi-select, and adding notes to it.
- **While a note is being edited,** Left tabs are greyed out and can't be switched to, like Top tabs.
- **The long-form editor** covers the left strip too, as it covers the filter row and the note list.
- **Tests:** a new `left-tabs.spec.ts`: setting a tab (and "All") to Left moves it into the left strip, in order; switching tabs from the left strip; long names are cut short on one line; the filter row starts beside the strip; with no Left tabs there's no strip; going back in the History undoes a placement change.
