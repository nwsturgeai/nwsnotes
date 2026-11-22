# Offline use, live updates and app updates

## Offline use
It should be possible to do some note creation and editing whilst offline.
The settings page should not be available whilst offline.
For now, tag reordering is not supported whilst offline.
Bulk tag updates (multi-select) are not supported whilst offline.
Note ordering (edit-order mode) is not supported whilst offline.
If the same note is changed both offline on one device and online elsewhere, the last change to reach the server wins.
Notes created offline keep the date and time they were created offline.

## App updates
When a new version of the app has been deployed, the installed Android app should pick it up reliably.
When a new version has been downloaded, show a notice "A new version is ready" with a "Reload" button. Tapping it switches to the new version. The app should never reload by itself, so nothing being written is lost.
The app should check for a new version once every day.
The settings page should show which version is running, and have a button to check for a new version straight away.

## Agreed technical decisions

### Live updates (WebSocket)
- The website connects to `wss://nwsnotes.com/ws`, on the same port (443) as the site.
- The server only accepts the connection if the session cookie is valid and the request's `Origin` is the site's own address, so other websites can't connect using the cookie.
- Each page load creates a random connection id and sends it with every change it makes (`X-Connection-Id` header). After a change is saved (a note added, a category added or edited, or a tab added, edited or deleted), the server sends `{ "type": "data-changed" }` to every other open connection; they reload the notes, categories and tabs with `GET /api/notes`. The same message will be used later for note editing and deleting.
- If the connection drops, the website reconnects automatically, waiting a little longer after each failed attempt. After any reconnect, and whenever the app comes back on screen, it reloads the notes in case it missed a message.
- These background reloads don't show "Loading...", don't clear a title being typed, and keep the list scrolled to the bottom. If one fails, a small notice is shown instead of the full error page.
- Logging out closes the connection.
- With several users (see [users.md](users.md)), "data changed" messages go only to the same user's other connections, and the offline copy is kept per user.
- The server pings each connection regularly so idle connections aren't silently dropped.

