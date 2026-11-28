# Overview

## Introduction and high-level

I want to create an app for managing my notes.
This app will be delivered as a website.
I have created a VM in DigitalOcean to host the server side of my website.
The VM should serve the static content of my website and also include a rest API which the website can call.
The server side API will be coded in typescript and will execute using nodejs.
The browser code should be written in typescript and should use React.
This site will be for a single user (me).  I should need a password to log in, this should be a string of 32 random characters.
The site should be delivered over HTTPS - I have the domain "nwsnotes.com", which has a DNS entry pointing to my VM (it used to be "nwsnotes.duckdns.org", which still points there too).
Use fontawesome icons.
The app should always be rendered with black/dark text on white/light backgrounds.  In other words, ignore if the device is set to "dark mode".

The website should have the necessary attributes to be useable as an Android Progressive Web App.

## Settings and lifecycle

There will be a header strip across the top of the app.  The app will have a settings page, accessible by clicking a cog icon located on the right-hand edge of the top header strip.
The settings page will contain the option to log out (that won't be shown on the main notes page).
The settings page will contain an option to download the latest json file from the server containing all the notes data.  I will use this to manually take backups every few days.
The header strip should have the same background colour as the "New note" area at the bottom of the page.
There should be no app title shown at the left of the header - this area will be used for a different feature coming soon.

Any time a new note is entered, the website will send to the API a json blob containing all attributes of the new note.  The API will save a JSON blob to the local disk containing the current state of all notes - previously-added notes and also this new one.  Each save-file should include the timestamp in its filename.  Any and all note files created in the last week should be kept; files older than 1 week apart from the most-recent save-file should be deleted automatically.

Any errors on saving the note should be displayed under the new note title, leaving the typed title available so that retry is possible.

When the website is opened for the first time or refreshed, the site should make a call to the API to retrieve the most recently saved json blob containing all the note data.

The website should open a websocket connection to the server.  Whenever any data is changed by a particular website connection, the server should use the websocket to notify any other website connections to refresh their data. 

Whilst the page is loading, show text "Loading...".  If there is an error on startup (e.g. the API is unavailable) then show a page with all the details of the error.

## Agreed technical decisions

### Code and tooling
- One repository with npm workspaces: `client/` (React + TypeScript, built with Vite), `server/` (Express + TypeScript) and `shared/` (TypeScript types used by both, e.g. `Note`).
- Node.js 24 (LTS). End-to-end tests with Playwright (see [testing.md](testing.md)).
- Icons: Font Awesome Free (solid icons), installed from npm (`@fortawesome/fontawesome-svg-core`, `@fortawesome/free-solid-svg-icons`, `@fortawesome/react-fontawesome`) and bundled into the app, not loaded from a CDN, so the security headers and offline start-up keep working. All the app's icons use it, including the settings cog (`fa-gear`).

### Login
- **Superseded by [users.md](users.md)** once several users are added: a login name as well as a password, and one admin who creates the accounts. What follows describes the single-user app.
- A login page with a single password field. On success the server sets a secure, HttpOnly session cookie that lasts 30 days.
- "Log out" is on the settings page only, not on the main notes screen.
- The 32-character password is generated once on the VM. Only a hash of it is stored, in `/etc/nwsnotes/config.json` on the VM, never in GitHub.
- The login endpoint is rate limited.

### Appearance
- Always light: dark text on light backgrounds, whatever the device's dark-mode setting (`color-scheme: light`, no dark-mode colours).
- **Font:** Atkinson Hyperlegible Next everywhere, shipped with the app from `@fontsource-variable/atkinson-hyperlegible-next` (every weight in one file, upright only, Latin and Latin Extended). It's cached by the service worker like the app's other files, so it works offline. The device's own font is the fallback while it loads.
  - The italic version isn't included, so wherever italic is used the browser slants the upright letters. Their widths stay the same, which the long-form formatting relies on (see [formatting.md](formatting.md)).
- **Width:** the app is at most 1280px wide. On a wider window it's centred, with the extra space split equally either side; the side areas are a slightly darker shade, with a thin line at the app's edges. The app itself keeps its usual background, so pages like Settings look the same as on a narrower window. The long-form editor stays within the same 1280px column.

### Header and settings page
- The header strip has a fixed height and the same background colour as the new-note area. Below it, the note list fills the page above the fixed 150px new-note area.
- No app title is shown at the left of the header; on the notes page that space holds the tabs. The "← Notes" and "← Settings" links on the settings pages stay, and the browser tab is still titled "nwsnotes".
- The cog icon at the right of the header opens the settings page at its own address, `/settings`, so the browser's and Android's back button returns to the notes. The header on the settings page has a "← Notes" link.
- The settings page has, in order: Help (straight under the "Settings" title), the note counts, Stylus mode, Columns and Tab counts (side by side, wrapping as needed), Pen (only while stylus mode is on), History, Backup ("Download backup"), Lifetime, Categories, Tabs, App version (see "App updates" in [offline-and-updates.md](offline-and-updates.md)), Reminders, Text messages, Alexa (see [alexa.md](alexa.md)), Google Calendar (see [google-calendar.md](google-calendar.md)), Users (admins only) and Account ("Log out"). "Download backup" is a plain link to `GET /api/notes/download`; the session cookie is sent with it automatically.
- **Coming back from a category or a tab:** after saving or cancelling (or deleting) on a category's or a tab's page, the settings page opens scrolled to the Categories or Tabs section, with its heading at the top. Opened any other way, it starts at the top.
