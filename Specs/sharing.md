# Sharing tags with other users

## Requirements

A user (the **owner**) can share any of their own tags with other users (**recipients**). A recipient sees the owner's notes that have that tag, and can work on them as far as their permission allows. The notes stay in the owner's notebook.

### Sharing a tag
- The owner chooses who to share a tag with, and gives each recipient one of three permission levels: **read-only**, **edit**, or **edit-and-delete**.
- To choose a recipient, the owner picks from a list of users they're already linked with: everyone they've successfully shared a tag with, and everyone who has shared a tag with them. Anyone else is added by typing their exact email address. If there's no account for that address, the share is refused: "There's no nwsnotes account for that address."
- A share takes effect straight away. The recipient doesn't accept it, and can't leave it: only the owner can change or end a share.
- The owner can change a recipient's level, or stop sharing with them, at any time. It takes effect straight away, including on the recipient's open pages.
- If the owner renames the tag, the recipient sees the new name. If the owner deletes the tag, the shares of it end. If the owner removes the tag from a note, that note disappears for the recipient.
- A recipient can't share the owner's tags onwards.

### Showing the owner what they've shared
- On the owner's notes, the pill of a tag they've shared shows one icon after the tag's name, for what the most generous of its shares allows: people (`fa-users`) if the shares are all read only; people with a pencil on their bottom right corner if anyone has edit; people with a trash can on their bottom right corner if anyone has edit-and-delete. The app draws the pencil and trash can itself (a longer pencil than `fa-pencil`; a trash can with its lid joined on and two slots), with a gap cut out of the people round them. Hovering says what it means, e.g. "Shared by you; someone can edit".
- **Tabs:** a tab that filters on a tag alone in its category hides that tag's pills, and so would hide these icons too. So a tab that filters on any of the owner's shared tags shows the same icons after its name (and count), for the most generous share among those tags. Top tabs and left tabs both show them. To make room, tabs are 20px wider than before at their narrowest: 75px, or 95px with tab counts on.
- **Settings:** the same icon shows after a shared tag's name in the categories' summary on the Settings page, and after its name box on its category's page (every tag row there keeps room for it, so the name boxes line up). Not in the tabs' "…" menu.
- **Tag pickers:** the icon also follows a shared tag's name in the dropdown lists of the filter row, the add area, a tab's page and the long-form editor; in the add area's pills (full tag list) and multi-select's pills; and in the tabs' list in Settings (the tags a tab filters on). Not on a closed dropdown's button. Inside a checkbox label or button it's hidden from screen readers (it still has its hover text), so the control's name stays the tag's name.
- Recipients don't see these icons. They change straight away when the owner changes a tag's sharing, on all the owner's devices.

### What each level allows
No level lets a recipient change the tags of the owner's notes, apart from the Lifetime changes listed here.
- **Read-only:** see the notes. No note buttons.
- **Edit:** also edit the notes (title and details), and Waiting, Archive and Reinstate. Also create new notes with the tag (below).
- **Edit-and-delete:** also Move to Bin.
- **Nobody but the owner** can empty the owner's Bin (the only permanent delete), or set or change a due date.

A note's Lifetime is shared: if a recipient archives one of the owner's notes, it's archived for the owner and every other recipient too.

### "Shared with me"
- A user who has had any tags shared with them gains a new category, **"Shared with me"**, holding every tag shared with them, from every owner. It's multi-select, as one note can have several tags shared with the same person.
- Each tag in it always shows its owner's display name, cut to its first 10 characters followed by "…" when it's longer, e.g. "Shopping (Pat)" or "Shopping (Christophe…)": on the pills under a note, in the dropdowns and full-tag-list pills, in Settings (the categories' and tabs' lists, and the category page), and in messages that name it (e.g. ""Shopping (Pat)" is shared with you to read only, so you can't add notes to it."). Hovering a pill under a note shows its category, "Shared with me", as for the user's own tags.
- The recipient sets their own order of the tags in "Shared with me" and their own colour (hue) for each. These change only how the notes look to them, never to the owner. As now, a note takes its colour from its first tag with a hue, in the recipient's order.
- The recipient can't add tags to "Shared with me", rename or delete them, or add their own tags to the category.
- Tabs and additional tab filters can use "Shared with me" tags, alongside the recipient's own categories and Lifetime.

