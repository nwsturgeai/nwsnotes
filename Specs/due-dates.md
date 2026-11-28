# Due dates and reminders

## Due date

In the notes list, underneath each note's three right-hand buttons, the creation date-time should be displayed in small grey text, preceded by the text-label "Cr. ".

When editing a regular note with the create/edit note section expanded:
There should be an additional "due date" icon button underneath the other buttons to the right, icon fa-alarm-clock, in its outline style (Font Awesome "regular").
Clicking this button should bring up a modal dialog where a date and time can be picked.
If this note doesn't already have a dueDateTime set, then default to time 8pm and date today (if local time is before 8pm) otherwise tomorrow's date.
If this note does already have a dueDateTime set, then the date and time pickers should show the selected value.
The dialog should have buttons "Cancel" and "Set Due Date".  If this note already has a dueDateTime set, then there should be a third button "Clear Due Date".
Any Due Date populated on a note should be saved to the server whenever the note is saved (i.e. on creation or save-after-edit).

In the notes-list view, if a note has a due-date, then that date and time should be displayed under the three right-hand buttons (instead of the creation date).
In this case, the label prefix should be "Due " (instead of "Cr. ").
If the due-date-time is in the future, then show the date and time and label in black (the text colour) instead of dark grey.
If the due-date-time is less than a week away from the current local time, then show the date and time and label in bold text.
If the due-date-time is in the past, then show the date and time and label in bold red text.

### Reminders

The web-app should support browser notifications.
Permission to send notifications should be requested as soon as the user has logged in.
When a note has a dueDateTime, and that time has just passed, then the server should send a notification to all browsers that have had browser notifications enabled.
The notification text should be:
Due: <note title>
or for notes drawn with the stylus:
A note is due

## Agreed technical decisions

### Due dates
- **Who added it:** every note records `createdByUserId`, the id of the user who added it: the notebook's owner, or someone a tag is shared with who added it in the owner's notebook. Set by the server when the note is added (`POST /api/notes`, or by text message) and kept by every later change. Notes added before it existed have none. It's used by "Due" texts (see "Setting a due date" in [text-messages.md](text-messages.md)).
- **Set by text message:** "Due tomorrow 3pm" sets the due date of the note the person added in the last 5 minutes (see [text-messages.md](text-messages.md)).
- **Stored on the note:** optional `dueDateTime` (ISO 8601, UTC). It's sent in the body of `POST /api/notes` and `PUT /api/notes/:id`. Since a PUT replaces the note, leaving it out clears it.
  - The server checks it's a valid date-time. Regular and long-form notes can both have one.
  - Converting a note to long-form keeps its due date.
  - Lifetime changes and bulk tag updates keep it. It doesn't count as a tag change.
  - It works offline like the rest of the note.
- **The due-date button:** `fa-alarm-clock`, the outline ("regular") version, in the expanded new-note area, below the other buttons. It's there when adding a new regular note and when editing one, child notes included. It isn't shown in multi-select. Long-form notes have their own button in their editor (see "Long-form notes" below).
  - While the note being added or edited has a due date, the button is filled in green, like an active button. Its tooltip then says e.g. "Due 12/11 20:00"; otherwise "Set due date".
- **The dialog:** the app's own pop-up, titled "Due date", with a date box and a time box (the device's own pickers).
  - With no due date yet, it starts at 20:00 today, or tomorrow if it's already 20:00 or later.
  - Below the date and time, a "Remind me?" tickbox: ticked for a new due date, otherwise as the note has it. Unticked, the note has a due date but no reminder (see "No reminder" below).
    - For a note being added, a new due date's tickbox starts as it was last set for a note being added on this device (kept in the browser's storage as `nwsnotes.newNoteRemind`, "off" while unticked). Notes already added, and long-form notes, aren't affected and don't change it.
  - Below it, a "Note returns from 'Waiting' when due?" tickbox: ticked for a new due date, otherwise as the note has it (see "Returning from Waiting" below).
  - Buttons: "Cancel", "Clear Due Date" (only if the note has a due date) and "Set Due Date" (the green main button). Escape counts as Cancel.
