# Google Calendar

## Requirements

- Two-way sync between each user's notes and their Google Calendar.
- A note with a due date appears in the calendar at that time.
- An event created in the calendar appears in nwsnotes as a note with the expected due date.
- Tags can be set from Google, with hashtags.

## Agreed technical decisions

### Setting up

#### On Google's side (once, by the admin), at console.cloud.google.com, free
Nothing is built or installed on Google's side; it's a registration that gives the server credentials.
1. Create a project (e.g. "nwsnotes").
2. Turn on the Google Calendar API.
3. Fill in the OAuth consent screen: app name, support email, the domain nwsnotes.com, the calendar scope. Leaving out a logo avoids an extra brand check.
4. Create an OAuth client ("Web application") with the redirect address `https://nwsnotes.com/api/google/callback`. Google gives a client ID and secret, which `deploy/set-google.sh` stores in `config.json` (`googleClientId`, `googleClientSecret`, with `publicUrl`), like `set-sms.sh`. Development and the tests need none of this: they use a fake Google (see "Technical decisions" below).

#### Publishing status
- **Testing:** only listed test accounts (up to 100) can connect, and their connections **expire after 7 days**, so it's unusable long-term.
- **In production, unverified (the plan):** any Google account can connect, and connections last until revoked (or about 6 months unused). Users see "Google hasn't verified this app" and tap Advanced → Go to nwsnotes. Cap of 100 users in total. Work or school accounts may have unverified apps blocked by their organisation; personal Gmail is fine.
- **Neither is a public listing.** Nobody can find the app through Google. (The Workspace Marketplace is a separate, optional listing, not needed.)
- **Verification (optional, not planned):** removes the warning and the cap. Google checks domain ownership (Search Console), a home page and a privacy policy, and, because calendar is a "sensitive" scope, a short screen recording of its use. Days to weeks.

#### Connecting (each user, once)
- **Who:** every user can link their own Google account.
- **How:** Settings → "Connect Google Calendar" → Google's consent page → Allow → back to nwsnotes. The server stores a refresh token for that user.
- **The calendar:** on connecting, nwsnotes creates a calendar called "nwsnotes" in the user's Google account. Only that calendar is synced, so ordinary meetings and birthdays in their other calendars never become notes.
- **Existing notes:** on connecting, each synced note (see below) due in the future gets an event. Notes already past due don't, so the calendar isn't flooded with old items.
- **Disconnecting:** from Settings, or from the Google account's third-party connections page. The "nwsnotes" calendar is left in Google; the user can delete it there.

### Which notes are synced
- **A user's own notes** with a due date, regular and long-form, that are New, Active or Waiting.
- **Shared notes** are synced only with their owner's calendar, never with the calendars of people a tag is shared with.
- **Archiving or binning a note** deletes its event. Reinstating it (or restoring it from the Bin) puts the event back.
- **Clearing a note's due date** deletes its event; the note stays as it is.
- **Notes from recurring events** (see below) stay linked to their series and never get an event of their own.

### Constants
Kept as named constants in one place, as they may later become per-user settings (not now):
- `DEFAULT_EVENT_MINUTES = 15`: the length of an event made by nwsnotes.
- `ALL_DAY_DUE_TIME = "20:00"`: when a note from an all-day event is due. It's the same 20:00 the due-date dialog and "Due" texts default to.

### From nwsnotes to Google
- **The event's time:** it starts at the note's due date and lasts `DEFAULT_EVENT_MINUTES`.
- **Changing the due date** moves the event and keeps its current length, so an event stretched to an hour in Google stays an hour.
- **All-day notes** (from an all-day event, see below) have an all-day event, which stays all-day as long as the note's due time is 20:00. Changing only the date moves it to the new date, still all-day. Changing the time to anything other than 20:00 makes it a timed event of `DEFAULT_EVENT_MINUTES` at that time, and the note stops being all-day.
- **The title:** the note's title, as it is (formatting markers included, so editing it in Google can't lose them). Handwritten titles appear as "Handwritten note".
- **The description:**
  - **Line 1 is the tags line:** the note's tags as hashtags (see "Tags" below), then a blank line, then the body. With no tags there's no tags line.
  - **A regular note** has no body, so its description is only the tags line (or empty).
  - **A long-form note with typed details:** the body is the details, as they are (formatting markers included).
  - **A long-form note with handwritten details:** the body is "Handwritten description available in nwsnotes".
  - If a note has no tags and its typed details start with a line made only of hashtags, nwsnotes puts a blank line first, so the details aren't read back as tags.
- **Alerts:** each event nwsnotes makes has one pop-up alert at its start time (all-day events: at 09:00 on the day), instead of nwsnotes' own reminder (see "Reminders" below). Events added in Google keep the alerts they were given there.
- **How fast:** 1–3 seconds after the change reaches the server. Google's own apps then show it on refresh or at their next sync (usually seconds to a minute on Android). A change made offline syncs once it reaches the server.

