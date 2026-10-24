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
A list of all notes in the top 3/4 of the page.  Notes should appear in created-date order with the most recently created at the bottom of the list.  Each row should show the note title.  Rows should be separated by a thin horizontal line.
For now, if the top 3/4 of the page isn't enough space to show all notes, then scroll vertically to see the rest.  Only the top 3/4 of the screen should scroll.
There will be an area to enter a new note in the bottom 1/4 of the page - always visible even if there are more notes than fit.
For now, phone layout is not important, I will make changes later to address that use-case.

## Settings and lifecycle

There will be a header strip across the top of the app.  The app will have a settings page, accessible by clicking a cog icon located on the right-hand edge of the top header strip.
The settings page will contain the option to log out (that won't be shown on the main notes page).
The settings page will contain an option to download the latest json file from the server containing all the notes data.  I will use this to manually take backups every few days.

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
For now, it will not be possible to delete tags or categories.
For now, it will not be possible to change the tags a note has after the note has been created.
After a category has been saved as multi-select, it is not possible to revert it to single-select later.

On the main notes page:
Each note should also display its tags.  These should be shown in a list of pills underneath the note title.  If 2 categories have tags with the same name, there is a possibility that a note has 2 tags with the same text.  This is OK.
When adding a note, the user can set tags.  There should be a dropdown for each Category.  For single-select categories this can be a simple dropdown with a "(none)" option. For multi-select categories, use a dropdown that opens a check-list.
The dropdowns should appear underneath the textbox where the note title is entered.
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


## Agreed technical decisions

### Code and tooling
- One repository with npm workspaces: `client/` (React + TypeScript, built with Vite), `server/` (Express + TypeScript) and `shared/` (TypeScript types used by both, e.g. `Note`).
- Node.js 24 (LTS). No automated tests for now.

### API
- `GET /api/notes` - returns `{ "notes": [...], "categories": [...] }`: all notes and all categories with their tags (the most recent save-file's contents).
- `POST /api/notes` - body `{ "titleText": "...", "tagIds": [3, 7] }` (`tagIds` may be empty). The server assigns the id and timestamps, saves a new save-file and returns the created note. The website sends its connection id in an `X-Connection-Id` header (see Live updates).
- `POST /api/categories` - body `{ "name": "...", "multiSelect": false, "tags": [{ "name": "..." }] }`. The server assigns the category and tag ids, saves a new save-file and returns the created category.
- `PUT /api/categories/:id` - body as above, but existing tags include their `id` (`{ "id": 3, "name": "..." }`); tags without an `id` are new. Saves a new save-file and returns the updated category.
- Changes send the `X-Connection-Id` header too, and the server checks every rule in "Tags" below, returning HTTP 400 with a clear message if one is broken.
- `GET /api/notes/download` - returns the most recent save-file exactly as it is on disk (including its `version` and `savedDateTime` fields), as a file download named with the save-file's own name, e.g. `notes-2026-10-24T09-40-12-345Z.json`. A backup can be put straight back into the data folder.
- `POST /api/login` - body `{ "password": "..." }`. On success sets the session cookie.
- `POST /api/logout` - clears the session cookie.
- All `/api/notes` and `/api/categories` calls require a valid session; otherwise they return HTTP 401 and the website shows the login page.

### Login
- A login page with a single password field. On success the server sets a secure, HttpOnly session cookie that lasts 30 days.
- "Log out" is on the settings page only, not on the main notes screen.
- The 32-character password is generated once on the VM. Only a hash of it is stored, in `/etc/nwsnotes/config.json` on the VM, never in GitHub.
- The login endpoint is rate limited.

### New-note area
- A single-line text box and an "Add" button. Pressing Enter also adds the note.
- After a successful save the text box clears and keeps focus, and the list scrolls to the bottom so the new note is visible.
- When the page loads, the list starts scrolled to the bottom.

### Tags
- Shared types in `shared/`: `Tag { id, name }`, `Category { id, name, multiSelect, tags: Tag[] }`, and `Note` gains `tagIds: number[]`. The name and tag rules are checked by shared functions used by both the website and the server, like the note title.
- Ids: a new category gets the highest category id + 1; a new tag gets the highest tag id across all categories + 1. Both start at 1.
- Category and tag names are trimmed, can't be empty and are at most 40 characters. Category names must be unique, and tag names unique within their category; both checks ignore upper/lower case ("Work" and "work" count as the same).
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
- Under the title text box there is one dropdown per category, labelled with the category name. Single-select categories use a normal dropdown with "(none)" first. Multi-select categories use a button showing the chosen tag names (or "(none)") that opens a check-list.
- After a note is added, the dropdowns keep their selections until the page is reloaded. A category added on another page appears as a new dropdown set to "(none)".
- If there are more dropdowns than fit, the bottom 1/4 area scrolls.

### Header and settings page
- The header strip has a fixed height. The rest of the page below it is split 3/4 note list, 1/4 new-note area.
- The cog icon at the right of the header opens the settings page at its own address, `/settings`, so the browser's and Android's back button returns to the notes. The header on the settings page has a "← Notes" link.
- The settings page has "Log out" and "Download backup". "Download backup" is a plain link to `GET /api/notes/download`; the session cookie is sent with it automatically.

### Live updates (WebSocket)
- The website connects to `wss://nwsnotes.duckdns.org/ws`, on the same port (443) as the site.
- The server only accepts the connection if the session cookie is valid and the request's `Origin` is the site's own address, so other websites can't connect using the cookie.
- Each page load creates a random connection id and sends it with every change it makes (`X-Connection-Id` header). After a change is saved (a note added, or a category added or edited), the server sends `{ "type": "data-changed" }` to every other open connection; they reload the notes and categories with `GET /api/notes`. The same message will be used later for note editing and deleting.
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
- Contents: `{ "version": 2, "savedDateTime": "...", "notes": [...], "categories": [...] }`. A version 1 file (from before tags) loads with no categories and every note's `tagIds` empty; the next save writes version 2.

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