- **Saved with the note:** the chosen date is only saved when Add or Update is tapped. Cancelling an edit drops it.
  - Unlike the tags, it doesn't carry over: after a note is added, the next new note starts with no due date.
- **In the list:** a note with a due date shows "Due 12/11 20:00" under its buttons, in place of "Cr. …". Hovering shows "Due" or "Created" with the full date.
  - The year is added when it isn't this year, e.g. "Due 12/01/27 20:00".
  - Still to come: the label and date are in the text colour (black), not the grey of a creation date. Due within the next 7 days: also bold. Already past: bold and red.
  - The list re-checks once a minute, so dates turn bold, then red, without a reload.

### No reminder
- **Stored on the note:** `noReminder: true`, only while it has a due date and "Remind me?" was unticked. Left out, the note has a reminder, so notes from before it existed have one. It's sent with `dueDateTime` in `POST /api/notes` and `PUT /api/notes/:id`; since a PUT replaces the note, leaving it out turns the reminder on, and clearing the due date clears it too. Anything but true or false is refused.
  - Every save sends it with the due date, as it is: editing the note, tapping its date in the list, the long-form editor's saves, and changes made offline.
- **No reminder is sent** for it (see "Sending" below). Turning the reminder back on after the due time has passed doesn't send one late; turning it on before then gives the usual reminder at the due time.
- **In the list:** a crossed-out bell (`fa-bell-slash`, outline) before "Due …", and " (no reminder)" at the end of the date's tooltip. The due-date button's tooltip (e.g. "Due 12/11 20:00 (no reminder)") and the date's accessible label say so too.
- **Shared notes:** only the owner turns it on or off. Someone a tag is shared with who edits the note keeps the owner's choice; sending a different one is refused, as for the due date ("Only <owner> can change the due dates of their notes.").
- **By text message:** "Due <when>" always sets a due date with a reminder (it turns the reminder back on).
- **History:** an edit that only turns the reminder off or on is "Turned off the reminder for "<title>"" (or "Turned on …").
- **Google Calendar:** the note's event has no alert. See [google-calendar.md](google-calendar.md).