### From Google to nwsnotes
- **An event added** to the "nwsnotes" calendar becomes a New note in the user's own notebook, due at the event's start.
  - **Its tags** come from its hashtags (see "Tags" below). With none, it has no tags, so it shows in All.
  - **An event with no title** becomes a note titled "(No title)".
  - **A description** (beyond the tags line) makes it a long-form note with typed details.
- **All-day events:** due at `ALL_DAY_DUE_TIME` on that day, and the note is flagged as all-day (see "From nwsnotes to Google").
- **Events longer than a day:** due at the start of the first day. A timed one (e.g. Monday 3pm to Wednesday 10am) is due at its start time, Monday 15:00. An all-day one is due at 20:00 on its first day, flagged as all-day.
- **Recurring events:** a series becomes one note with no due date. It stays linked to the series: changes to the series' title, description and hashtags are synced, and deleting the series moves the note to the Bin. Giving that note a due date in nwsnotes doesn't create an event: it stays unsynced.
- **Moving an event** changes the note's due date. Changing its length changes nothing in nwsnotes.
- **Renaming an event** renames the note, except a handwritten note's event, whose title edits are ignored (apart from hashtags, which still change the tags).
- **Editing the description:**
  - **Formatting is ignored:** Google stores descriptions edited on the web as HTML, so nwsnotes takes the plain text (with line breaks) before reading it.
  - **A typed long-form note:** the body replaces the details.
  - **A regular note given a body:** it becomes a long-form note with typed details. Only text beyond the tags line counts; adding hashtags just changes the tags.
  - **A handwritten regular note:** a body is ignored (long-form notes need a typed title). The tags line still applies.
  - **A handwritten long-form note:** edits to the body are ignored. The tags line still applies.
  - **The body removed:** a long-form note stays long-form, keeping its details (for now).
- **Deleting an event** moves its note to the Bin.
- **Too long:** a title longer than nwsnotes allows, or a body over 10,000 characters, is cut short.
- **A full notebook:** an event that would go over the user's note limit isn't added, and the user gets a notification saying so.
- **History:** each change from Google is in the History, e.g. `Renamed "X" from Google Calendar`, and can be reverted like any other.
- **Live updates:** open devices show the change straight away.
- **How fast:** Google's push notifications (`events.watch`) ping a webhook on nwsnotes.com, then the server fetches what changed (incremental sync with a sync token). Usually a few seconds, occasionally up to about a minute. Google doesn't guarantee delivery, so the server also checks every 5 minutes (worst case about 5 minutes). Watch channels expire and are renewed.

### Tags (hashtags)
- **Written by nwsnotes** only on the description's tags line: `#Shopping #Home`. Spaces in a tag's name become underscores: "Garden ideas" is `#Garden_ideas`.
- **Read from** the description's first line, if every word on it is a hashtag. A first line like "#Shopping list for Saturday" is ordinary text.
- **Also read from the event's title,** when an event is added or edited in Google. nwsnotes moves them to the tags line and takes them out of the title, so a quick "Oat milk #Shopping" becomes the title "Oat milk", with `#Shopping` in the description.
- **Matching:**
  - A hashtag is `#` followed by a tag's name, ignoring case, with underscores matching spaces. A comma or full stop straight after it is ignored.
  - It counts only when followed by a space or the end, so a highlight like `#urgent# today` is still a highlight.
  - **Tags with the same name** in different categories: the first (in category order, then tag order) is used.
  - **Two tags of a single-select category:** the first one wins.
- **Removing a hashtag** in Google removes that tag from the note.
- **Hashtags that match no tag** (e.g. a typo, `#Shoping`) are left on the tags line as typed, ignored, until the user fixes or removes them. In the title they stay as ordinary text. No new tags are created.
- **Not settable from Google:** Lifetime tags (New, Active, Waiting and so on) are never written as hashtags. Tags shared with the user are never written or read either, since putting one on a note would move it into the other person's notebook.
- **Round trips:** nwsnotes remembers the tags line it last wrote to each event, and acts only on hashtags the user adds or removes in Google. So a note with the second of two tags with the same name keeps it, even though its hashtag reads as the first.
- **Renaming or deleting a tag** in nwsnotes updates the description of every event carrying it. With many notes, this can take a short while.

### In the notes list
- An all-day note shows "Due 12/11 all day" instead of "Due 12/11 20:00".

### Reminders
- **Not connected:** users keep nwsnotes' own reminders (see [due-dates.md](due-dates.md)).
- **Connected:** a note that has an event gets Google's alert, not nwsnotes' reminder. A note with a due date but no event (e.g. one linked to a recurring series, or one already past due when the user connected) still gets nwsnotes' reminder.

### Loop prevention
- Each event stores its note's id in the event's private extended properties, so the server can tell its own edits from the user's.