### What a recipient sees on a shared note
- The note itself, in full, so anything the owner tags with a shared tag is visible to that recipient.
- Only the tags of that note that are shared with them, and its Lifetime. The owner's other tags are hidden.
- **Long-form notes:** a child note is shared only if it has a tag shared with the recipient itself. Sharing the parent doesn't share its children.

### Note order
- The owner's order of their notes doesn't change when a recipient reorders.
- A recipient has their own order, covering their own notes and the owner's notes they can see, and can reorder both in the usual way. It never changes the owner's order.

### Creating notes with a shared tag (edit and edit-and-delete)
- A recipient with edit permission can add a note on a tab that filters on that shared tag. The note is created in the **owner's** notebook, with the shared tag(s) and Lifetime New, and counts towards the owner's limits.
- If the tab filters on several shared tags, the recipient must choose at least one of them, so the new note shows on this tab, the same as adding into a tab with several filter options today. They can only choose shared tags they have edit permission for, from the same owner.
- A note created with a shared tag can't also be given any of the recipient's own tags.
- A recipient can't add a shared tag to one of their own existing notes.
- **Limits:** the owner's note limit and stylus-note limit apply. When one is reached, the recipient is told, e.g. "Pat's notebook is full, so this note can't be added." (not the owner's "Empty the Bin…" message).
- **Resetting New:** for a recipient, clicking the New pill resets New only on the notes they can change (their own, and the owner's notes shared with them at edit level or above). On a note shared read-only, the New pill does nothing.

### Multi-select
- In list-check mode, the owner's shared notes can't be selected: bulk tag changes only touch the recipient's own notes.
- "Shared with me" pills aren't offered in list-check mode.
- The bulk Lifetime buttons in edit-order mode follow the recipient's level. "Waiting → Archive (N)" includes the owner's notes shared with them at edit level or above. "Archived → Bin (N)" includes them only at edit-and-delete. Notes they can't change are skipped and aren't counted in N.

### Other features
- **History:** a recipient's changes to the owner's notes are recorded in the owner's History, marked with who made them ("by Sam"), and the owner can go back past them as usual. The recipient gets no History of their own for the owner's notes.
- **Editing at the same time:** if two people edit the same note, the last save wins, as now. No warning for now.
- **Offline:** shared notes are in the recipient's offline copy, and can be changed offline as their level allows. Changes are checked when they reach the server: a change their level no longer allows, or a new note over the owner's limit, is refused like any other refused change.
- **Due dates and reminders:** only the owner can set or change a note's due date, and reminders go only to the owner's devices.
- **Text messages:** a recipient can add notes by text message into their tabs that use shared tags, under the same rules as adding in the app. If the tab filters on several shared tags (so the recipient would have to choose one), the text is refused, with a text back saying so. "Email tab" includes the shared notes on that tab.
- **Backups:** shared notes are only in the owner's backups. A recipient's "Download backup" leaves them out.

## Agreed technical decisions

### Global note and tag ids (built and released first)
Before sharing is built, note ids and tag ids become unique across all users. It's released on its own, ahead of sharing. **Done.**
- **No data moves:** only the admin has notes and tags in production, so existing ids stay as they are. On its first start, the new version checks that no note id and no tag id is used by more than one user, in their current data or their History, and refuses to start if one is. Once passed, the check is recorded (a `globalIdsChecked` row in `meta`, with `user_id` 0) and isn't run again. The tests' server only reports a clash, since its reset removes every other user anyway.
- **On every start,** both sequences are moved past every id in use: in the notes and categories, in the History's copies, and in older notebooks' `lastNoteId`, which covers notes deleted since. They're never moved back.
- **Ids are never reused:** new note ids and tag ids come from two database sequences, one for notes and one for tags, shared by all users. A sequence hands each number out once, even when two people add at the same moment. Each sequence starts above the highest id already in use.
  - This replaces the per-user `lastNoteId`, and the current way of choosing a new tag's id (the highest tag id in use + 1, in `server/src/store.ts`), which reuses a deleted tag's id. With sharing, a reused tag id could point a share, a recipient's colour or an old History copy at a different tag.
  - A user's note ids will have gaps where other people's notes took numbers. Nothing depends on ids being consecutive: the order comes from `noteOrder`, then creation time.
- **Category and tab ids stay per user.** "Shared with me" is a built-in category with the fixed id `-2` (Lifetime is `-1`).
- **Restoring a backup** (`--restore <file> --user <email>`) is refused if any of the file's note or tag ids belong to another user. After a restore, both sequences move past the highest id restored. A backup file's `lastNoteId` is ignored, and downloaded backups no longer need it.
- **Tests:** tests stop assuming particular ids (for example, a new account's first note being id 1). `POST /api/test/reset` also resets both sequences.

### Shares (built)
- **Stored** in a `shares` table: `tag_id`, `recipient_id` (together the key), `owner_id`, `permission` (`read`, `edit` or `delete`), and the recipient's own `position` and `hue` for the tag. Shares aren't in the History, the backups or the save-files. The server keeps them in memory, loaded the first time they're needed (`server/src/sharing.ts`).
- **API:**
  - `GET /api/tags/:id/shares`: who one of your tags is shared with (`TagShare[]`: user id, display name, login email, permission). 404 for a tag that isn't yours.
  - `PUT /api/tags/:id/shares` with `{ shares: [{ loginName, permission }] }`: replaces the whole list. Refused (400) for an address with no account ("There's no nwsnotes account for <address>."), your own account, or anyone listed twice. A new recipient's tag goes at the end of their "Shared with me".
  - `GET /api/shares/people`: the people for the share dialog's list (`SharePerson[]`).
  - `PUT /api/shared-tags` with `{ tags: [{ id, hue? }] }`: the recipient's order and colours for every tag shared with them, once each.
- **Deleted tags:** after a category is saved, or the owner goes back in the History, shares of the owner's tags that no longer exist are removed.

### What the owner's app is told
- `GET /api/notes`, and the categories sent back after adding, saving or reordering categories, mark each of the owner's shared tags with `sharedOut`: the highest permission of its shares (not stored). Saving the share dialog (`PUT /api/tags/:id/shares`) tells all the owner's pages to reload, the one that saved included.

### A recipient's view
- `GET /api/notes` returns the recipient's own notebook plus, for each owner, the owner's notes with a tag shared with them. Each such note has `tagIds` holding only its shared tags and its Lifetime, and `shared: { ownerId, ownerName, permission }`, its permission being the highest of its shared tags'. `reminderSentFor` is left out.
- "Shared with me" is a category with id `-2` and `shared: true`, multi-select, sent after the user's own categories and before Lifetime, only when something is shared with them. Its tags carry `ownerName`, `ownerId`, `permission`, and the recipient's own `hue` (never the owner's).
- The recipient's tabs can filter on it. A filter on a tag no longer shared with them is left out of the tabs sent (a filter left with no tags is dropped), and comes back if the tag is shared again.
- The recipient's note order (`PUT /api/notes/order`) keeps their own notes' ids and those of the shared notes they can see.

### Changes a recipient makes
- Every note route finds the note among the user's own, then among the notes shared with them. Anything else is 404. Too low a permission is 403: "Pat has shared this note with you to read only." or "Only Pat can move their notes to the bin."
- **Editing** (`PUT /api/notes/:id`) needs edit. The tags sent must be the ones the recipient sees, and the due date the note's own, or it's refused (400, "You can't change the tags of Pat's notes." / "Only Pat can change the due dates of their notes."). The owner's note keeps all its tags, including those the recipient can't see.
- **Lifetime:** Waiting, Archive and Reinstate need edit; Bin needs edit and delete.
- **Adding** (`POST /api/notes`) with any shared tag goes to the owner's notebook. It's refused if the note also has the user's own tags, has shared tags from two owners, has a tag shared read-only (403), or has a due date. A child note of a shared long-form note must have one of its owner's shared tags. The owner's note and stylus-note limits apply: "Pat's notebook is full, so this note can't be added."
- **Deleting** a shared note (`DELETE /api/notes/:id`) is only for cancelling a new long-form note: it needs edit, and the note's details must still be empty.
- **Bulk changes:** multi-select (`PUT /api/notes/bulk-tags`) refuses shared notes. Reset New covers the user's own New notes and the shared ones they may edit. With `noteIds`, Waiting → Archive includes shared notes they may edit, and Archived → Bin those they may also delete. Without `noteIds` (Settings), Archived to Bin is only the user's own notes, as is Empty Bin.
- **"By <name>" in the History:** each request runs as its user (Node's `AsyncLocalStorage`, `server/src/context.ts`). A change saved in someone else's notebook adds " (by <display name>)" to its History summary. A long-form note's autosaves only join the previous change if the same person made it.
- **Texts:** a texted note on a tab with one shared tag goes to its owner's notebook, under the same rules. A tab with several shared tags is refused with a text back. "Email tab" uses the recipient's view.

### The app
- **Settings:** "Shared with me" is listed with the built-in categories (it can't be moved). Its page (`/settings/categories/-2`) shows its tags as "Shopping (Pat)" with their colour boxes, grips and arrows, but no name boxes, delete buttons or Add tag; Save sends `PUT /api/shared-tags`.
- **A category's page:** each saved tag has a share button (`fa-share-nodes`, "Share <tag>"), greyed out until the tag is saved. It opens the share dialog: the people it's shared with, each with a Read-only / Edit / Edit and delete choice and a remove button (`fa-xmark`); then a list of linked people not yet in it, with "Someone else…" for typing an email address, and **Add**. **Save** sends the whole list.
- **Labels:** everywhere a shared tag is shown, it's "Shopping (Pat)", the owner's display name cut to 10 characters and "…" (`tagLabel`).
- **Notes shared with you:** read-only notes have no buttons: an eye (`fa-eye`, "Shared by Pat, to read only") in their place. Edit adds Edit, Waiting/Reinstate and Archive. Edit and delete also adds Move to bin. Edit-order mode's Move to top / Move to bottom work on every note.
- **Editing one:** the tag dropdowns (or pills) are greyed out, in the long-form editor too (and its Match the tab button), and there's no due-date button.
- **New notes:** the app checks a note with shared tags before sending it, with the server's messages.
- **Multi-select:** shared notes can't be selected (All selects only your own), and "Shared with me" pills aren't offered.
- **Settings' Lifetime counts:** Reset New counts your own New notes and the shared ones you may edit. Archived to Bin and Empty Bin count only your own.

### Live updates
- Any change saved in a notebook tells the pages of everyone it's shared with, and of its owner when someone else made it (the page that made it isn't told, as for any change).
- Changing a tag's shares tells the people added, changed or removed. Ending shares of deleted tags tells those recipients.

### Access checks
- With global ids, a request can name another user's note. Every route that takes a note id checks that the note is the logged-in user's own, or is shared with them at a level that allows the action. Anything else is answered as if the note didn't exist (404), so nobody can find out which ids exist.
- Tests cover every note route at each level (none, read-only, edit, edit-and-delete), including trying other users' ids directly.

