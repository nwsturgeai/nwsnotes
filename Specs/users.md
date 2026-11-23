# Users: separate notebooks for family and friends

## Requirements

The app can be used by several people, each with their own completely separate notebook. Nobody can see or change anyone else's notes, categories, tabs, history or settings. The one exception is tags an owner chooses to share, described in [sharing.md](sharing.md).

### Accounts
- People ask for an account themselves on a public sign-up page (`/signup`), which the admin shares with family and friends, choosing their own password. The admin confirms each request before it can be used. The admin can also still add an account directly, with a generated password.
- A person logs in with their email address and a password: every login name is an email address. (Emails aren't sent yet.)
- When the admin creates an account, the app generates a password and shows it to the admin once, so the admin can send it to the person.
- Each person can change their own password in Settings, once logged in.
- The admin can reset a person's password (the app generates a new one and shows it once), and can turn an account off and on again. A turned-off account can't log in, and any devices it's logged in on are logged out.
- The admin can't see anyone else's notes.
- The existing notes, categories, tabs and history become the admin's own notebook, unchanged.

### New accounts
- A new account starts empty: no notes, no categories and no tabs (only the built-in "All" tab and the built-in Lifetime category). An introduction guide, written separately later, will explain how to start.

### Later, not now
- "Forgot password" emails, sent to their login email. Data belongs to a user's id, never to their login name, so this needs no reworking.
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
- **Login names are email addresses:** something before an `@`, then a domain with at least one dot (e.g. `pat@example.com`), with no spaces, at most 254 characters, unique ignoring case. Otherwise: "A login name must be an email address, e.g. pat@example.com." They can be changed by the admin; data never depends on them.
- **Names from before this rule** (such as `admin`) still log in, so nobody is locked out, and the users page marks each one "Not an email address" until the admin changes it to an email. Saving an Edit that leaves such a name as it is (e.g. changing only the note limit) is allowed; any new or changed name must be an email.
- **Display names:** 1 to 60 characters, any text.
- **Users aren't in the History,** and aren't in the save-files or backups (those hold one notebook each).
- **Generated passwords:** 16 characters from lowercase letters and digits, leaving out ones easily confused (`0`, `o`, `1`, `l`, `i`), shown in four groups of four with dashes, e.g. `kq7m-x4tp-9wfd-hr3c`. The dashes are part of the password. They're made with a cryptographically secure random generator, shown once, and only their hash is kept.
- **Passwords people choose:** at least 10 characters, at most 200.

### Logging in
- **The login page** has two boxes, "Email" (the login name) and "Password", and "Log in". The Email box is a text box with an email keyboard, not an email-only box, so names from before the rule can still be typed. Wrong email or password: "Incorrect email or password." A turned-off account: "This account is turned off." The browser's password manager can fill both in.
- **Rate limited** as now (10 attempts per 15 minutes from one address).
- **Sessions** stay as signed cookies that last 30 days, but now say who is logged in: the cookie holds `<user id>.<session version>.<expiry ms>.<signature>`. A request is accepted only if the signature is right, it hasn't expired, the user exists and isn't turned off, and the session version matches the user's. The user is then known for the rest of the request.
- **Logging everyone out of one account** is done by raising its `sessionVersion`: resetting its password, turning it off, or the person changing their own password (the device they changed it on gets a fresh cookie, so it stays logged in; their other devices are logged out).
- **Cookies from before this change** have no user, so they're refused, and the admin logs in again once after the update.
- `GET /api/me` returns `{ id, loginName, displayName, admin }` for the logged-in user.

### Asking for an account (the sign-up page)
- **The page:** `/signup`, public (no login), linked from the login page as "No account yet? Ask for one". It's a page of its own, outside the app: no notes, offline copy or service-worker state. Heading "Ask for an account", with "Once you've sent this, your account will be checked and confirmed before you can log in."; boxes "Email", "Your name" (the display name), "Password" and "Password again" (at least 10 characters), and "Ask for an account".
- **Checked in the page:** "Please enter your email address, e.g. pat@example.com.", "The password must be at least 10 characters.", "The passwords don't match.". **On the server:** the same rules as everywhere (login names are emails, display names 1 to 60 characters, passwords 10 to 200), and "There's already an account, or a request for one, with that email. Try logging in instead." for an email that's a user's or another waiting request's, ignoring case.
- **Sent:** "Thanks, <name>. Your request has been sent." and "You can log in with your email and password once your account has been confirmed.", with "Go to the login page".
- **Stored** in its own table, `account_requests` (`id`, `login_name` unique ignoring case, `data` with `displayName`, `passwordHash` and `requestedDateTime`), not as a user: a request has no notebook, backups or sessions until it's confirmed. `POST /api/account-requests` with `{ loginName, displayName, password }`.
- **Limits:** 5 requests an hour from one address ("Too many requests from here. Please wait an hour and try again."), and at most 20 waiting at once ("Too many accounts are waiting to be confirmed just now. Please try again in a few days.", 503), so the public page can't fill the database.
- **Logging in before it's confirmed,** with the right password: "Your account is waiting to be confirmed. You can log in once it has been." With a wrong password, or after it's declined: "Incorrect email or password." as usual.
- **Not emailed:** the email isn't checked by sending to it; the admin knows who they're confirming.

### Confirming requests (admins)
- **The warning icon:** while any requests are waiting, every admin's header shows Font Awesome's `triangle-exclamation`, in the error colour, just before the stylus-mode icon (on every page). It's a link to the users page, titled "1 account is waiting to be confirmed" / "<n> accounts are waiting to be confirmed", and blocked (like the cog) while editing a note or offline.
- **The count** comes with `GET /api/me`, as `accountsWaiting`, for admins only. A request made, confirmed or declined sends a live "data changed" to every admin's open pages, which then fetch `/api/me` again with the notes, so the icon comes and goes without a reload.
- **On the users page,** above the users, a "Waiting to be confirmed" section lists each request (oldest first): name, email, "Asked <when>", **Confirm** and **Decline**. It's shown only while there are some, and says the sign-up page's address, to share.
  - **Confirm** makes the user, as **Add user** does (an empty notebook, the default note limit), but with the password they chose, and removes the request, in one transaction. They appear in the list of users. `POST /api/users/requests/:id/confirm` returns `{ user, emailed }` (the new `UserSummary`, and whether the email below was sent).
  - **The confirmation email** (through Brevo, see "Emailing a tab" in [text-messages.md](text-messages.md)), to their login email: subject "Your nwsnotes account is ready"; "Hello <name>," / "Your nwsnotes account has been confirmed." / "Log in at <link> with this email address (<email>) and the password you chose.", as plain text and HTML. The link is the site's address as the admin is using it (`https://nwsnotes.com/` in production). The account is made even if the email can't be sent (email not set up, or Brevo refusing); the page then says "<name>'s account is confirmed, but they couldn't be emailed: tell them they can log in now." instead of "<name>'s account is confirmed. They've been emailed at <email> with the link to log in."
  - **Decline,** after "Decline <name>'s request? It will be removed, and they won't be told.", deletes it (`DELETE /api/users/requests/:id`). They can ask again.
  - `GET /api/users/requests` lists them. All of these are admin only, like the rest of `/api/users`.
- **Adding or renaming a user by hand** to an email that's waiting is refused: confirm or decline the request instead.

### Settings for every user
- **Account section** (at the bottom, as now): "Logged in as <display name> (<login name>)", a "Change password" button and "Log out".
- **Change password** page (`/settings/password`): "Current password", "New password" and "New password again", and "Change password". Saved with `PUT /api/me/password` and `{ currentPassword, newPassword }`. Errors: "The current password isn't right.", "The new password must be at least 10 characters.", "The new passwords don't match." (checked in the page). On success it goes back to Settings with "Password changed. Your other devices have been logged out."
- Not available offline, like the rest of Settings.

### The users page (admin only)
- **Where:** a "Users" section in Settings, shown only to the admin, just above Account, with a "Manage users" link to `/settings/users`.
- **The list:** every user, in id order: display name, login name, "Admin" or "Turned off" labels, when it was created, and when it last logged in ("Never" if not yet).
- **Add user:** display name and "Email (to log in with)", then "Add". The new password is then shown in a pop-up, "Send this password to <display name>. It won't be shown again.", with a "Copy" button and "Done". `POST /api/users` with `{ loginName, displayName }` returns `{ user, password }`.
- **For each user** (other than the admin's own row, which only has Edit):
  - **Edit:** change the display name or login email (`PUT /api/users/:id`).
  - **Reset password:** after "Reset <display name>'s password? They'll be logged out everywhere.", a new password is shown in the same pop-up as when adding (`POST /api/users/:id/reset-password` returns `{ password }`).
  - **Turn off / Turn on:** turning off asks first, "Turn off <display name>'s account? They'll be logged out everywhere and can't log in until it's turned on again." (`PUT /api/users/:id` with `{ disabled: true }`).
- **Confirmations by text:** Edit also has "Text back to confirm each text", and rows with it on show "Texts back" (see "Confirmations" in [text-messages.md](text-messages.md)).
- **The admin can't** turn their own account off or reset their own password here (they change it like anyone else).
- **Protected on the server:** all `/api/users` routes answer 403 for anyone but the admin.

### Separate notebooks
- **Everything that's now "the data" becomes per user:** notes, categories, tabs, the All tab's placement, the shared note order, the History, backups, and reminder devices.
- **Ids:** each notebook's category and tab ids start at 1. Note and tag ids are unique across all users, so they can be shared (see "Global note and tag ids" in [sharing.md](sharing.md)).
- **Database:**
  - `notes`, `categories` and `tabs` get a `user_id` column, and their primary keys become `(user_id, id)`.
  - `meta` gets `user_id`, and its key becomes `(user_id, name)`.
  - `changes` gets `user_id`. `change_items` belong to their change, so need nothing new.
  - Every query is limited to the logged-in user's rows.
- **Server memory:** one `NoteStore` per user, created and loaded from the database the first time that user's data is needed, and kept. Each keeps its own queue of changes, so one person's save never waits for another's.
- **The API doesn't change shape:** `GET /api/notes` and all the other data routes work as now, on the logged-in user's notebook.
- **Live updates:** each WebSocket connection belongs to the user whose cookie opened it. "Data changed" messages go only to that user's other connections. Turning off an account or raising its session version closes its connections.
- **Reminders:** each push subscription belongs to the user whose device registered it, and a user's reminders go only to their own devices. "Send test" reaches only that user's devices. The subscriptions file has a `userId` on each entry.
- **The test endpoints** (`/api/test/*`, test mode only) act on the logged-in user's notebook. `/api/test/reset` also removes every user but user 1 and puts user 1's password back to the test password.

### The first user
- **On the first start with a new database** (the `users` table is empty), user 1 is created, as the admin, with the login name from `adminLoginName` in the config (an email address; `setup-vm.sh you@example.com` writes it, and the app won't make user 1 without it), the display name `Admin` (changeable on the users page), and the `passwordHash` from the config. After that, the config's `passwordHash` is no longer used.
- **In development and the tests,** the admin's login name is `admin@example.com` and its password `dev`.
- **Moving the single-user data to user 1 (done, and since removed):** the first start of the version with users gave every existing row `user_id` 1, moved the backup files and push devices to user 1, and handed each device's offline copy to user 1. Production has made that move, so the code for it is gone.

### Backups, restore and daily jobs
- **Daily backup files** go to `backups/<user id>/notes-YYYY-MM-DD.json`, seven kept for each user.
- **"Download backup"** gives the logged-in user's own notebook, as now.
- **Restoring by hand:** `node server.cjs --restore <file> --user <login email>`. Without `--user` it refuses.
- **A forgotten admin password:** `node server.cjs --reset-password <login email>` (or `setup-vm.sh --new-password <login email>`) on the VM prints a new generated password for that user and logs them out everywhere. This works for any user.
- **The daily jobs** run once a day for all users: one keep-alive query, each user's backup, and pruning every user's history older than 30 days (each user's history is also kept to their newest 500 changes, as each change is saved).

### Offline copy on a device
- The offline copy and the outbox of waiting changes are kept under the user's id, so two people who use the same device never see each other's notes.
- **Logging out** clears that user's offline copy from the device. If changes are still waiting to be sent, it asks first: "<n> changes haven't been saved to the server yet. Log out anyway and lose them?"
- Device settings (stylus mode, columns, pen thickness, full-tag-list mode) stay per device, as now.

### Note limit
- **Each user has a maximum number of notes,** `noteLimit` in their `data` (1000 when missing), the admin included. It counts all their notes: archived, Bin, long-form notes and their child notes.
- **Adding a note at the limit is refused** by the server (`POST /api/notes`, 409): "You've reached your limit of <limit> notes. Empty the Bin to make room, or ask the admin for a higher limit." The page shows it like other save errors, keeping the typed title or writing. Editing, archiving and everything else carry on as normal. A note written offline that's refused when it's sent is dropped, and the sync notice names it as not saved, as for any refused change.
- **Restoring a backup** (`--restore`) and the test endpoints aren't limited.
- **What people see:** the limit only shows once they're within 20% of it (at least 80% of it used): the line at the top of Settings then reads "You have <n> of your <limit> notes, taking up <size>." Below that, it reads as before. `GET /api/me/stats` also returns `noteLimit`.
- **The admin sees and sets it:** each row on the users page reads "<n> of <limit> notes · <s> of <stylus limit> stylus notes · <size> · <history size> History", and **Edit** has a "Note limit" box (a whole number from 1 to 100,000), saved with `PUT /api/users/:id` and `{ noteLimit }`. It can be set below someone's current count: they keep their notes, but can't add more until they're under it. `UserSummary` gains `noteLimit`.

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
- **How much space notes take:** measured as the space the notes' rows take in the database, after its own compression (`sum(pg_column_size(data))` over the user's `notes` rows), since that's what counts towards the 500 MB. It includes every note (archived and Bin too). **The History's size** is measured the same way, over the "before" copies in the user's `change_items` (`sum(pg_column_size("before"))`), and shown alongside. Shown in bytes below 1 KB, otherwise in KB or MB (1024-based) to one decimal place, e.g. "2.4 MB".
- **Settings (everyone):** just under the "Settings" title, "You have <n> notes, taking up <size>, plus <history size> for their History." ("1 note" for one), from `GET /api/me/stats`, which returns `{ noteCount, noteBytes, historyBytes }` for the logged-in user. It shows "…" in place of the figures while loading, and nothing if it fails.
- **The users page:** each user's row shows their note count and sizes, e.g. "42 notes · 1.1 MB · 300.2 KB History" (`UserSummary` gains `noteBytes` and `historyBytes`). Above the list, a total for everyone, notes and History together: "All users: <n> notes, <size> with their History." Under it, the real size of the whole database, from `pg_database_size(current_database())` (every table, index and the database's own overhead, so more than the notes and History alone): "The whole database takes up <size> of its 500 MB, including indexes and its own overhead." It comes from `GET /api/users/database-size` (admin only, `{ bytes }`), fetched alongside the list; if that fails, the line is left out.

### Tests
- A new `users.spec.ts`:
  - The admin adds a user; the generated password is shown once and has the right form; the new user can log in and sees an empty notebook ("All" only, no categories).
  - Two users' notebooks are separate: notes, categories and tabs added by one never show for the other, through the pages or the API, and their ids both start at 1.
  - Live updates reach only the same user's other windows.
  - Changing your own password: the old one stops working, this window stays logged in, another window of the same user is logged out.
  - Resetting a password and turning an account off log that user out; a turned-off account can't log in, with "This account is turned off."; turning it on again lets them log in.
  - A non-admin sees no Users section, and `/api/users` answers 403.
  - The login form refuses a wrong name or password.
  - Login names must be email addresses when adding or editing a user (in the page and the API); saving an unchanged name is allowed.
- A new `signup.spec.ts`: asking on the sign-up page (with its checks), logging in before it's confirmed; the warning icon appearing live and linking to the users page; confirming (they're emailed the login link, and log in with their own password to an empty notebook) and declining; non-admins seeing no icon or requests; a waiting email refused for Add user; the server's checks and the limit of 20 waiting.
- The existing tests log in as the admin (`admin@example.com` / `dev`).
- `database.spec.ts`: a database from before users (no `users` table and no `user_id` columns) is moved to user 1 on start, with its notes, history and order unchanged, and the old password still logs in.
