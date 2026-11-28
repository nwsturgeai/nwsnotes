# Google Calendar (agreed, not built yet)

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
4. Create an OAuth client with the redirect address (e.g. `https://nwsnotes.com/api/google/callback`, plus a localhost one for development). Google gives a client ID and secret, which go in `config.json` via a `deploy/set-google.sh` script, like `set-sms.sh`.

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
- **Alerts:** each event has one pop-up alert at its start time, instead of nwsnotes' own reminder (see "Reminders" below).
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

## Still to decide

- **All-day events' alert time:** Google can only alert on an all-day event at a time of day, on the day or before. Which time?

## Size

A medium feature, somewhat bigger than the text-message integration: OAuth linking, token refresh, the sync both ways, hashtags, the webhook and its renewal, the Settings section, and tests (with a fake Google Calendar server for the e2e tests).
