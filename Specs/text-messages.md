# Text messages: dictating notes from the car

## Requirements

People want to add notes by voice while driving. Their Android phone connects to the car with Android Auto, which only allows apps of certain kinds (media, navigation, messaging), so nwsnotes can't appear there itself. On Android Auto, Gemini can only send messages to people in the phone's contacts, so a Telegram bot or group doesn't work (both were tried). A phone number does: nwsnotes has its own UK mobile number, which each person saves in their contacts as "nwsnotes". They say "Hey Google, send a text to nwsnotes: Shopping, oat milk and bin bags", and the note "Oat milk and bin bags" is added to their own notebook, with the Shopping tab's tags.

### One number for everyone
- There's one number for the whole app, rented from Twilio. Every user of nwsnotes can link their own mobile number to their account, and texts from it go only into their own notebook.
- Texts from a number that isn't linked add nothing and get no reply.

### Linking a phone
- Settings has a "Text messages" section. While not linked, it shows the nwsnotes number and a "Link my phone" button. That shows a code and "Text <code> to <nwsnotes number> from your phone." Once that text arrives, the page shows "Linked to <phone number>" with an "Unlink" button.
- Each nwsnotes user can link one phone number, and each phone number can be linked to only one nwsnotes user.
- Linking is done at home, not while driving.