### Settings
- **A "Google Calendar" section,** after Text messages, shown when the server has Google set up (`GET /api/google` answers; 404 otherwise).
  - **Not connected:** "Show your notes with a due date in Google Calendar, and add notes from it. nwsnotes makes a calendar called "nwsnotes" in your Google account.", and a "Connect Google Calendar" button.
  - **Connected:** says where the notes are and how to tag events with hashtags, and has a "Disconnect" button, which asks first ("Disconnect Google Calendar? The nwsnotes calendar stays in your Google account, but stops being updated.").
  - **A problem** (see "Technical decisions") shows in red, with a "Connect again" button.
  - **Back from Google's sign-in,** a line says how it went: "Google Calendar is connected.", "Google Calendar wasn't connected, as access wasn't allowed." or "Google Calendar couldn't be connected. Please try again." The `?google=` it came back with is then taken out of the address.

## Technical decisions

- **Where:** `server/src/google.ts` (the sync and its routes), `shared/src/calendarText.ts` (hashtags, descriptions and the constants, unit tested in `calendar-text.spec.ts`), and `server/src/fakeGoogle.ts` (the fake Google).
- **Google's permission:** the scope `https://www.googleapis.com/auth/calendar.app.created`, which only covers calendars nwsnotes makes itself, and their events. Asked for with `access_type=offline` and `prompt=consent`, so every sign-in gives a refresh token.
- **Time zone:** the calendar and its events are in UK time (Europe/London), as dictated due dates are. All-day dates, 20:00 and 09:00 are UK times.
- **API:**
  - `GET /api/google` (logged in): `{ connected, problem? }`.
  - `GET /api/google/connect` (logged in): goes on to Google's sign-in, with a random `state` (single-use, for 15 minutes) saying whose it is.
  - `GET /api/google/callback`: where Google sends the browser back. The session cookie isn't sent on this visit from another site (it's `SameSite=Strict`), so the state says whose sign-in it is. Then on to `/settings?google=connected` (or `declined`, `failed`).
  - `POST /api/google/disconnect` (logged in): stops the webhook, revokes the token (best effort) and forgets the connection and the events' records.
  - `POST /api/google/webhook`: Google's change notifications, checked against the channel's id and secret token. Answered straight away; the sync runs after.
- **Stored:** `nwsnotes.google_accounts` (per user: the refresh token, the calendar's id, the sync token, the webhook channel, notes skipped on connecting, and any problem) and `nwsnotes.google_events` (per synced note: its event's id and etag, title, description, start and end as last written or read, and the hashtags on its tags line). Neither is in the History or the backups. Access tokens are only kept in memory.
- **The sync:** each user's runs one at a time, 200 ms after it's asked for (so changes close together go together): after every save of their notebook, on a webhook, every 5 minutes, and on start-up.
  1. **From Google:** the calendar's changes since the sync token (`events.list` with `showDeleted`), or everything if the token has expired (410). An event whose etag is the one last written is nwsnotes' own change coming back, and skipped. For any other, each part is compared with the record: only parts changed in Google change the note (`NoteStore.calendarUpdate`, in the History "from Google Calendar"). The user's open pages are told to reload.
  2. **To Google:** each note's wanted event is compared with its record, and only the parts that differ are sent (`PATCH`). Descriptions are compared as plain text, so one edited on Google's website (HTML) isn't rewritten until its text really changes. Notes that stop being synced, or are deleted, have their events deleted.
- **All-day notes:** `allDay: true` on the note, set from an all-day event. The store keeps it only while the note is due at 20:00 (any change of due date checks), so changing the time makes the event timed.
- **Hashtags in the title** are written to the tags line spelt as the tag's name (`#Home`); hashtags typed on the tags line itself are kept as typed.
- **Events carry their note's id** (in the private extended property `nwsnotesNoteId`), added to events made in Google at the next write, so an event can be linked again if its record were lost.
- **Recurring series:** the note's title and description follow both ways; deleting the series bins the note; binning the note leaves the series alone. Single occurrences changed on their own in Google are ignored.
- **Problems that stop the sync** until the user connects again: Google refusing the refresh token (access removed: "Google no longer lets nwsnotes use your calendar. Connect again to carry on.") and the calendar being gone ("The nwsnotes calendar was deleted in Google. Connect again to make a new one."). Connecting again keeps the same calendar if it's still there. Other errors (Google or the database unreachable) are logged as warnings and tried again at the next sync.
- **The 09:00 alert on all-day events** is a reminder of -540 minutes (an all-day event starts at midnight). Google's documentation doesn't say whether it accepts this: if it refuses, the event is sent again with the calendar's own alerts, and all-day events use those from then on (a warning is logged).
- **Webhooks:** a channel per user, for a week, renewed when it has less than a day left (checked hourly). Without one, the 5-minute check still syncs.
- **Disabled users** aren't synced.
- **The fake Google** (development and the tests, never in production): `config.google` points at `/api/test/google/...` on the server itself, which keeps calendars and events in memory, gives out sync tokens and etags, and calls the webhook on every change, as Google does. The tests' controls (`/api/test/google/control/...`) add, change and delete events as a person would, delete a calendar, remove access, and set the next sign-in to be declined or negative reminder minutes to be refused. `POST /api/test/google-sync` syncs the logged-in user and waits; `POST /api/test/check-reminders` runs the reminder check now.
