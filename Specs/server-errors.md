# Server errors

An admin can see, from within the app, whether anything has gone wrong on the server lately, and the details, without logging in to the VM.

## Requirements
- **In Settings,** admins have a "Server errors" section, just below Users. It says whether there have been any errors or warnings on the server in the last 30 days ("No errors or warnings on the server in the last 30 days." or "<n> errors and <n> warnings on the server in the last 30 days. The latest was at <time>."), and has a "View server errors" link.
- **The Server errors page** (`/settings/server-errors`, admins only) lists them, the most recently seen first. Each shows:
  - "Error" or "Warning", and when it was last seen;
  - when the same one happened more than once: "<n> times, first at <time>";
  - its message (its first line);
  - when it happened while answering a request: "While answering PUT /api/notes/12 for user 3" (the address without anything after a `?`);
  - when there's more than the message (such as a stack trace): a "Details" toggle showing all of it.
- **Buttons:** Refresh, "Clear all" (after a confirmation; it doesn't touch pm2's own log on the VM), and Done (back to Settings).
- **Non-admins** see no section, and the API refuses them (403).

## Agreed technical decisions
- **What's recorded:** everything the server writes with `console.error` or `console.warn` (as well as writing it to the console, so pm2's log is unchanged), and an uncaught error that stops the server. Requests the server refuses (a 4xx, such as a wrong password or a missing note) are the user's mistake, not the server's, so they're printed but not recorded; failures (500 and above, including the database being unreachable) are.
- **Repeats:** the same level, message and details seen again within an hour of the last time adds to that entry's count (and moves it to the top) instead of making a new one, so a burst, such as every request during a database outage, is one entry.
- **Limits:** at most the latest 100 entries, and only those seen in the last 30 days. A message is cut to 500 characters and the details to 8,000.
- **Where:** in memory, and in `server-log.json` in the data folder (`/var/lib/nwsnotes/data` on the VM), written a second after a change (and at once if the server is stopping because of an error). Not in the database: the database being unreachable is one of the things worth seeing, and the file survives a restart, including the crash that caused it. Only the running server records; the command-line `--restore` and `--reset-password` don't.
- **API:** `GET /api/server-log` returns `ServerLogEntry[]` (`id`, `level` "error" | "warning", `message`, optional `details`, optional `request` and `userId`, `firstDateTime`, `lastDateTime`, `count`), the most recently seen first. `DELETE /api/server-log` clears them. Both admins only.
- **Tests** (`server-log.spec.ts`): the Settings summary with none and with some; the page's entries, newest first, with a counted repeat, a failed request's address and details, a warning; Refresh; Clear all with its confirmation; refused requests not listed; non-admins seeing no section and refused by the API. A test-only `POST /api/test/server-log` (`{ level?, message, fail? }`) writes an error or warning, or fails the request; the tests' reset clears the list.
