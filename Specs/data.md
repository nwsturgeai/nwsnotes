# Data: database, history, backups and API

## Database
The notes, categories and tabs should be stored in a database hosted by Supabase (on the free plan) instead of in save-files.
Each change should only write what changed, rather than a complete copy of everything.
Existing notes must be moved across automatically, with nothing lost.
"Download backup" on the settings page should still give me a single file with all my data.

## History and revert
The app should keep a history of recent changes: every add, edit, Lifetime change, tag change, and change to categories and tabs.
The settings page should lead to a History page, listing the changes newest first, each with its time and a short description.
I should be able to go back to how everything was just after any change in the list. Going back should itself be a change in the history, so it can be undone.
Bulk changes (such as Empty Bin, or changing the tags of several notes at once) should count as one change, so one step undoes them.

## Agreed technical decisions

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

### Save files
- **Replaced by the database** (see "Database"): the server no longer writes save-files. It reads the latest one once, to import it, and "Download backup" still gives a file in this format.
- Folder: `/var/lib/nwsnotes/data` (outside the app's code folder, so deployments never touch it).
- Filename format: `notes-2026-10-24T09-40-12-345Z.json` (UTC timestamp, no colons).
- Files are written to a temporary name and then renamed, so a crash mid-save can't leave a corrupt file.
- Retention cleanup runs after each save and when the server starts.
- Contents: `{ "version": 2, "savedDateTime": "...", "notes": [...], "categories": [...] }`. A version 1 file (from before tags) loads with no categories and every note's `tagIds` empty; the next save writes version 2. Handwritten notes add `titleImage` in place of `titleText`; the file stays version 2, as existing files are still valid. Tabs are saved as a `"tabs": [...]` list in the same file (still version 2); a file without it loads with no tabs, so only "All" shows. A `"lastNoteId"` number is also stored (still version 2), so note ids are never reused after notes are deleted; the built-in Lifetime category itself isn't stored, only each note's Lifetime tag id.

### Database
- **Engine:** PostgreSQL hosted by Supabase, on the free plan. The Supabase dashboard isn't used to look at or edit the data.
- **Connecting:** the server connects straight to Postgres with the `pg` package, through Supabase's connection pooler (session mode, which works over IPv4), using a small pool of connections. It doesn't use Supabase's JavaScript library or web API: a change and its history must be saved together in one transaction, which a direct connection does simply.
  - The connection string (with its password) is `databaseUrl` in `/etc/nwsnotes/config.json` on the VM, never in the repository. In production the server won't start without it.
  - The connection uses SSL, checked against Supabase's certificate, saved from the dashboard to `/etc/nwsnotes/supabase-ca.crt`.
  - The Supabase project's region should be the one nearest the VM, so each change adds only a few milliseconds.
- **Private tables:** the tables live in their own schema, `nwsnotes`, not in `public`. Supabase's automatic web API only shows the schemas it's told to, so nothing is reachable except through the app's own server.
- **Tables:**
  - `notes`: `id` (the note id) and `data`, the note as `jsonb`, exactly as the API sends it.
  - `categories` and `tabs`: `id`, `position` (their order on the settings page) and `data` as `jsonb`. A category's tags, in their order, are in its JSON, as now.
  - `meta`: small values by name, such as `lastNoteId`, so ids are still never reused.
  - `changes` and `change_items`: the history (see "History and revert").
  - Storing each item as JSON keeps it in exactly the shape the API and the app already use, so nothing else has to change. The server keeps everything in memory, as now, and reads the database only at start-up.
  - The server creates the schema and tables itself when they don't exist yet, so setting up needs only an empty Supabase project.
- **Writing a change:** each change runs in one transaction that updates only the rows it changed and records the change in the history. If anything fails, nothing is changed, in the database or in memory.
- **When Supabase can't be reached:** the server answers 503 "The database can't be reached". The app already treats 503 as being offline: changes wait in the outbox and are sent once the server answers again.
  - If the database can't be reached when the server starts, it keeps trying every 30 seconds, answering 503 meanwhile, rather than stopping.
  - If a free project has been paused after a week without activity, it needs "Restore" pressing in the Supabase dashboard; the app then carries on by itself.
- **Daily activity:** once a day the server runs a small query, so the project counts as in use and isn't paused while the app is idle. Supabase may not count this as activity, in which case a pause after a long break is accepted (see above).
- **Moving the data across:** when the server starts and the database has no data, it imports the most recent save-file in the data folder (if there is one) in one transaction, recorded in the history as "Imported from notes-….json". The old save-files are left where they are, untouched, and no new ones are written.
- **Download backup:** `GET /api/notes/download` still returns one file in the save-file format (version 2, with `notes`, `categories`, `tabs` and `lastNoteId`), built from the data and named with the time, e.g. `notes-2026-11-18T09-40-12-345Z.json`.
- **Daily backup file:** once a day the server also writes that same file to `backups/` in the data folder on the VM, e.g. `backups/notes-2026-11-18.json`. Seven are kept. They're a copy away from Supabase, as the free plan has no backups of its own.
- **Restoring a backup by hand** (if ever needed): on the VM, `node server.cjs --restore <file>` replaces all the notes, categories and tabs with the file's, in one transaction, recorded in the history as "Restored from <file>" (so even that can be undone). The app is restarted afterwards.
- **Push devices** stay in `push-keys.json` and `push-subscriptions.json` on the VM: they belong to each device, aren't part of the notes, and aren't in the history.
- **Development and tests use PGlite,** a copy of Postgres that runs inside Node (the `@electric-sql/pglite` package), with nothing else to install. It's used whenever no `databaseUrl` is set: in development its files are in `server/dev-data/pglite/`, and the tests have their own. So development and tests never touch the real database, and GitHub runs the tests without Supabase.
  - The server's code is the same for both; only the connection differs. The tables and queries are plain Postgres, which both understand.
- **Tests:** `POST /api/test/reset` empties every table, history included, and imports the seed, so every test still starts the same way. New tests check that the data survives a server restart, that the first start imports a save-file, and that the app goes offline (and catches up) when the database can't be reached.

### History and revert
- **Stored as "before" copies:** every change adds a row to `changes`, and one row to `change_items` for each item it touched, holding that item as it was before the change:
  - `changes`: `id` (in order), `time`, `summary` (e.g. "Archived 'Buy milk'") and `itemCount`.
  - `change_items`: `changeId`, `kind` (`note`, `category`, `tab` or `meta`), `itemId` and `before`: the item's row (its JSON, and `position` for categories and tabs) as it was before the change, or empty when the change created it.
  - A handwritten note's image is only stored again when that note changes.
- **Going back to just after change P:** in one transaction, for each item touched by a change after P, the server takes its `before` copy from the earliest such change and puts it back: it replaces the item, or deletes it if the copy is empty (the item didn't exist then). Items that no later change touched are already as they were. A deleted note comes back with its old id, which is safe, as ids are never reused. `lastNoteId` isn't taken back, for the same reason.
- **Going back is a change too:** it's recorded with its own "before" copies and a summary such as "Went back to 18 Nov 09:40 (12 changes undone)", so it can be undone the same way.
- **Everything about an item comes back:** a note's title, details, tags, due date, Lifetime and its times (`lastModifiedDateTime`, `tagsChangedDateTime`) are all part of its copy, so they return exactly as they were.
- **One change per action:** an add, an edit, a Lifetime change, a tab's new order, a category or tab saved, and each bulk action (multi-select tags, Reset New, Archived to Bin, Empty Bin, a category changed to single-select, deleting tags) is one change, however many items it touches.
- **Long-form autosaves:** a save of a long-form note's details while it's being written (every 30 seconds) joins the previous change if that was an update of the same note and nothing else has changed since. The change's time is updated and nothing more is stored, since its "before" copy is already there. This matches how save-files are replaced today.
- **Offline changes** are recorded when they reach the server, like any other. Changes still waiting on another device are sent after a revert, and apply on top of it.
- **How long history is kept:** 30 days. Older changes are deleted once a day; going back is possible as far as the oldest change kept.
- **API:**
  - `GET /api/history?before=<changeId>&limit=50`: the latest changes, newest first, as `{ changes: [{ id, time, summary, itemCount }] }`. `before` loads the next, older page.
  - `POST /api/history/revert` with `{ toChangeId }`: goes back to just after that change, returns `{ undone: <number of changes undone> }` and tells other pages to reload.
  - Both need the login session, like the rest of the API.
- **History page** (`/history`, reached from a "History" link on the settings page; "← Settings" goes back):
  - The changes, newest first, under a heading for each day ("Today", "Yesterday", then e.g. "Mon 16 Nov"). Each shows its time and summary.
  - Each change apart from the newest has a "Go back to here" button. It asks first: "Go back to how everything was just after this change, at 09:40 on 18 Nov? This undoes the 12 later changes. You can undo this too." with "Go back" and "Cancel".
  - Afterwards, a short message says how many changes were undone, and the new change shows at the top of the list.
  - "Load older changes" at the bottom, while there are more.
  - It needs the server, so the link is greyed out offline, like the settings cog.
- **Not in the history:** device settings (stylus mode, columns, pen thickness, full-tag-list mode, a tab's additional filters), push devices, and logging in or out.
- **Tests:** a new `history.spec.ts`. Changes are listed with their summaries. Going back undoes later notes, edits, Lifetime changes and settings changes. A bulk change is undone in one step. A revert can itself be undone. Long-form autosaves make one change.