### Returning from Waiting
- **Stored on the note:** `returnWhenDue: true`, only while it has a due date and the tickbox was ticked. Like `noReminder`, it's sent with `dueDateTime` in `POST /api/notes` and `PUT /api/notes/:id`, every save sends it as it is, leaving it out of a PUT turns it off, and clearing the due date clears it. Anything but true or false is refused. Notes from before it existed don't have it.
- **What happens:** when the due date is reached, the server (in its minute-by-minute check, for every user) puts the note back to Active if it's Waiting, even with no page open. New, Active, Archived and Bin notes are left as they are. It's in the History ("Buy milk" returned from Waiting, as it was due, or "3 notes returned from Waiting, as they were due" for several at once), the owner's open pages update straight away, and so do those of people the note is shared with.
- **Once per due date:** the note stores `returnedFor`, the due date it was dealt with for, whether it was Waiting then or not (left out of shared notes' views). So:
  - A note made Waiting again after it returned, or made Waiting only after its due date was reached, stays Waiting.
  - A due date that's already past when it's set, or when the tickbox is ticked, counts as dealt with: nothing happens.
  - A new due date re-arms it.
  - Going back in the History doesn't make a note return again for a due date it was already dealt with for.
  - If the server was down when it was due, it happens once it's back, however late.
- **In the list:** a Waiting note with it, whose due date is still to come, has a `fa-rotate-left` icon before "Due …", and " (returns from Waiting)" at the end of the date's tooltip and accessible label. Other notes show nothing for it.
- **It's independent of the reminder:** a note can have either, both or neither.
- **Shared notes:** only the owner turns it on or off, as for the due date.
- **By text message:** "Due <when>" sets a due date without it (turning it off if it was on). Due dates from Google Calendar don't have it, and changes made in Google keep it as it is.

### Long-form notes
- **The button:** in the long-form editor's bottom row, an `fa-alarm-clock` button (outline, 40px like the row's other buttons), just after Export (4px) for handwritten details, or in Export's place for typed ones, then the usual 24px gap before Cancel and Finish. Its accessible label is "Set the long-form note's due date", or "Change the long-form note's due date" while it has one. Like the regular button, it's filled in green while the note has a due date, with the tooltip e.g. "Due 12/11 20:00", otherwise "Set due date". It opens the same "Due date" pop-up.
  - **Greyed out** until the title is first accepted (the note doesn't exist yet), with the tooltip "Accept the title first", and while a save is under way.
  - **Only the owner** sets it: it isn't shown on a note shared with you. Someone a tag is shared with who edits a long-form note keeps the owner's due date; sending a different one, or none, is refused ("Only <owner> can change the due dates of their notes.").
  - In stylus mode, finger taps on it work (it only opens the pop-up).
- **Saved straight away** when "Set Due Date" or "Clear Due Date" is chosen, with any pending details and tag changes, rather than at the end of the 30-second window. Every later save of the note sends it too, since leaving it out would clear it.
- **In the list,** a long-form note's date can be tapped to set it, as for a regular note; the note is saved with its details unchanged.
- **By text message,** "Due <when>" counts a long-form note just added, like any other.
- **Child notes** keep their own due dates; a long-form note doesn't show anything about its children's.

### Reminders (push notifications)
- **Web Push:** reminders reach a device even when the app is closed, using the browser's push service (Google's on Android Chrome). The notification is encrypted, so the push service can't read it. The server uses the `web-push` package.
- **Server keys (VAPID):** generated on the server's first start and kept in `push-keys.json` in the data folder, so there's nothing to set up. The contact address push services ask for is `pushContact` in `config.json`, defaulting to `mailto:nwsnotes@localhost`.
- **Devices:** each device that turns reminders on sends its push subscription to the server. They're kept in `push-subscriptions.json` in the data folder, not in the save-files or backups, as they're specific to each device.
  - A device the push service reports as gone (HTTP 404 or 410) is removed.
  - Logging out turns reminders off for that device first.
- **API**, all behind the login:
  - `GET /api/push/key` returns `{ publicKey }`.
  - `POST /api/push/subscribe` takes the browser's subscription. Sending the same one again just updates it.
  - `POST /api/push/unsubscribe` takes `{ endpoint }`.
  - `POST /api/push/test` sends "Test reminder" to every device, and replies with how many it reached.
- **Asking for permission:**
  - Straight after logging in, if the browser hasn't been asked yet.
  - Once permission is granted, each time the app starts it makes sure this device's subscription is registered with the server.
- **Settings page:** a "Reminders" section, just before Backup. It says whether this device gets reminders, with a "Turn on" or "Turn off" button and a "Send test" button.
  - If the browser has blocked notifications for the site, it says so, and that they must be allowed in the browser's site settings.
  - In development there's no service worker, so it says "Reminders aren't available in development." The server side still works there.
- **Sending:** the server checks every minute.
  - A reminder goes out for each New, Active or Waiting note whose due date has passed. Archived and Bin notes get none, nor do notes with "Remind me?" unticked.
  - A note with its own event in Google Calendar gets Google's alert instead, and no reminder from nwsnotes (it's still recorded as reminded). See [google-calendar.md](google-calendar.md).
  - Each note gets one reminder per due date. The note stores `reminderSentFor`, the due date its reminder was sent for, in the save-files.
  - Changing the due date allows a new reminder at the new time. Saving a due date that's already past counts as already reminded, since it didn't just pass.
  - If the server was down when a note fell due, the reminder is sent once it's back, but only if it's less than 24 hours late.
- **The notification:** "Due: <title>", or "A note is due" for handwritten notes, with the app's icon. A second one for the same note replaces the first. Tapping it brings the app to the front, or opens it.
- **Service worker:** the generated service worker imports a small `push-sw.js` (via Workbox's `importScripts`), which shows the notifications and handles taps.
- **Offline:** a due date set offline gets its reminder once the change reaches the server.
