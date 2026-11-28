# Google Calendar integration (proposal, not built)

Notes from a discussion, kept for when this is picked up. Nothing here is agreed or built yet.

## Requirements (as asked)

- Two-way sync with Google Calendar.
- A note with a due date appears in the calendar at that time.
- An item created in the calendar appears in the app as a note with that due date.

## How it would work

- **App → Calendar:** when a note is saved on the server, the server creates, updates or deletes the matching event through the Google Calendar API. Delay: 1–3 seconds after the save reaches the server; Google's own apps then show it on refresh or their next sync (usually seconds to a minute on Android). Offline edits sync once they reach the server.
- **Calendar → App:** Google's push notifications (`events.watch`) ping a webhook on nwsnotes.com, then the server fetches what changed (incremental sync with a sync token). Delay: usually a few seconds, occasionally up to about a minute. Google doesn't guarantee delivery, so a check every 5 minutes as a backstop (worst case about 5 minutes). Watch channels expire and must be renewed. Open devices get the new note straight away through the existing live updates.
- **Loop prevention:** each event stores its note's id (in the event's private extended properties), so the server can tell its own edits from the user's.

## Setup

### On Google's side (once, by the admin), at console.cloud.google.com, free
Nothing is built or installed on Google's side; it's a registration that gives the server credentials.
1. Create a project (e.g. "nwsnotes").
2. Turn on the Google Calendar API.
3. Fill in the OAuth consent screen: app name, support email, the domain nwsnotes.com, the calendar scope. Leaving out a logo avoids an extra brand check.
4. Create an OAuth client with the redirect address (e.g. `https://nwsnotes.com/api/google/callback`, plus a localhost one for development). Google gives a client ID and secret, which go in `config.json` via a `set-google.sh` script, like `set-sms.sh`.

### Publishing status
- **Testing:** only listed test accounts (up to 100) can connect, and their connections **expire after 7 days**, so it's unusable long-term.
- **In production, unverified:** any Google account can connect, connections last until revoked (or about 6 months unused). Users see "Google hasn't verified this app" and tap Advanced → Go to nwsnotes. Cap of 100 users in total. Work/school accounts may have unverified apps blocked by their organisation; personal Gmail is fine.
- **Neither is a public listing.** Nobody can find the app through Google. (The Workspace Marketplace is a separate, optional listing, not needed.)
- **Verification (optional):** removes the warning and the cap. Google checks domain ownership (Search Console), a home page and a privacy policy, and, because calendar is a "sensitive" scope, a short screen recording of its use. Days to weeks. Probably not worth it for a handful of users.

### Per user (once, about 30 seconds)
- Settings → "Connect Google Calendar" → Google's consent page → Allow → back to nwsnotes. The server stores a refresh token for that user. Disconnect from Settings, or from the Google account's third-party connections page.

## Decisions still to make

- **Which calendar:** recommended a dedicated "nwsnotes" calendar the app creates in each user's account, so ordinary meetings and birthdays don't become notes.
- **Event length:** notes have no duration; e.g. 15-minute events.
- **All-day events:** due at 20:00 (as for a text with no time)?
- **Recurring events:** skip, or only the next occurrence?
- **Deleting:** deleting an event bins the note, or only clears its due date? Clearing the due date, archiving or binning a note removes the event?
- **Titles:** renames go both ways. Handwritten notes have no text title, so the event says e.g. "nwsnotes note".
- **Shared notes:** whose calendar a shared note goes in (owner's, or `createdByUserId`'s).
- **Duplicate alerts:** turn off the calendar's own alerts on these events, since the app's reminders already go out.
- **Long-form notes**, if they gain due dates.
- **Tests:** a fake Google Calendar server for the e2e tests.

## Size

A medium feature, somewhat bigger than the text-message integration: OAuth linking, token refresh, the sync both ways, the webhook and its renewal, the Settings section, and tests.
