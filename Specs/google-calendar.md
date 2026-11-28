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

## Agreed so far

- **Event length:** a default duration, `DEFAULT_EVENT_MINUTES = 15`, kept as one constant. It may later become a per-user setting (not now).
- **All-day events (from Google):** the note is due at `ALL_DAY_DUE_TIME = 20:00` on that day, kept as one constant. It may later become per-user (not now). The note is flagged as all-day, so its event always stays all-day in Google even though nwsnotes shows 20:00.
- **Events longer than a day (from Google):** the note is due on the first day of the range.
- **Recurring events (from Google):** they become notes, with no due date.
- **Deleting an event** in Google moves its note to the Bin.
- **Titles:** renaming works both ways. A handwritten note's event is titled "Handwritten note", and renaming that event in Google is ignored.
- **Shared notes:** a note is synced only with its owner's calendar.
- **Alerts:** the alert comes from Google Calendar, not from nwsnotes' own reminder.
- **Descriptions:**
  - A regular note's event has a title and no description.
  - A long-form note with typed details: the details are the event's description.
  - A long-form note with handwritten details: the description is "Handwritten description available in nwsnotes", and editing it in Google is ignored.
  - A regular note given a description in Google becomes a long-form note with those details.
  - Formatting in a Google description is ignored: the note gets the plain text.
  - A description removed in Google leaves the note long-form (for now).

## Recommendations not yet confirmed

- **Which calendar:** a dedicated "nwsnotes" calendar the app creates in each user's account, so ordinary meetings and birthdays don't become notes.
- **Which notes sync:** every note of the user's own with a due date, regular and long-form, that's New, Active or Waiting.
- **Tags on new notes from Google:** none, so they show in All, like a "New" text.
- **Who connects:** every user can link their own Google account in Settings; the admin sets up the Google project once.

## Size

A medium feature, somewhat bigger than the text-message integration: OAuth linking, token refresh, the sync both ways, the webhook and its renewal, the Settings section, and tests.
