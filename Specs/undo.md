# Undo and Redo

On the notes page, a button should undo the last change I made to my notes there, for a few minutes
afterwards. Going back further is done from the History page (see "History and revert" in [data.md](data.md)).

- **Where:** an icon button in the top bar, just left of the Settings cog (the cog stays in the corner), the same size as the cog. Only on the notes page.
- **When:** only within 5 minutes of the most recent change to notes made on this page. After that it disappears, and an undo has to be done from History.
- **Undo, then Redo:** pressing Undo undoes that change, and the button becomes Redo, which puts it back. Redo then becomes Undo again, and so on: it only ever switches between those two states. Each press gives the button another 5 minutes. Undoing more than one change is done from History.
- **Only changes to notes, made on the notes page:** adding, editing (long-form notes included), Lifetime changes (one note, or the edit-order mode buttons for the listed notes), Reset New from the New pill, multi-select tag changes, due dates set from the list, and the note order (dragging, Move to top/bottom, adding at the top). Changes made on the Settings pages, including its Reset New, Archived to Bin and Empty Bin buttons, don't bring up the button and don't replace it. Device settings (columns, stylus mode, hiding the left tabs) aren't changes to notes.

## Agreed technical decisions

- **Icons:** `fa-arrow-rotate-left` for Undo and `fa-arrow-rotate-right` for Redo. (Reinstate on a note uses `fa-rotate-left`, which looks different.)
- **Tooltip and label:** what it will do, e.g. `Undo: Archived "Buy milk"` or `Redo: Archived "Buy milk"`, from the change's History summary.
- **"Made here":** this browser tab. Changes made in another tab, on another device, by text message, or by someone a tag is shared with don't bring up the button. The offer is kept for the tab (`sessionStorage`), so it survives a reload until its 5 minutes are up.
- **Greyed out** (with the hint "Finish or cancel the edit first") while a note or long-form note is being edited, and in multi-select.
- **Offline:** the button is hidden while offline, and a change queued offline never brings it up.
- **Afterwards:** a short message under the top bar says `Undone: Archived "Buy milk"` (or `Redone: …`), in the green of the "new version" notice, for 5 seconds (with an OK button to close it). The notes reload. There's no confirmation pop-up, since Redo is right there.
- **Changed since:** if a change since (made anywhere: another device, someone a tag is shared with, a Settings page) touched the same notes, the undo is refused: "That note has changed since, so it can't be undone here. Use History to go back further." (For a change only to the order, it's refused if the order changed since.) The message shows in red for 10 seconds, and the button goes.
- **The order of the notes:** undoing a change to the order (a drag, or an add at the top) puts the old order back if it hasn't changed since; otherwise the current order is kept, with notes that come back put where they were among the others, and notes that go taken out of it.
- **Adding at the top** saves the note and then the order: one Undo takes back both.
- **Undoing an add** deletes the note outright (not to the Bin); Redo brings it back with the same id.
- **Long-form notes:** autosaves join one History change, so Undo after writing takes back everything written since the note was opened ("Undo: Edited \"Holiday plans\""). Cancelling a new long-form note (which deletes it) doesn't bring up the button, and takes away an offer to undo that note's add or edits.
- **Due dates:** undoing a due-date change moves the reminder back too. A reminder already sent isn't sent again because of an undo.
- **Someone a tag is shared with:** their change to the owner's note is in the owner's History ("by Sam"), and they can Undo it from their notes page, if their permission still allows that change now (edit, or edit-and-delete for a change to or from the Bin). Undoing it is also recorded in the owner's History, with "by Sam".
- **Server:**
  - Each change in the History records who made it (`made_by` on `changes`; older changes have none, and count as the owner's).
  - The reply to a change says which History changes it made: the `X-Changes` header, URI-encoded JSON `[{ "id": 123, "summary": "Archived \"Buy milk\"" }]` (the summary without "by <name>"). Usually one; a change touching notes in two notebooks (Reset New with notes shared with you) makes one in each. A long-form autosave that joins the earlier change gives that change's id.
  - `POST /api/history/undo` with `{ changeIds }` undoes changes the user made together, as one new change in each notebook, recorded in the History as `Undid: Archived "Buy milk"` (and undoing that as `Redid: …`). It returns `{ changes: [{ id, summary }] }`, the changes it made, which undo it in turn (Redo). It's refused (and changes nothing) if a change isn't in the History any more (404), wasn't made by this user (403), changed anything other than notes and their order (400), touched notes that a later change also touched (409), or, for someone a tag is shared with, isn't allowed by their permission now (403). Other pages are told to reload, as after any change.
  - It only ever puts back the "before" copies of the changes being undone, unlike going back in History, which also undoes every later change.
- **Tests:** a new `undo.spec.ts`: Undo and Redo of an archive, an edit, an add (and an add at the top), the order and multi-select; the button's icons, tooltip, place left of the cog, and the message; it's greyed out while editing and hidden offline and on Settings; it isn't offered for Settings changes, and Settings changes don't replace it; it disappears after 5 minutes; an undo is refused when the note changed since; the History lists the undo and redo.