### Commands
- **Every text starts with a command word** (any case, any punctuation after it):
  - **Add <tab name> <title>:** a note in the named tab (by its name or spoken name), with the tab's tags. If no tab's name matches, everything after "Add" (the words that didn't match included) is the title, with no tags.
  - **New <title>:** a note with no tags, so it shows in All.
  - **Due <when>:** sets the due date of the note just added (see "Setting a due date").
  - **Reset New:** every New note becomes Active, as the Settings button does (see "Reset New").
  - **Email tab <tab name>:** emails a summary of that tab (see "Emailing a tab").
- **A text with no command word** is a note: the whole text is the title, with no tags. So are the old "App ..." commands ("App due", "App email tab"), which no longer work.

### Sending a note
- The note appears straight away on the person's other open devices.
- **A notification for every note:** each saved note sends a notification to the person's devices that have reminders turned on, e.g. "Saved to Shopping" with "Oat milk and bin bags" below it. Android Auto doesn't show these in the car; they're there to check afterwards. There's no setting to turn this off, for now.
- **A text back only when it fails:** if a note couldn't be saved, the reply is a text message saying why, so the person hears it in the car (Android Auto reads incoming texts aloud). Saved notes get no text back, which keeps the cost down, unless the admin has turned on confirmations for that person (below).
- **Confirmations, chosen by the admin for each person:** the admin can turn on, for any user, a text back confirming every text of theirs that worked: a saved note, a tab emailed, New notes reset, or a phone linked, so they hear in the car that it worked, not only when it didn't. It's off unless the admin turns it on.

### Emailing a tab
- A text "Email tab <tab name>" emails the person a summary of the notes that tab shows, to their login email (see [users.md](users.md): login names are email addresses). E.g. "Hey Google, send a text to nwsnotes: Email tab Shopping" before going to the shop.
- The tab is named as for notes: by its name or spoken name, with small slips allowed. "Email tab All" sends the All tab.
- Nothing is saved as a note. As for notes, a notification says it worked, and a text comes back only when it didn't.

### Setting a due date
- After adding a note, a second text "Due <when>" sets that note's due date, e.g. "Hey Google, send a text to nwsnotes: Due tomorrow at 3pm". "Due date <when>" works the same way.
- It sets the due date of the most recent note the person added themselves, by text or in the app, as long as that was in the last 5 minutes. Notes added to their notebook by people they share tags with don't count.
- The date can be "today", "tomorrow", a day of the week or a date; the time can use am/pm or the 24-hour clock. A date with no time is due at 20:00. A time with no date is today, or tomorrow if that time has already passed today. An hour up to 12 with no am or pm is taken to be between 7am and 6pm.
- A date and time that has already passed isn't set. As for notes, a notification says it worked, and a text comes back only when it didn't (or with confirmations on).

### Spoken names for tabs
- Each tab can have an optional extra name, its "spoken name", which is easier to say or which dictation gets right more often than the tab's own name: e.g. a tab "DIY" with the spoken name "do it yourself", or "Kids' stuff" with "kids".
- "Add" and "Email tab" can be followed by either the tab's name or its spoken name.
- The spoken name is only used for text messages. It isn't shown on the notes page.

### Costs
- Twilio charges in US dollars: about $2.50 a month for the UK mobile number, about $0.0075 for each text received, and about $0.05 for each text sent. So the cost is mostly the number, plus under 1 cent per note, plus 5 cents per failure reply (and per confirmation, for people the admin has turned them on for). Notifications are free.

## Agreed technical decisions

### The Twilio number
- **Set up once by the admin:** a Twilio account (upgraded from the trial, with a top-up), a UK regulatory bundle (proof of address), and one UK mobile number that can receive texts. In the number's settings, "A message comes in" is set to a webhook, `https://<host>/api/sms/incoming` (HTTP POST). The steps are in `README.md` ("Adding notes by text message"), which suggests turning auto-recharge off so a fault can never run up a large bill. `deploy/set-sms.sh` puts the settings into `config.json` on the VM and restarts the app.
- **Settings on the VM,** in `/etc/nwsnotes/config.json`, never in the repository: `twilioAuthToken` (for checking that requests come from Twilio), `smsNumber` (the nwsnotes number, e.g. `+447700900123`) and `publicUrl` (e.g. `https://nwsnotes.com`, needed to check Twilio's signature).
- **Turned off when not set up:** without those settings, the server has no SMS route and Settings has no "Text messages" section. All three are needed, or none: the server won't start with only some of them. Development and the tests always have it on, with a fake (see Tests).
- **Checking it's Twilio:** every request must carry a correct `X-Twilio-Signature` (HMAC-SHA1, with the auth token, of the full webhook URL followed by the sorted form fields, as Twilio documents). The check is done in the server's own code, without Twilio's package. A request with a wrong or missing signature is answered 403 and does nothing.
  - **Which URL:** a signature for either `publicUrl` + the path, or the address the request actually came in on (its protocol, `Host` and path), is accepted. So texts keep working while the site moves to a new name and Twilio's webhook still uses the old one (or the other way round). Accepting the request's own address is safe, as the signature still needs the auth token.
- **Answered with TwiML:** the route answers 200 with `Content-Type: text/xml`. For a saved note, or a text that's ignored, the answer is an empty `<Response/>`, so nothing is sent. For a failure, it's `<Response><Message>…</Message></Response>`, which Twilio sends as the reply text. The reply text is escaped for XML. No outgoing call to Twilio's API is needed.
- **Sent twice:** Twilio can deliver the same text again if an answer is slow. The last 1,000 `MessageSid`s are remembered in memory, and a repeat gets an empty `<Response/>` and adds nothing.
- **Fields used:** `From` (the sender's number), `Body` (the text) and `MessageSid`. Long texts arrive as one `Body`, as Twilio joins their parts.

### Logging
- **One line in the server's log for each text** (seen with `pm2 logs nwsnotes`), so it's clear what happened when a note doesn't appear: e.g. `Text SM… from …258: saved as user 1's note 42, in tab 3.` The outcomes: refused (wrong or missing signature, naming the addresses checked), already received, empty, a linking code used, a code that isn't waiting, a phone that isn't linked, an opt-out word, too many texts, a turned-off account, only a tab's name, the note limit, an error, or saved; and for the email command, emailed (naming the tab and the number of notes), or not emailed (email not set up, a login that isn't an email, the daily limit, no tab matched, or an error). Never the email's contents or address.
- **Never the text itself,** and only the last 3 digits of the sender's number. Users are named by their id.

### Phone numbers
- **Stored as E.164,** e.g. `+447700900123`. Twilio sends `From` in this form already.
- **Shown in UK form,** e.g. `07700 900123`, for UK numbers, and as E.164 otherwise.

### Linking
- **Stored with the user,** in the `users` table's `data`: `smsPhoneNumber` (E.164) and `smsLinkedDateTime`. No two users have the same number: linking a number takes it from anyone else it was linked to. Links aren't in the History, backups or save-files, like the rest of a user.
- **Making a code:** "Link my phone" calls `POST /api/me/sms/link-code`, which returns `{ code, smsNumber }`. The code is 6 digits, made with a cryptographically secure random generator, unique among the codes waiting. It's kept in the server's memory only, for 15 minutes, and works once. Making a new code cancels the user's earlier unused one. The page shows "Text <code> to <nwsnotes number> from your phone. The code works for 15 minutes." with the number as a `sms:` link, so on a phone a tap opens Messages with it filled in.
- **Using a code:** a text whose whole `Body`, trimmed, is exactly 6 digits matching a waiting code links the sender's number to that user, replacing any earlier link of either the user or the number. Nothing is sent back by text. Instead the Settings page changes to "Linked" through the usual live updates, and a notification says "Phone linked" with "Notes texted from <phone number> will be added here.".
- **A wrong or expired code** from an unlinked number gets no reply (like any text from an unlinked number); the Settings page still shows the code, and the person can make a new one. From a linked number, 6 digits that aren't a waiting code are saved as a note, like any other text.
- **Showing it:** `GET /api/me/sms` returns `{ smsNumber, linked: false }` or `{ smsNumber, linked: true, phoneNumber, linkedDateTime }`. Settings also says "Save <nwsnotes number> in your contacts as "nwsnotes", then say "Hey Google, send a text to nwsnotes" followed by the note. Start it with a tab's name to put it in that tab.".
- **No notifications warning:** if the person's current device doesn't have reminders turned on, the section adds "Turn on reminders on this device to be told about each note you text."
- **Unlinking:** "Unlink", after "Unlink <phone number>? Texts from it will no longer add notes.", calls `DELETE /api/me/sms`.
- **Turned-off accounts** keep their link, but their texts are refused (see Failures). Turning the account back on makes it work again.
- **The users page** shows a "Phone" label on the rows of users who have linked a phone. The admin can't see anyone's phone number. `UserSummary` gains `smsLinked`.

### Which texts are ignored
- **From an unlinked number:** nothing is saved and nothing is sent back, apart from the linking codes above.
- **Opt-out words:** a text that's only `STOP`, `START`, `UNSTOP`, `HELP`, `INFO`, `CANCEL`, `END`, `QUIT`, `UNSUBSCRIBE` or `STOPALL` (any case, trimmed) isn't saved as a note, as Twilio may act on these words itself.
- **Empty texts** (e.g. only spaces) are ignored.

### Reading the command
- **The command word** is read by `readSmsCommand` in `shared/src/sms.ts` (unit tested), from the text's words as normalised below: "add", "new", "due" (with an optional "date" after it), "reset new" (only those two words, nothing after them: "Reset new boiler timer" is a note), or "email tab" ("e-mail" and "e mail" count as "email"; "Email the plumber" is a note). It's a whole word, so "Address the envelopes" and "Newspapers" are notes. What follows the command's words is used as written, with any spaces and punctuation in front of it (`, : ; . - –`) removed.
- **Checked as before:** the same signature check, repeats, linking codes, opt-out words, rate limit (each command counts as one of the 20 texts in 10 minutes) and turned-off accounts, in the same order. Only after those is the command read.

### Choosing the tab
- **For "Add":** what follows "Add" is matched against the tabs as below.
- **Normalising for comparison:** both the text and the names are lower-cased, `&` becomes "and", everything that isn't a letter or digit becomes a space (accents are kept: "café" stays "café"), and runs of spaces become one. So "Kids' stuff", "kids stuff" and "Kids, stuff." all compare the same.
- **An optional word first:** what follows "Add" may start with "tab" (e.g. "Add tab shopping, milk"), which is skipped, in case a person finds that easier to say.
- **Matching:** each of the person's tabs offers its name and, if it has one, its spoken name. A name matches when the normalised text starts with the whole normalised name, followed by the end of a word (so "Work" doesn't match "Workshop leaflets").
- **Small slips are allowed:** the first words of the text can also match a name with the same number of words if each word is the same, has an "s" or "es" more or less at the end, or (for words of 5 letters or more) differs by one letter added, missing or changed. This only counts when exactly one tab matches this way; otherwise the slip is ignored. Exact matches always win over slips.
- **Several matches:** the longest name wins (in words), so with tabs "Home" and "Home jobs", "Home jobs fix the gate" goes to "Home jobs". Names can't clash (see Spoken names), so two tabs can't tie exactly.
- **The title** is the rest of the original text after the matched words, with any spaces and punctuation in front of it (`, : ; . - –`) removed and the first letter put in upper case. Nothing else in it is changed.
- **No tab matched:** everything after "Add" (trimmed, with its first letter in upper case) is the title, with no tags. The notification says "No tab matched, so it has no tags."
- **"All"** isn't matched: "Add All milk" is a note "All milk" with no tags.
- **"New" and no command:** the title is what follows "New", or the whole text, with its first letter in upper case. The notification for a text with no command says "It didn't start with a command, so it has no tags."
- **Matching** is a shared function, `matchSpokenTab` in `shared/src/sms.ts`, with its own unit tests, as it has many small cases.

### The note
- **Tags from the tab,** following the same rules as adding a note under a tab on the notes page (see "New-note dropdowns under a tab" in [tabs.md](tabs.md)):
  - for each category in the tab's filter with one tag, the note gets that tag;
  - for a category with several tags, the note gets the first of them in the category's own tag order. The notification doesn't mention it;
  - categories the tab doesn't filter on are left without tags.
- **Lifetime:** the note is New, as all new notes are.
- **Too long:** a title over 500 characters is cut at the last space before 500 characters. It's still saved, and the notification says so.
- **Added as any other note:** the same checks, the same place in the note order (at the bottom, as the newest), one change in the History ("Added "<title>" by text message"), and live updates to the person's open devices.

### The notification for each note
- **Sent with the reminders' Web Push** (see "Reminders (push notifications)" in [due-dates.md](due-dates.md)) to every device of that person that has reminders turned on. A person with none gets no notification; the note is still saved.
- **Its heading** is "Saved to <tab name>", or "Saved to All" when no tab matched.
- **Its text** is the note's title. After it, on a new line, when they apply:
  - "No tab matched, so it has no tags." (when no tab matched);
  - "This tab doesn't show New notes." (when the tab hides New notes);
  - "It was too long and has been cut short." (when cut).
- **Each note gets its own notification;** they don't replace each other.
- **Tapping it** brings the app to the front, or opens it, as for reminders.

### Failures: a text back
- When a text from a linked number can't be saved, the answer has a `<Message>` and Twilio sends it as a text. Nothing is saved.
  - **Only a tab's name after "Add":** "Nothing to save after the tab name."
  - **Nothing after "Add" or "New":** "Nothing to save after Add." / "Nothing to save after New."
  - **The note limit** (see "Note limit" in [users.md](users.md)): "Not saved: you've reached your limit of <limit> notes."
  - **Turned-off account:** "Not saved: your nwsnotes account is turned off."
  - **The database can't be reached,** or another error on the server: "Not saved: nwsnotes can't save right now. Please send it again later." The note's text isn't lost: it's still in the person's sent messages.
  - **Too many texts:** at most 20 notes in 10 minutes from one number. Past that: "Not saved: too many texts. Wait a few minutes and try again." This is sent once; further texts in the same 10 minutes get no reply, so a fault can't run up the bill.
- **The reply names the note,** so it's clear which one it was: "Not saved: "<start of the text>..." - you've reached your limit of 1000 notes."
- **One text per reply:** each reply fits in one SMS, as each part costs the same as a whole text. That's 160 characters when every character is in the standard SMS alphabet (GSM-7), or 70 when any isn't (e.g. an emoji or a curly quote, which make the whole text use a larger alphabet). So the fixed wording uses only plain characters (straight quotes, "..." and "-"), and the quoted start of the note is cut short to fit.
- **Failure replies are also sent as a notification,** with the heading "Not saved" and the full text of the note, so it can be added by hand later. ("Nothing to save after ..." isn't, as there's no note to keep.)

### Emailing a tab
- **The command:** a text whose first words are "email tab" (or "e-mail" / "e mail", as dictation may write it), read by `readSmsCommand`. What follows names the tab, matched by `emailTabTarget` in `shared/src/sms.ts`, unit tested with the tab matching.
- **Which tab:** matched as for notes (name or spoken name, slips allowed, the longest name winning), but the whole rest of the text must be the tab's name: "Email tab work and home" names no tab. Only "all" (after the optional "tab") is the built-in All tab.
- **Checked as other texts are:** the same signature check, repeats, linking, opt-out words, rate limit (it counts as one of the 20 texts in 10 minutes) and turned-off accounts, in the same order. Only after those is it read as a command.
- **Which notes:** exactly those the notes page lists in that tab without any extra filter row ticks or search: matching the tab's filters (`noteMatchesFilters`), so Bin notes are left out unless the tab ticks Bin, in the shared note order (`orderNotes`). Long-form notes and the notes added inside them are listed as they are on the page.
- **The email:**
  - **To** the person's login email, with their display name. **From** `emailFrom` in the config (default `noreply@nwsnotes.com`), named "nwsnotes". Replies to it go nowhere, as no mailbox is set up for it.
  - **Subject:** "nwsnotes: <tab name> (<n> notes)" ("1 note" for one).
  - **Body,** as plain text and as simple HTML: "Your <tab name> tab on <day, e.g. Sunday, 22 November 2026>: <n> notes.", then one line per note, then a link to the site (`publicUrl`). A tab showing no notes says "This tab shows no notes."
  - **Each note's line:** its title, without formatting markers (`withoutMarkers`). A handwritten title shows as "[Handwritten note]", as the picture isn't sent. In brackets after it, when they apply: "long-form note"; "in <long-form note's title>" for a note added inside one (as its pill on the notes page); "due <date, e.g. Tue, 5 Mar 2030, 14:30>" (or "was due" once past). Dates and times are UK time (Europe/London).
- **Afterwards:** a notification, "Emailed <tab name>" with "<n> notes, sent to <login email>.". No text is sent back, unless the person has confirmations on (see "Confirmations").
- **When it can't be sent,** the reply is a text (one SMS, plain characters only) and the same reason goes in a notification headed "Not emailed":
  - **No tab matched:** `Not emailed: no tab called "<what was heard>".` (the name cut short with "..." to fit one text); with no name at all: `Not emailed: say which tab, e.g. "Email tab Shopping".`
  - **Email isn't set up** (no Brevo key on the VM): "Not emailed: email isn't set up on nwsnotes."
  - **A login from before login names were emails:** "Not emailed: your login isn't an email address. Ask the admin to change it."
  - **The daily limit:** at most 10 tab emails for each person in 24 hours (counted in memory, so a restart forgets them), which keeps everyone well within Brevo's free 300 a day: "Not emailed: you've had 10 tab emails in the last day. Try again later."
  - **Brevo refused it or couldn't be reached** (within 8 seconds, as Twilio waits about 15 for the answer): "Not emailed: nwsnotes couldn't send the email. Please try again later." Brevo's answer goes in the log.
- **Sending:** `server/src/email.ts` posts to Brevo's API (`https://api.brevo.com/v3/smtp/email`, with the key in the `api-key` header). This goes over HTTPS on port 443, as DigitalOcean blocks outgoing mail ports (25, 465, 587).
- **Settings on the VM,** in `/etc/nwsnotes/config.json`: `brevoApiKey` (turns email on) and `emailFrom` (optional; must be an email address on a domain authenticated in Brevo), and optionally `emailFromName`. `deploy/set-email.sh` asks for them and restarts the app; the steps are in `README.md` ("Sending email"). Development and the tests never send: emails are kept in memory.

### Setting a due date
- **The command:** a text whose first word is "due" (any case, any punctuation), optionally followed by "date" ("Due date Friday"). What follows is the date and time. Read by `readSmsCommand` in `shared/src/sms.ts`.
- **Checked as other texts are:** the same signature check, repeats, linking, opt-out words, rate limit (it counts as one of the 20 texts in 10 minutes) and turned-off accounts, in the same order. Only after those is it read as a command.
- **Who added each note:** every note now records `createdByUserId`, the id of the user who added it (see "Due dates" in [due-dates.md](due-dates.md)). Notes from before this have none, so they never count.
- **Which note:** of the notes the person can see (their own notebook and the notes shared with them), the one with `createdByUserId` their own id and the latest `createdDateTime` (the higher id if two tie). It must have been created at most 5 minutes before the text arrives. A note written offline counts from when it was written, not when it reached the server.
  - Someone a tag is shared with who adds a note in the person's notebook is its creator, so that note is never the person's "last note".
  - If the person's last note is one they added in someone else's notebook (with a tag shared with them), it isn't changed, as only its owner can set due dates on it.
- **Reading the date and time,** in UK time (Europe/London: GMT or BST, whichever is in force on that date), by `readSpokenDue` in `shared/src/spokenDue.ts`, unit tested in `sms-matching.spec.ts`:
  - **Tidying first:** lower case; "a.m."/"p.m." (any spacing and full stops) become "am"/"pm"; "o'clock" is allowed; ordinal endings are dropped ("25th" → 25); numbers in words become digits ("twenty five" → 25, "twenty fifth" → 25, "nine thirty" → 9 30, "nine oh five" → 9 05, "fifteen hundred" → 1500); punctuation is ignored, except ":" or "." in a time and "/" in a date.
  - **Words that join without changing anything** are skipped: at, on, the, of, by, for, a, and, in, this, next, hours, hrs, around, about.
  - **Dates:** "today"; "tomorrow"; "day after tomorrow"; a day of the week (the next one; today's weekday means a week today; "this" and "next" change nothing); a day and month either way round ("25th December", "December the 25th", "Dec 25"), with an optional 4-digit year; or a UK numeric date, day first ("25/12", "25/12/26", "25/12/2026"). A date with no year is the next one, so "3rd January" in November is next year. A day of the week given with a date must match it ("Friday 27th November"). A date that doesn't exist ("31st April") isn't understood.
  - **Times:** "3", "3pm", "3:30", "3.30 pm", "15:00", "1500", "9 30", "930", "noon", "midday", "midnight", "half past 3", "quarter past 3", "quarter to 4", "20 past 3", "10 to 4".
  - **Am or pm:** given, it's used ("12 am" is 00:00, "12 pm" is noon; "15 am" isn't understood). Without it, 0 and 13–23 are the 24-hour clock, as are times written with a leading 0 ("09:30") or as four digits ("0930", "1500"). Otherwise an hour up to 12 is between 7am and 6pm: 7–11 are am, 12 is noon, 1–6 are pm.
  - **Parts of the day:** "morning" (am), "afternoon", "evening", "night" (pm), and "tonight" (today, pm), so "tonight at 7" is 19:00. With no time, they mean 09:00, 15:00 and 20:00 ("tomorrow morning" is 09:00).
  - **Missing parts:** a date with no time is due at 20:00, as in the due-date dialog. A time with no date is today, or tomorrow if that time has already passed today. "Midnight" is the end of the day it names ("tomorrow midnight" is 00:00 the day after tomorrow); with no day, the coming midnight.
  - **Refused:** a date and time at or before now ("today 9am" sent at 10am) is never moved on; it's an error. So is anything with a word it doesn't know ("tomorrow at 3pm please", "yesterday"), two dates or two times, or no date or time at all.
- **Setting it:** `store.setDueDate` changes only the due date (and `lastModifiedDateTime`), as a change in the History ("Set the due date of "<title>" by text message"), with live updates to the person's open devices and those it's shared with. A new due date replaces any earlier one and allows a new reminder at the new time, as when it's changed in the app.
- **Afterwards:** a notification, "Due <when>" (e.g. "Due Tue 25/11 15:00", with the year when it isn't this year: "Due Tue 05/01/27 09:00"), with the note's title (without formatting markers; "[Handwritten note]" for a handwritten one). No text is sent back, unless the person has confirmations on: then `Due <when>: "<title>"`, the title cut short with "..." to fit one text (`dueSetReply`).
- **When it can't be set,** nothing changes, the reply is a text (one SMS, plain characters only), and the same reason goes in a notification headed "Due date not set":
  - **Nothing after the command:** `Not set: say when it's due, e.g. "Due tomorrow 3pm".`
  - **No note of theirs in the last 5 minutes:** "Not set: you haven't added a note in the last 5 minutes."
  - **Their last note is in someone else's notebook:** "Not set: your last note is in <owner>'s notebook, so only they can set its due date." (with "someone else's" when the name makes it too long for one text).
  - **Their last note is long-form:** "Not set: your last note is a long-form note, which can't have a due date."
  - **Not understood:** `Not set: couldn't understand "<what was heard>" as a date and time.`, the quoted part cut short with "..." to fit (`dueNotUnderstoodReply`).
  - **Already past:** "Not set: <when> has already passed."
  - **An error on the server:** "Not set: nwsnotes can't save right now. Please send it again later."
- **Logging:** one line, as for other texts: due date set (naming the note's id), or not set with the reason. Never the text itself.

### Reset New
- **The command:** a text that's only the words "reset new" (any case, any punctuation), read by `readSmsCommand`.
- **What it does:** as the Settings "Reset New" button (`Sharing.bulkLifetime(user, "reset-new")`): every one of the person's New notes becomes Active, with the New notes shared with them that they may edit. One change in the History, "Reset New (<n> notes made Active)", as for the button, with live updates to the person's open devices and those it's shared with.
- **Afterwards:** a notification, "Reset New" with "<n> notes made Active." ("1 note made Active.", or "There were no New notes."). No text is sent back, unless the person has confirmations on: then `Reset New: <n> notes made Active.` or `Reset New: there were no New notes.` (`resetNewReply`).
- **An error** (e.g. the database can't be reached): the text back "Not reset: nwsnotes can't save right now. Please send it again later.", and a notification headed "New notes not reset".
- **Logging:** "reset New: <n> of user <id>'s notes made Active.", or "not reset: an error ...".

### Confirmations
- **Stored with the user,** in the `users` table's `data`: `smsConfirmations` (true when on; missing means off). Like the rest of a user, not in the History, backups or save-files. `UserSummary` gains `smsConfirmations`; `PUT /api/users/:id` takes `{ smsConfirmations: true | false }` (admin only, like the rest of `/api/users`; anything else is 400, '"smsConfirmations" must be true or false.').
- **The users page:** the Edit form has a checkbox, "Text back to confirm each text", under the note limit, with the hint "Each note or command they text in that works gets a text back saying so, as well as the notification. Texts that fail always get one. Each text back costs about $0.05." It's shown whether or not text messages are set up, as it's harmless. Rows of users who have it on show a "Texts back" label. The admin can turn it on for themselves too.
- **What gets one,** as the TwiML `<Message>`, one SMS, plain characters only in the fixed wording, as for failures. The notification is still sent as well.
  - **A saved note:** `Saved to <tab name>: "<title>"` ("All" when no tab matched), with ", cut short" after the tab name when the title was cut to 500 characters. The quoted title is cut short with "..." to fit one text; if even that can't fit (a very long tab name), `Saved to <tab name>.`, or else `Saved.`. (`savedReply` in `shared/src/sms.ts`.)
  - **A tab emailed:** `Emailed <tab name> (<n> notes) to <login email>.`, or without "to <login email>" when that doesn't fit. (`emailedReply`.)
  - **Reset New:** `Reset New: <n> notes made Active.` (`resetNewReply`.)
  - **A phone linked** with a code, when the user it's linked to has it on: "Phone linked: notes you text from it will be added to nwsnotes."
- **What doesn't:** failures are answered as before (they always get a text). Texts that are ignored still get nothing: repeats of a `MessageSid`, opt-out words, empty texts, unlinked numbers, and texts past the rate limit after its one warning. So the rate limit also caps the confirmations at 20 in 10 minutes for a number.
- **Logging:** the log line for a saved note, tab email or link adds "; confirmed by text" when one is sent.
- **Cost:** each confirmation is a sent text, about $0.05, so a person texting 10 notes a day adds about $15 a month. That's why it's off unless the admin turns it on.

### Spoken names
- **Stored on the tab:** a new optional `spokenName` field on `Tab`, sent and checked with the tab's name, filters and placement (`POST` and `PUT /api/tabs`). Tabs without it have no spoken name.
- **Rules:** trimmed; empty means none; at most 40 characters; it must have at least one letter or digit. Normalised as above, it can't be the same as "all", as "tab", as its own tab's name, or as any other tab's name or spoken name. Error: "Another tab already uses that name." (or "…can't be "All"").
- **The same check for names:** a tab's name now also can't be the same as another tab's spoken name once normalised, so a text can never match two tabs exactly.
- **In the tab editor,** under the name box: a "Spoken name (optional)" box, with the hint "An easier name to say when sending notes by text message, e.g. "do it yourself" for "DIY"." It's shown whether or not text messages are set up, as it's harmless.
- **In Settings,** the tab list shows the spoken name in grey after the tab's name, e.g. "DIY (do it yourself)".
- **History:** changing it is part of saving the tab, so it's undone with it.

### Tests
- **A fake Twilio:** in test mode the SMS route is on, with a test auth token, number and public URL. Tests post made-up texts to `/api/sms/incoming` in Twilio's form format, signed with the test token, and check the TwiML in the answer.
- **Notifications in test mode** are kept in memory instead of being sent, and `GET /api/test/notifications` returns the logged-in user's (test mode only), so tests can check the "Saved to…" notifications. A test registers a made-up device first (`POST /api/push/subscribe`), as only users with a device get notifications.
- **Emails in test mode** are kept in memory instead of being sent, and `GET /api/test/emails` returns those sent to the logged-in user's login email (test mode only).
- **The test reset** also forgets the waiting codes, the remembered `MessageSid`s, the counts of texts and emails, and the kept emails, and puts user 1 back without a linked phone, confirmations or a note limit of its own.
- **Confirmations** (`text-messages.spec.ts`): turning them on in the users page's Edit form (and the "Texts back" label); the text back for a note in a tab, in All, cut short, a tab email and a linked phone; failures and opt-out words unchanged; turning them off; a wrong value refused; set for each user separately, and only by the admin. In `sms-matching.spec.ts`: `savedReply` and `emailedReply` fit in one text.
- **New `text-messages.spec.ts`:** linking from Settings (and a wrong, expired or reused code); unlinking; a text from an unlinked number adds nothing and gets no reply; a note goes into the right user's notebook only; a tab's name and its spoken name put the note in that tab, with its tags; slips and punctuation still match; the longest name wins; no match goes to All; a several-tag filter takes the first tag; the notification for each note; each failure reply (only a tab name, the note limit, a turned-off account, too many texts); a repeated `MessageSid` adds one note; opt-out words are ignored; a wrong signature is refused; the note appears on an open page straight away.
- **Emailing a tab** (`text-messages.spec.ts`): the email's address, subject and note lines for a tab, its order, Bin left out, handwritten, long-form and child notes, due dates; a spoken name, All, and an empty tab; no tab matched (with a long name cut to fit), no name; only the texting user's tabs and email; the daily limit, with notes still saved after it.
- **Setting a due date** (`text-messages.spec.ts`): "Due" after a texted note and after one added in the app, the History entry and the date on the notes page; "Due date"; a second one replacing the date; the notification, and the confirmation with confirmations on; each failure reply (nothing after the command, not understood, already past, long-form); a note created more than 5 minutes ago; a note someone a tag is shared with added in the person's notebook not counting; and that person's own "Due" for it refused. In `sms-matching.spec.ts`: `readSpokenDue` (today and tomorrow, am/pm and the 24-hour clock, the 7am–6pm rule, numbers in words, weekdays and dates, GMT and BST, and what's refused), and the replies fitting one text.
- **Command words** (`text-messages.spec.ts`): a text with no command is a note with no tags (a tab's name without "Add", and the old "App" commands, included), with its notification; "New", and nothing after it; "Add" naming no tab (the rest is the title) and nothing after it; "Reset New" (the notes made Active, the notification, the History entry, none left, and more words making it a note); its confirmation. In `sms-matching.spec.ts`: `readSmsCommand` and `resetNewReply`.
- **Tab tests** gain: saving a spoken name, its rules and errors, and it showing in the Settings tab list.
- **Unit tests** in `sms-matching.spec.ts` (run once, in the desktop project, with no browser): the tab matching, spoken names' rules, reading the command word (`readSmsCommand`), fitting replies into one text, and showing phone numbers. The signature check is tested end to end: correctly signed texts are accepted, and wrongly signed or unsigned ones refused.

### Later, not now
- A setting to choose which notes get a notification.
- Editing or archiving notes by text.
- A choice, per tab, of which tag to use when its filter has several in one category.
- Other messaging apps (WhatsApp).
- Setting a due date on a note other than the last one, or more than 5 minutes after adding it.
- Other commands, and handwritten titles shown as pictures in the tab email.
