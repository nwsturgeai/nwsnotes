# Telegram: dictating notes from the car

## Requirements

People want to add notes by voice while driving. Their Android phone connects to the car with Android Auto, which only allows apps of certain kinds (media, navigation, messaging), so nwsnotes can't appear there itself. Telegram can. So nwsnotes has a Telegram bot: a person says "Hey Google, send a Telegram message to nwsnotes: Shopping, oat milk and bin bags", and the note "oat milk and bin bags" is added to their own notebook, with the Shopping tab's tags.

### One bot for everyone
- There's one bot for the whole app. Every user of nwsnotes can link their own Telegram account to it, and their messages go only into their own notebook.
- A Telegram account that isn't linked can't add notes to anyone's notebook. The bot just explains how to link.

### Linking
- Settings has a "Telegram" section. While not linked, it has a "Link Telegram" button, which opens Telegram at the bot with a one-time code. The person taps "Start" in Telegram, and the bot replies "Linked to nwsnotes as <display name>." The Settings page then shows "Linked to Telegram as <Telegram name>" with an "Unlink" button.
- Each nwsnotes user can link one Telegram account, and each Telegram account can be linked to only one nwsnotes user.
- Linking again from a different Telegram account replaces the earlier link.
- Linking is done at home, not while driving.

### Sending a note
- The message is the note's title. If it starts with the name, or the spoken name, of one of the person's tabs, that's taken off and the note gets the tab's tags, so it shows in that tab. Otherwise the whole message is the title and the note has no tags, so it shows in All.
- The bot replies with what it saved, e.g. "Saved to Shopping: oat milk and bin bags" or "Saved to All: call the garage". Android Auto reads incoming messages aloud, so the person hears it without looking.
- The note appears straight away on the person's other open devices.

### Spoken names for tabs
- Each tab can have an optional extra name, its "spoken name", which is easier to say or which dictation gets right more often than the tab's own name: e.g. a tab "DIY" with the spoken name "do it yourself", or "Kids' stuff" with "kids".
- A message can start with either the tab's name or its spoken name.
- The spoken name is only used for Telegram. It isn't shown on the notes page.

## Agreed technical decisions

### The bot
- **Created once by the admin** with Telegram's BotFather, free. The bot's token, its username and a webhook secret go in `/etc/nwsnotes/config.json` on the VM as `telegramBotToken`, `telegramBotUsername` and `telegramWebhookSecret`, never in the repository. The deployment notes in [hosting.md](hosting.md) gain the steps.
- **Turned off when not set up:** without those settings, the server has no Telegram routes and Settings has no Telegram section. Development and the tests use a fake Telegram (see Tests).
- **Webhook, not polling:** at start-up the server calls Telegram's `setWebhook` with `https://<host>/api/telegram/webhook`, the secret, and `allowed_updates: ["message"]`. Telegram then sends each message to that route, with the secret in the `X-Telegram-Bot-Api-Secret-Token` header. A request without the right secret is answered 401 and ignored.
- **Always answered 200** once the secret is right, even when the message is refused, so Telegram doesn't send it again. What went wrong is said in the bot's reply instead.
- **Only private chats** with the bot are used. Messages from groups and channels are ignored.
- **Replies** are sent with Telegram's `sendMessage`, as plain text (no Markdown), so a note's own text can't break the formatting.

### Linking
- **Stored in the database,** in a new `telegram_links` table: `telegram_user_id` (`bigint`, the primary key), `user_id` (unique) and `data` (`jsonb`) holding `telegramName` (the Telegram first name and last name, or `@username` when there is one, for showing in Settings) and `linkedDateTime`. Links aren't in the History, backups or save-files, like users.
- **Making a code:** "Link Telegram" calls `POST /api/me/telegram/link-code`, which returns `{ url }`: `https://t.me/<bot username>?start=<code>`. The code is 24 random characters from letters and digits, made with a cryptographically secure random generator. It's kept in the server's memory only, for 10 minutes, and works once. Making a new code cancels the user's earlier unused one. The page opens the URL; on an Android phone this opens the Telegram app.
- **Using a code:** the bot gets `/start <code>`. If the code is right and hasn't expired, the link is saved (replacing any earlier link of either the user or the Telegram account) and the bot replies "Linked to nwsnotes as <display name>. Send me a message to add it as a note. Start it with a tab's name to put it in that tab." Otherwise: "That link has expired. Open nwsnotes Settings and tap "Link Telegram" again."
- **Live update:** the Settings page of the user's other open devices changes to "Linked" through the usual live updates.
- **Showing it:** `GET /api/me/telegram` returns `{ linked: false }` or `{ linked: true, telegramName, linkedDateTime }`.
- **Unlinking:** "Unlink", after "Unlink Telegram? Messages from <Telegram name> will no longer add notes.", calls `DELETE /api/me/telegram`. The person can also send `/unlink` to the bot, which replies "Unlinked from nwsnotes."
- **Turned-off accounts** keep their link, but the bot refuses their messages: "This nwsnotes account is turned off." Turning the account back on makes it work again.
- **The users page** shows a "Telegram" label on the rows of users who have linked Telegram. The admin can't see anyone's Telegram name. `UserSummary` gains `telegramLinked`.

### Messages
- **Unlinked Telegram accounts** get "This Telegram account isn't linked to nwsnotes. Open nwsnotes, go to Settings and tap "Link Telegram"." for any message.
- **Text only:** a message with no text (a voice message, photo, sticker…) gets "Only text messages can be saved as notes. Dictate the note with Google instead of recording it."
- **Commands:**
  - `/start <code>`: links, as above. `/start` without a code (e.g. someone finding the bot) gets the unlinked message, or for a linked account the help text.
  - `/help`: how to send a note, and the person's tab names with their spoken names in brackets, e.g. "Tabs: Shopping, DIY (do it yourself), Work".
  - `/unlink`: as above.
  - Any other message starting with `/` gets the help text, rather than being saved as a note.
