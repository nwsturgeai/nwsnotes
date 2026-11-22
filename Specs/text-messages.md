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

### Sending a note
- The text is the note's title. If it starts with the name, or the spoken name, of one of the person's tabs, that's taken off and the note gets the tab's tags, so it shows in that tab. Otherwise the whole text is the title and the note has no tags, so it shows in All.
- The note appears straight away on the person's other open devices.
- **A notification for every note:** each saved note sends a notification to the person's devices that have reminders turned on, e.g. "Saved to Shopping" with "Oat milk and bin bags" below it. Android Auto doesn't show these in the car; they're there to check afterwards. There's no setting to turn this off, for now.
- **A text back only when it fails:** if a note couldn't be saved, the reply is a text message saying why, so the person hears it in the car (Android Auto reads incoming texts aloud). Saved notes get no text back, which keeps the cost down.

### Spoken names for tabs
- Each tab can have an optional extra name, its "spoken name", which is easier to say or which dictation gets right more often than the tab's own name: e.g. a tab "DIY" with the spoken name "do it yourself", or "Kids' stuff" with "kids".
- A text can start with either the tab's name or its spoken name.
- The spoken name is only used for text messages. It isn't shown on the notes page.

### Costs
- Twilio charges in US dollars: about $2.50 a month for the UK mobile number, about $0.0075 for each text received, and about $0.05 for each text sent. So the cost is mostly the number, plus under 1 cent per note, plus 5 cents per failure reply. Notifications are free.

## Agreed technical decisions

### The Twilio number
- **Set up once by the admin:** a Twilio account (upgraded from the trial, with a top-up), a UK regulatory bundle (proof of address), and one UK mobile number that can receive texts. In the number's settings, "A message comes in" is set to a webhook, `https://<host>/api/sms/incoming` (HTTP POST). The steps are in `README.md` ("Adding notes by text message"), which suggests turning auto-recharge off so a fault can never run up a large bill. `deploy/set-sms.sh` puts the settings into `config.json` on the VM and restarts the app.
- **Settings on the VM,** in `/etc/nwsnotes/config.json`, never in the repository: `twilioAuthToken` (for checking that requests come from Twilio), `smsNumber` (the nwsnotes number, e.g. `+447700900123`) and `publicUrl` (e.g. `https://nwsnotes.com`, needed to check Twilio's signature).
- **Turned off when not set up:** without those settings, the server has no SMS route and Settings has no "Text messages" section. All three are needed, or none: the server won't start with only some of them. Development and the tests always have it on, with a fake (see Tests).
- **Checking it's Twilio:** every request must carry a correct `X-Twilio-Signature` (HMAC-SHA1, with the auth token, of the full webhook URL followed by the sorted form fields, as Twilio documents). The check is done in the server's own code, without Twilio's package. A request with a wrong or missing signature is answered 403 and does nothing.
- **Answered with TwiML:** the route answers 200 with `Content-Type: text/xml`. For a saved note, or a text that's ignored, the answer is an empty `<Response/>`, so nothing is sent. For a failure, it's `<Response><Message>…</Message></Response>`, which Twilio sends as the reply text. The reply text is escaped for XML. No outgoing call to Twilio's API is needed.
- **Sent twice:** Twilio can deliver the same text again if an answer is slow. The last 1,000 `MessageSid`s are remembered in memory, and a repeat gets an empty `<Response/>` and adds nothing.
- **Fields used:** `From` (the sender's number), `Body` (the text) and `MessageSid`. Long texts arrive as one `Body`, as Twilio joins their parts.

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

### Choosing the tab
- **Normalising for comparison:** both the text and the names are lower-cased, `&` becomes "and", everything that isn't a letter or digit becomes a space (accents are kept: "café" stays "café"), and runs of spaces become one. So "Kids' stuff", "kids stuff" and "Kids, stuff." all compare the same.
- **An optional word first:** the text may start with "tab" (e.g. "Tab shopping, milk"), which is skipped, in case a person finds that easier to say.
- **Matching:** each of the person's tabs offers its name and, if it has one, its spoken name. A name matches when the normalised text starts with the whole normalised name, followed by the end of a word (so "Work" doesn't match "Workshop leaflets").
- **Small slips are allowed:** the first words of the text can also match a name with the same number of words if each word is the same, has an "s" or "es" more or less at the end, or (for words of 5 letters or more) differs by one letter added, missing or changed. This only counts when exactly one tab matches this way; otherwise the slip is ignored. Exact matches always win over slips.
- **Several matches:** the longest name wins (in words), so with tabs "Home" and "Home jobs", "Home jobs fix the gate" goes to "Home jobs". Names can't clash (see Spoken names), so two tabs can't tie exactly.
- **The title** is the rest of the original text after the matched words, with any spaces and punctuation in front of it (`, : ; . - –`) removed and the first letter put in upper case. Nothing else in it is changed.
- **No tab matched:** the whole text (trimmed, with its first letter in upper case) is the title, with no tags.
- **"All"** isn't matched: a text starting "All" is just a note starting with "All".
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
  - **Only a tab's name:** "Nothing to save after the tab name."
  - **The note limit** (see "Note limit" in [users.md](users.md)): "Not saved: you've reached your limit of <limit> notes."
  - **Turned-off account:** "Not saved: your nwsnotes account is turned off."
  - **The database can't be reached,** or another error on the server: "Not saved: nwsnotes can't save right now. Please send it again later." The note's text isn't lost: it's still in the person's sent messages.
  - **Too many texts:** at most 20 notes in 10 minutes from one number. Past that: "Not saved: too many texts. Wait a few minutes and try again." This is sent once; further texts in the same 10 minutes get no reply, so a fault can't run up the bill.
- **The reply names the note,** so it's clear which one it was: "Not saved: "<start of the text>..." - you've reached your limit of 1000 notes."
- **One text per reply:** each reply fits in one SMS, as each part costs the same as a whole text. That's 160 characters when every character is in the standard SMS alphabet (GSM-7), or 70 when any isn't (e.g. an emoji or a curly quote, which make the whole text use a larger alphabet). So the fixed wording uses only plain characters (straight quotes, "..." and "-"), and the quoted start of the note is cut short to fit.
- **Failure replies are also sent as a notification,** with the heading "Not saved" and the full text of the note, so it can be added by hand later. ("Nothing to save after the tab name." isn't, as there's no note to keep.)

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
- **The test reset** also forgets the waiting codes, the remembered `MessageSid`s and the counts of texts, and puts user 1 back without a linked phone or a note limit of its own.
- **New `text-messages.spec.ts`:** linking from Settings (and a wrong, expired or reused code); unlinking; a text from an unlinked number adds nothing and gets no reply; a note goes into the right user's notebook only; a tab's name and its spoken name put the note in that tab, with its tags; slips and punctuation still match; the longest name wins; no match goes to All; a several-tag filter takes the first tag; the notification for each note; each failure reply (only a tab name, the note limit, a turned-off account, too many texts); a repeated `MessageSid` adds one note; opt-out words are ignored; a wrong signature is refused; the note appears on an open page straight away.
- **Tab tests** gain: saving a spoken name, its rules and errors, and it showing in the Settings tab list.
- **Unit tests** in `sms-matching.spec.ts` (run once, in the desktop project, with no browser): the tab matching, spoken names' rules, fitting replies into one text, and showing phone numbers. The signature check is tested end to end: correctly signed texts are accepted, and wrongly signed or unsigned ones refused.

### Later, not now
- A setting to choose which notes get a notification.
- Editing or archiving notes by text.
- A choice, per tab, of which tag to use when its filter has several in one category.
- Other messaging apps (WhatsApp).
