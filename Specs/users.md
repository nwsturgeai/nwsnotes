# Users: separate notebooks for family and friends

## Requirements

The app can be used by several people, each with their own completely separate notebook. Nobody can see or change anyone else's notes, categories, tabs, history or settings. There are no shared notes.

### Accounts
- The owner of the app (the "admin") creates every account. There is no sign-up page.
- Accounts have no email address for now. A person logs in with a login name and a password.
- When the admin creates an account, the app generates a password and shows it to the admin once, so the admin can send it to the person.
- Each person can change their own password in Settings, once logged in.
- The admin can reset a person's password (the app generates a new one and shows it once), and can turn an account off and on again. A turned-off account can't log in, and any devices it's logged in on are logged out.
- The admin can't see anyone else's notes.
- The existing notes, categories, tabs and history become the admin's own notebook, unchanged.

### New accounts
- A new account starts empty: no notes, no categories and no tabs (only the built-in "All" tab and the built-in Lifetime category). An introduction guide, written separately later, will explain how to start.

### Later, not now
- Email addresses: logging in with an email, people choosing their own password from an emailed invitation, and "forgot password" emails. The accounts are designed so this can be added without reworking them: data belongs to a user's id, never to their login name, and an email can be added to each user.
- iPhone support.
- Encryption.
- Deleting an account and its data (an account can be turned off instead).

## Agreed technical decisions

### Users
- **Stored in the database,** in a new `users` table: `id` (1, 2, 3...), `login_name` (unique, compared ignoring case) and `data` (`jsonb`) holding:
  - `displayName`, shown in Settings and the users page;
  - `passwordHash`, in the existing scrypt format (`scrypt$<N>$<salt>$<hash>`, see `server/src/auth.ts`);
  - `admin` (true only for user 1; there's one admin, and it can't be changed in the app);
  - `disabled` (turned off);
  - `sessionVersion`, a number that goes up whenever this user's existing logins must stop working (see Sessions);
  - `createdDateTime` and `lastLoginDateTime`.
- **Login names:** 3 to 32 characters, letters, digits, `.`, `-` and `_`, unique ignoring case. They can be changed by the admin; data never depends on them.
- **Display names:** 1 to 60 characters, any text.
- **Users aren't in the History,** and aren't in the save-files or backups (those hold one notebook each).
- **Generated passwords:** 16 characters from lowercase letters and digits, leaving out ones easily confused (`0`, `o`, `1`, `l`, `i`), shown in four groups of four with dashes, e.g. `kq7m-x4tp-9wfd-hr3c`. The dashes are part of the password. They're made with a cryptographically secure random generator, shown once, and only their hash is kept.
- **Passwords people choose:** at least 10 characters, at most 200.

### Logging in
- **The login page** has two boxes, "Name" (the login name) and "Password", and "Log in". Wrong name or password: "Incorrect name or password." A turned-off account: "This account is turned off." The browser's password manager can fill both in.
- **Rate limited** as now (10 attempts per 15 minutes from one address).
- **Sessions** stay as signed cookies that last 30 days, but now say who is logged in: the cookie holds `<user id>.<session version>.<expiry ms>.<signature>`. A request is accepted only if the signature is right, it hasn't expired, the user exists and isn't turned off, and the session version matches the user's. The user is then known for the rest of the request.
- **Logging everyone out of one account** is done by raising its `sessionVersion`: resetting its password, turning it off, or the person changing their own password (the device they changed it on gets a fresh cookie, so it stays logged in; their other devices are logged out).
- **Cookies from before this change** have no user, so they're refused, and the admin logs in again once after the update.
- `GET /api/me` returns `{ id, loginName, displayName, admin }` for the logged-in user.

### Settings for every user
- **Account section** (at the bottom, as now): "Logged in as <display name> (<login name>)", a "Change password" button and "Log out".
- **Change password** page (`/settings/password`): "Current password", "New password" and "New password again", and "Change password". Saved with `PUT /api/me/password` and `{ currentPassword, newPassword }`. Errors: "The current password isn't right.", "The new password must be at least 10 characters.", "The new passwords don't match." (checked in the page). On success it goes back to Settings with "Password changed. Your other devices have been logged out."
- Not available offline, like the rest of Settings.