- **Everything else is a new note,** in the linked user's notebook, worked out as follows.

### Choosing the tab
- **Normalising for comparison:** both the message and the names are lower-cased, `&` becomes "and", everything that isn't a letter or digit becomes a space (accents are kept: "café" stays "café"), and runs of spaces become one. So "Kids' stuff", "kids stuff" and "Kids, stuff." all compare the same.
- **An optional word first:** the message may start with "tab" (e.g. "Tab shopping, milk"), which is skipped, in case a person finds that easier to say.
- **Matching:** each of the person's tabs offers its name and, if it has one, its spoken name. A name matches when the normalised message starts with the whole normalised name, followed by the end of a word (so "Work" doesn't match "Workshop leaflets").
- **Small slips are allowed:** the first words of the message can also match a name with the same number of words if each word is the same, has an extra "s" or "es" at the end, or (for words of 5 letters or more) differs by one letter added, missing or changed. This only counts when exactly one tab matches this way; otherwise the slip is ignored. Exact matches always win over slips.
- **Several matches:** the longest name wins (in words), so with tabs "Home" and "Home jobs", "Home jobs fix the gate" goes to "Home jobs". If two different tabs still tie, for instance when one's name is another's spoken name, no tab is chosen.
- **The title** is the rest of the original message after the matched words, with any spaces and punctuation in front of it (`, : ; . - –`) removed and the first letter put in upper case. Nothing else in it is changed.
- **Nothing left:** if the message is only a tab's name, nothing is saved, and the bot replies "Nothing to save after the tab name."
- **No tab matched:** the whole message (trimmed) is the title, with no tags.
- **"All"** isn't matched: a message starting "All" is just a note starting with "All".

### The note
- **Tags from the tab,** following the same rules as adding a note under a tab on the notes page (see "New-note dropdowns under a tab" in [tabs.md](tabs.md)):
  - for each category in the tab's filter with one tag, the note gets that tag;
  - for a category with several tags, the note gets the first of them in the category's own tag order. The reply doesn't mention it: it's still "Saved to Shopping: oat milk";
  - categories the tab doesn't filter on are left without tags.
- **Lifetime:** the note is New, as all new notes are. If the tab doesn't show New notes, the reply adds "This tab doesn't show New notes.", like the app's notice.
- **Too long:** a title over 500 characters is cut at the last space before 500 characters, and the reply adds "The note was too long and has been cut short."
- **Added as any other note:** the same checks, the same place in the note order (at the bottom, as the newest), one change in the History ("Added "<title>" from Telegram"), and live updates to the person's open devices.
- **The note limit** applies (see "Note limit" in [users.md](users.md)): at the limit, nothing is saved and the bot replies with the same message the app shows.
- **When the database can't be reached,** the bot replies "nwsnotes can't save right now. Please send it again later." (Telegram has already been answered, so it won't resend it.)
- **Too many messages:** at most 30 notes a minute from one Telegram account; past that, "Too many messages. Wait a minute and try again."

### Spoken names
- **Stored on the tab:** a new optional `spokenName` field on `Tab`, sent and checked with the tab's name, filters and placement (`POST` and `PUT /api/tabs`). Tabs without it have no spoken name.
- **Rules:** trimmed; empty means none; at most 40 characters; it must have at least one letter or digit. Normalised as above, it can't be the same as "all", as "tab", as its own tab's name, or as any other tab's name or spoken name. Error: "Another tab already uses that name." (or "…can't be "All"").
- **The same check for names:** a tab's name now also can't be the same as another tab's spoken name once normalised, so a message can never match two tabs exactly.
- **In the tab editor,** under the name box: a "Spoken name (optional)" box, with the hint "An easier name to say when sending notes by Telegram, e.g. "do it yourself" for "DIY"." It's shown whether or not Telegram is set up, as it's harmless.
- **In Settings,** the tab list shows the spoken name in grey after the tab's name, e.g. "DIY (do it yourself)".
- **History:** changing it is part of saving the tab, so it's undone with it.

### Tests
- **A fake Telegram:** in test mode the server doesn't call Telegram. Its replies are kept in memory, and `GET /api/test/telegram/sent` returns them (test mode only). The webhook is posted to directly with the test secret, using made-up messages in Telegram's format.
- **New `telegram.spec.ts`:** linking from Settings (and an expired or reused code); unlinking from Settings and with `/unlink`; a message from an unlinked account adds nothing; a note goes into the right user's notebook only; a tab's name and its spoken name put the note in that tab, with its tags; slips and punctuation still match; the longest name wins; no match goes to All; "Nothing to save after the tab name"; a several-tag filter takes the first tag; the note limit; a turned-off account; a wrong secret is refused; the note appears on an open page straight away.
- **Tab tests** gain: saving a spoken name, its rules and errors, and it showing in the Settings tab list.
- **Matching** is a shared function with its own unit tests, as it has many small cases.

### Checked in the car first
- Before building, check that Gemini on Android Auto will send a Telegram message to a bot, by trying "Hey Google, send a Telegram message to BotFather: hello".
- **If it won't,** the fallback is a Telegram group with just the person and the bot, given an easy name like "Notes", which Gemini can message like a contact. That needs the bot's group privacy setting turned off and messages from groups accepted when the sender is linked. It's left out until it's known to be needed.

### Later, not now
- Voice messages turned into text by the server.
- Editing or archiving notes from Telegram.
- A choice, per tab, of which tag to use when its filter has several in one category.
- Other messaging apps (WhatsApp, SMS).
