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
- Showing the owner which of their tags are shared (and with whom) on the settings and category pages is for later, not now.

### What each level allows
No level lets a recipient change the tags of the owner's notes, apart from the Lifetime changes listed here.
- **Read-only:** see the notes. No note buttons.
- **Edit:** also edit the notes (title and details), and Waiting, Archive and Reinstate. Also create new notes with the tag (below).
- **Edit-and-delete:** also Move to Bin.
- **Nobody but the owner** can empty the owner's Bin (the only permanent delete), or set or change a due date.

A note's Lifetime is shared: if a recipient archives one of the owner's notes, it's archived for the owner and every other recipient too.

### "Shared with me"
- A user who has had any tags shared with them gains a new category, **"Shared with me"**, holding every tag shared with them, from every owner. It's multi-select, as one note can have several tags shared with the same person.
- Each tag in it shows its owner's display name, cut to its first 10 characters followed by "…" when it's longer, e.g. "Shopping (Pat)" or "Shopping (Christophe…)":
  - always on the category page and in the dropdowns and full-tag-list pills;
  - on the pills under a note, only when two tags shared with this user have the same name.
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

### Access checks
- With global ids, a request can name another user's note. Every route that takes a note id checks that the note is the logged-in user's own, or is shared with them at a level that allows the action. Anything else is answered as if the note didn't exist (404), so nobody can find out which ids exist.
- Tests cover every note route at each level (none, read-only, edit, edit-and-delete), including trying other users' ids directly.

### Live updates
- A change to a note sends "data changed" to the owner's pages and to the pages of every recipient who can see the note, before and after the change. So a recipient sees a note appear or disappear when the owner adds or removes a shared tag.
- Starting, changing or ending a share also tells that recipient's pages to reload.