### Android app (PWA)
- A web app manifest with the app name, theme and background colours, `display: standalone`, and PNG icons at 192×192 and 512×512, including a maskable icon.
- A service worker (built with `vite-plugin-pwa`) caches only the website's own files, never `/api` calls. When offline, the app opens from its local copy of the data (see "Offline use"). Only if there's no local copy yet (it has never loaded on this device) does it show the normal startup error page.
- The service worker updates as described in "App updates" below.
- Check on the live site that the security headers (helmet's Content Security Policy) allow the manifest, service worker and WebSocket.

### App updates
- **Why updates were missed:** the app always opens from the copy of its files saved on the tablet. The new version is only downloaded in the background after that, so it showed up one full restart late at best. Force-quitting during the download, or Android keeping the app alive behind the scenes, could hold it back for longer.
- **Waiting for a tap:** `vite-plugin-pwa` switches from `registerType: "autoUpdate"` to `"prompt"`, and the app registers the service worker itself with `registerSW` from `virtual:pwa-register`, instead of the injected script.
  - A downloaded new version waits until "Reload" is tapped. The tap tells it to take over, then reloads the page once it has.
  - If "Reload" is never tapped, the new version still takes over the next time the app is fully closed and opened again, as before.
  - The first time this version reaches a device, the version running there has no "Reload" notice. So this one update only takes over once the app is fully closed and opened again. Later updates show the notice.
- **The notice:** "A new version is ready" with a "Reload" button, in the same style as the app's other notices. It stays until it's tapped and doesn't fade.
  - It shows on the notes page and the settings pages.
  - It's hidden while a note is being edited, a long-form note is open, or a title is being typed in the new-note area, so tapping it can't lose unsaved work. It appears again once that's finished.
  - Changes waiting in the offline outbox are kept in IndexedDB, so they survive the reload and are sent afterwards.
- **Daily check:** the app keeps the time of its last check in local storage (`nwsnotes.lastUpdateCheck`). When the app starts, when it comes back on screen, and every hour while it's open, it checks for a new version if the last check was 24 hours or more ago.
  - A check asks the server for the service worker file (`/sw.js`), which is small. If it has changed, the new version downloads in the background and the notice appears once it's ready.
  - Android's browser also makes this check by itself each time the app starts. That can't be turned off, and it costs very little.
  - While offline, no check is made, and the last-check time isn't updated, so it's tried again once the app is back online.
- **Settings page:** a new "App version" section, placed just before Account.
  - It shows "Version:" followed by the build's date and time in the tablet's local time, e.g. "30 Oct 2026, 14:05". The build time is set by Vite's `define` (`__BUILD_TIME__`) at build time.
  - It has a "Check for updates" button. While checking, the button shows "Checking…". Afterwards a line under it says one of:
    - "You have the latest version."
    - "A new version is ready", with its own "Reload" button;
    - "Couldn't check for updates: <error>".
  - A manual check also counts as the day's check.
  - In development there's no service worker, so the button is disabled with the text "Updates aren't available in development."

### Offline use
- **Local copy of the data:** after every successful load or background reload, the app saves the whole data (notes, categories, tabs) into the browser's IndexedDB on that device.
  - If the app starts and the server can't be reached, it opens from this copy instead of showing the startup error page. That works from cold, e.g. after the tablet restarts with no signal, because the service worker already serves the app's own files offline.
  - IndexedDB is used rather than local storage, because handwritten notes are images and local storage is small (about 5 MB).
- **Outbox:** every change made offline goes into an outbox, also in IndexedDB. It survives reloads and restarts, and is applied to the local copy straight away, so the list behaves as it does online. Each entry is one API call to make later:
  - adding a note: typed, handwritten or long-form, child notes included;
  - editing a note, including long-form autosaves. Pending edits of the same note collapse into the latest one, so 30-second autosaves don't pile up;
  - waiting, archive, reinstate and bin;
  - cancelling a new long-form note, which deletes it. If that note was itself created offline, its add and delete cancel each other out in the outbox.
- **Temporary ids:** the server hands out note ids, so a note created offline gets a temporary negative id (-1001, -1002, …) until it's sent.
  - Real note ids are always positive. Lifetime's negative ids are tag ids, which are a separate set, so there's no clash.
  - When the add is sent, the server's real id replaces the temporary one everywhere: in the local copy, and in later outbox entries. That includes a child note's `parentId` pointing at a long-form note created offline.
- **No duplicate notes:** every add (online or offline) sends a random `clientId`.
  - The server keeps each note's `clientId`. If an add arrives with a `clientId` it already has, it returns that note instead of creating a second one. This covers a connection that drops after the server saved the note but before the reply arrived.
  - `clientId` is optional, so older pages still work.
- **Creation times:** an add made offline sends its `createdDateTime`. The server uses it if it's a valid time and not in the future; otherwise it uses its own clock. Online adds don't send it.
- **Detecting offline:** the browser's own online/offline flag isn't trusted.
  - Any change request that fails without reaching the server (a network error, or no reply within 10 seconds) puts the app offline, and that change goes into the outbox.
  - So does a 502, 503 or 504: that's the proxy in front of the server saying the server itself is down. In development the Vite proxy answers 502 too when the API server isn't running, so offline use can be tried by stopping it.
  - A failed background reload also puts it offline. Any other reply from the server, even an error, means it's online.
  - While offline, the app checks the server about every 15 seconds with `GET /api/notes/ping` (which needs the session and returns `{ ok: true }`, so it doesn't download every note). It also checks when the browser reports being back online, when the app comes back on screen, and when the live-update connection reconnects.
- **Syncing:** once the server answers again, the outbox is sent in order, one entry at a time, and then the whole data is reloaded.
  - A network or server failure (no reply, or a 5xx error) stops the sync, which is tried again at the next check. Nothing is lost.
  - An entry the server rejects (a 4xx error, e.g. the note was emptied from the Bin on another device meanwhile) is dropped, and a notice names the note whose change was lost.
  - A 401 (session expired) keeps the whole outbox and shows the login page. The outbox is sent once the user has logged in again.
  - Only one tab on a device sends the outbox at a time, using a browser lock (`navigator.locks`), so two open tabs don't send the same changes twice.
- **Conflicts:** last save wins, as between two online devices today. An offline edit replaces any edit made elsewhere in the meantime, when it reaches the server.
- **Not available offline:**
  - The settings page, and with it category editing and tag reordering. The cog is greyed out with the hint "Not available offline". If the connection drops while the settings page is open, it's replaced by a short message saying settings need a connection, with a "← Notes" link.
  - Bulk tag updates: the list-check button is greyed out, with the same hint. If multi-select is already on when the connection drops, Accept is greyed out until it's back.
  - Note ordering: the Edit order button is greyed out, with the same hint. If edit-order mode is on when the connection drops, it turns off.
  - The "New" pill's "reset the New tags" pop-up, and the long-form editor's Cancel for a note created online (deleting needs the server). Cancel still works for a long-form note created offline.
- **Showing the state:**
  - While offline, a small red cloud-with-a-slash icon sits just left of the stylus icon in the header, at the same 24px size. `fa-cloud-slash` itself is only in Font Awesome Pro, so it's `fa-cloud` with `fa-slash` drawn over it. Hovering shows "Offline" plus the number of changes waiting, e.g. "Offline: 3 changes waiting".
  - A note with changes still waiting to be sent shows a small `fa-clock` icon beside its creation date, until it's synced.
  - After a sync, a short notice says how many changes were saved ("3 offline changes saved").
- **Live updates:** while offline, the WebSocket keeps trying to reconnect as now. Messages that arrive mid-sync are ignored, as the sync ends with a full reload anyway.