### The users page (admin only)
- **Where:** a "Users" section in Settings, shown only to the admin, just above Account, with a "Manage users" link to `/settings/users`.
- **The list:** every user, in id order: display name, login name, "Admin" or "Turned off" labels, when it was created, and when it last logged in ("Never" if not yet).
- **Add user:** display name and login name, then "Add". The new password is then shown in a pop-up, "Send this password to <display name>. It won't be shown again.", with a "Copy" button and "Done". `POST /api/users` with `{ loginName, displayName }` returns `{ user, password }`.
- **For each user** (other than the admin's own row, which only has Edit):
  - **Edit:** change the display name or login name (`PUT /api/users/:id`).
  - **Reset password:** after "Reset <display name>'s password? They'll be logged out everywhere.", a new password is shown in the same pop-up as when adding (`POST /api/users/:id/reset-password` returns `{ password }`).
  - **Turn off / Turn on:** turning off asks first, "Turn off <display name>'s account? They'll be logged out everywhere and can't log in until it's turned on again." (`PUT /api/users/:id` with `{ disabled: true }`).
- **The admin can't** turn their own account off or reset their own password here (they change it like anyone else).
- **Protected on the server:** all `/api/users` routes answer 403 for anyone but the admin.

### Separate notebooks
- **Everything that's now "the data" becomes per user:** notes, categories, tabs, the All tab's placement, the shared note order, `lastNoteId`, the History, backups, and reminder devices.
- **Ids are per user:** each notebook's note, category and tab ids start at 1, exactly as now. So a notebook, its API responses and its save-files look the same as a single-user one.
- **Database:**
  - `notes`, `categories` and `tabs` get a `user_id` column, and their primary keys become `(user_id, id)`.
  - `meta` gets `user_id`, and its key becomes `(user_id, name)`.
  - `changes` gets `user_id`. `change_items` belong to their change, so need nothing new.
  - Every query is limited to the logged-in user's rows.
- **Server memory:** one `NoteStore` per user, created and loaded from the database the first time that user's data is needed, and kept. Each keeps its own queue of changes, so one person's save never waits for another's.
- **The API doesn't change shape:** `GET /api/notes` and all the other data routes work as now, on the logged-in user's notebook.
- **Live updates:** each WebSocket connection belongs to the user whose cookie opened it. "Data changed" messages go only to that user's other connections. Turning off an account or raising its session version closes its connections.
- **Reminders:** each push subscription belongs to the user whose device registered it, and a user's reminders go only to their own devices. "Send test" reaches only that user's devices. The subscriptions file gets a `userId` on each entry; existing ones belong to user 1.
- **The test endpoints** (`/api/test/*`, test mode only) act on the logged-in user's notebook. `/api/test/reset` also removes every user but user 1 and puts user 1's password back to the test password.

### Moving the existing data to user 1 (once)
- **On the first start of the new version,** if the `users` table is empty:
  - user 1 is created, as the admin, with the login name from `adminLoginName` in the config (default `admin`), the display name `Admin` (changeable on the users page), and the existing `passwordHash` from the config, so the current password keeps working;
  - all existing rows get `user_id` 1, and the keys change as above, in one transaction;
  - the existing backup files move to user 1's backup folder (below), and the existing push devices become user 1's.
- After that, the config's `passwordHash` is no longer used.
- **In development,** the admin's login name is `admin` and its password `dev`, as now.
- **The offline copy on a device** from before the update has no user. After the update, the first login on that device keeps it, and any waiting changes, only if it's user 1 who logs in. Otherwise they're cleared.

### Backups, restore and daily jobs
- **Daily backup files** go to `backups/<user id>/notes-YYYY-MM-DD.json`, seven kept for each user.
- **"Download backup"** gives the logged-in user's own notebook, as now.
- **Restoring by hand:** `node server.cjs --restore <file> --user <login name>`. Without `--user` it refuses.
- **A forgotten admin password:** `node server.cjs --reset-password <login name>` on the VM prints a new generated password for that user and logs them out everywhere. This works for any user.
- **The daily jobs** run once a day for all users: one keep-alive query, each user's backup, and pruning every user's history older than 30 days.

### Offline copy on a device
- The offline copy and the outbox of waiting changes are kept under the user's id, so two people who use the same device never see each other's notes.
- **Logging out** clears that user's offline copy from the device. If changes are still waiting to be sent, it asks first: "<n> changes haven't been saved to the server yet. Log out anyway and lose them?"
- Device settings (stylus mode, columns, pen thickness, full-tag-list mode) stay per device, as now.

### Note limit
- **Each user has a maximum number of notes,** `noteLimit` in their `data` (1000 when missing), the admin included. It counts all their notes: archived, Bin, long-form notes and their child notes.
- **Adding a note at the limit is refused** by the server (`POST /api/notes`, 409): "You've reached your limit of <limit> notes. Empty the Bin to make room, or ask the admin for a higher limit." The page shows it like other save errors, keeping the typed title or writing. Editing, archiving and everything else carry on as normal. A note written offline that's refused when it's sent is dropped, and the sync notice names it as not saved, as for any refused change.
- **Restoring a backup** (`--restore`) and the test endpoints aren't limited.
- **What people see:** the limit only shows once they're within 20% of it (at least 80% of it used): the line at the top of Settings then reads "You have <n> of your <limit> notes, taking up <size>." Below that, it reads as before. `GET /api/me/stats` also returns `noteLimit`.
- **The admin sees and sets it:** each row on the users page reads "<n> of <limit> notes · <s> of <stylus limit> stylus notes · <size>", and **Edit** has a "Note limit" box (a whole number from 1 to 100,000), saved with `PUT /api/users/:id` and `{ noteLimit }`. It can be set below someone's current count: they keep their notes, but can't add more until they're under it. `UserSummary` gains `noteLimit`.

### Stylus-note limit
- **Each user can also have at most 5% of their note limit as stylus notes** (rounded down, and at least 1): 50 with the default 1000. It isn't set separately: the admin changes it by changing the note limit, and the Edit form says what it comes to ("5% of them can be stylus notes: <n> stylus notes.").
- **A stylus note** is a regular note with a handwritten title, or a long-form note with handwritten details (counted from when it's started, while its details are still empty). A long-form note's child notes count by their own titles. As with the note limit, archived and Bin notes count.
- **Adding a stylus note at the limit is refused** (`POST /api/notes`, 409): "You've reached your limit of <limit> stylus notes. Empty the Bin to make room, or ask the admin for a higher limit." So is converting a typed note to a long-form note with handwritten details (`PUT /api/notes/:id`, 409, the same message). Typed notes can still be added, and stylus notes already there can still be edited. It's shown like the note limit's refusal.
- **What people see:** once they've used at least 80% of it, the line at the top of Settings adds "You have <s> of your <limit> stylus notes." `GET /api/me/stats` and `UserSummary` also return `stylusNoteCount` and `stylusNoteLimit`.

### Category, tag and tab limits
- **Each user can have at most 20 categories** (the built-in Lifetime category doesn't count), **40 tags in each category**, and **40 tabs** (the built-in "All" tab doesn't count). These are fixed for everyone: the admin doesn't set them.
- **The server refuses more** (400, from the shared checks, so the page refuses them too before sending): "You can have at most 20 categories.", "A category can have at most 40 tags; this one has <n>.", and 'You can have at most 40 tabs, as well as "All".' Editing, renaming and reordering existing categories and tabs carry on as normal.
- **What people see:** once they're at the limit, Settings shows "You have the most categories you can (20). Delete one to add another." in place of **Add category**, and likewise for tabs in place of **Add tab**. On a category's page, once it has 40 tag rows, **Add tag** (and Enter in a tag box) gives way to "A category can have at most 40 tags."
- **Restoring a backup** (`--restore`) and the test endpoints aren't limited.

### Storage
- The free Supabase database holds 500 MB in all. Handwritten notes are the biggest items, so the users page also shows each user's number of notes. A limit per user isn't needed yet.
- **How much space notes take:** measured as the space the notes' rows take in the database, after its own compression (`sum(pg_column_size(data))` over the user's `notes` rows), since that's what counts towards the 500 MB. It includes every note (archived and Bin too), but not the History's earlier copies. Shown in bytes below 1 KB, otherwise in KB or MB (1024-based) to one decimal place, e.g. "2.4 MB".
- **Settings (everyone):** just under the "Settings" title, "You have <n> notes, taking up <size>." ("1 note" for one), from `GET /api/me/stats`, which returns `{ noteCount, noteBytes }` for the logged-in user. It shows "…" in place of the figures while loading, and nothing if it fails.
- **The users page:** each user's row shows their note count and size, e.g. "42 notes · 1.1 MB" (`UserSummary` gains `noteBytes`). Above the list, a total for everyone: "All users: <n> notes, <size> of the database's 500 MB." A small note under it says the History's earlier copies take some extra space.

### Tests
- A new `users.spec.ts`:
  - The admin adds a user; the generated password is shown once and has the right form; the new user can log in and sees an empty notebook ("All" only, no categories).
  - Two users' notebooks are separate: notes, categories and tabs added by one never show for the other, through the pages or the API, and their ids both start at 1.
  - Live updates reach only the same user's other windows.
  - Changing your own password: the old one stops working, this window stays logged in, another window of the same user is logged out.
  - Resetting a password and turning an account off log that user out; a turned-off account can't log in, with "This account is turned off."; turning it on again lets them log in.
  - A non-admin sees no Users section, and `/api/users` answers 403.
  - The login form refuses a wrong name or password.
- The existing tests log in as the admin (`admin` / `dev`), so they keep working.
- `database.spec.ts`: a database from before users (no `users` table and no `user_id` columns) is moved to user 1 on start, with its notes, history and order unchanged, and the old password still logs in.
