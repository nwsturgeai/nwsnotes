I want to create an app for managing my notes.
This app will be delivered as a website.
I have created a VM in DigitalOcean to host the server side of my website.
The VM should serve the static content of my website and also include a rest API which the website can call.
The server side API will be coded in typescript and will execute using nodejs.
The browser code should be written in typescript and should use React.
This site will be for a single user (me).  I should need a password to log in, this should be a string of 32 random characters.
The site should be delivered over HTTPS - I have a domain "nwsnotes.duckdns.org" which has a DNS entry pointing to my VM.

Each note will have the following attributes:
id - a unique integer id.  Should be auto-created on the server, starting at 1, each new note takes the next id value.
titleText - a string.  May not be empty - notes with empty title should be rejected.  Trim leading/trailing whitespace.  Max length 500 characters.
createdDateTime
lastModifiedDateTime - for now I will not yet add note-editing or note-deleting capability, those will come in future.
timestamps should be set by the server.  Dates should be stored in ISO 8601 format, UTC timezone.

The main app screen will show:
A list of all notes in the top 3/4 of the page.  Notes should appear in created-date order with the most recently created at the bottom of the list.  Each row should show the note title.  Rows should be separated by a thin horizontal line.
For now, if the top 3/4 of the page isn't enough space to show all notes, then scroll vertically to see the rest.  Only the top 3/4 of the screen should scroll.
There will be an area to enter a new note in the bottom 1/4 of the page - always visible even if there are more notes than fit.
For now, phone layout is not important, I will make changes later to address that use-case.

Any time a new note is entered, the website will send to the API a json blob containing all attributes of the new note.  The API will save a JSON blob to the local disk containing the current state of all notes - previously-added notes and also this new one.  Each save-file should include the timestamp in its filename.  Any and all note files created in the last week should be kept; files older than 1 week apart from the most-recent save-file should be deleted automatically.

Any errors on saving the note should be displayed under the new note title, leaving the typed title available so that retry is possible.

When the website is opened for the first time or refreshed, the site should make a call to the API to retrieve the most recently saved json blob containing all the note data.

I will add a mechanism for backing up the note data later.

Whilst the page is loading, show text "Loading...".  If there is an error on startup (e.g. the API is unavailable) then show a page with all the details of the error.

## Agreed technical decisions

### Code and tooling
- One repository with npm workspaces: `client/` (React + TypeScript, built with Vite), `server/` (Express + TypeScript) and `shared/` (TypeScript types used by both, e.g. `Note`).
- Node.js 24 (LTS). No automated tests for now.

### API
- `GET /api/notes` - returns all notes (the most recent save-file's contents).
- `POST /api/notes` - body `{ "titleText": "..." }`. The server assigns the id and timestamps, saves a new save-file and returns the created note.
- `POST /api/login` - body `{ "password": "..." }`. On success sets the session cookie.
- `POST /api/logout` - clears the session cookie.
- All `/api/notes` calls require a valid session; otherwise they return HTTP 401 and the website shows the login page.

### Login
- A login page with a single password field. On success the server sets a secure, HttpOnly session cookie that lasts 30 days. A "Log out" link is shown on the main screen.
- The 32-character password is generated once on the VM. Only a hash of it is stored, in `/etc/nwsnotes/config.json` on the VM, never in GitHub.
- The login endpoint is rate limited.

### New-note area
- A single-line text box and an "Add" button. Pressing Enter also adds the note.
- After a successful save the text box clears and keeps focus, and the list scrolls to the bottom so the new note is visible.
- When the page loads, the list starts scrolled to the bottom.

### Save files
- Folder: `/var/lib/nwsnotes/data` (outside the app's code folder, so deployments never touch it).
- Filename format: `notes-2026-10-24T09-40-12-345Z.json` (UTC timestamp, no colons).
- Files are written to a temporary name and then renamed, so a crash mid-save can't leave a corrupt file.
- Retention cleanup runs after each save and when the server starts.

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
