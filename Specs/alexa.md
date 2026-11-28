# Alexa: dictating notes to a smart speaker (proposal, not built)

A proposal for review. The requirements and technical decisions below are suggestions until agreed; the questions still to decide are at the end.

## Requirements

People want to add notes by voice at home, without picking up a phone: standing in the kitchen, they say "Alexa, ask nwsnotes to add Shopping oat milk and bin bags", and the note "Oat milk and bin bags" is added to their own notebook, with the Shopping tab's tags. Alexa says "Saved to Shopping."

This works like adding notes by text message (see [text-messages.md](text-messages.md)): the same command words, the same way of choosing a tab, the same spoken names for tabs. What's different is that Alexa always answers out loud, for free, so there's no need for texts back or the admin's confirmations setting.

### A private skill, not a published one
- nwsnotes has its own Alexa skill, made by the admin in Amazon's Alexa developer console. It's never published in the Alexa skill store, so Amazon never reviews it, and nobody outside nwsnotes can find or use it.
- **On the admin's own Amazon account,** the skill works on every Echo registered to that account, as long as it stays in development mode.
- **For other nwsnotes users** with their own Amazon accounts, the admin invites their Amazon email address to the skill's beta test (see "Questions to decide": a beta test lasts at most 90 days).
- It costs nothing: there's no charge for the skill, and Alexa sends each request straight to the nwsnotes server, so there's no AWS Lambda.

### Linking Alexa
- Settings has an "Alexa" section under "Text messages". While not linked, it has a "Link Alexa" button. That shows a code and: "Say "Alexa, ask nwsnotes to link <code>"." Once Alexa has heard it, the page shows "Linked to Alexa" with an "Unlink" button.
- Each nwsnotes user can link one Alexa account, and each Alexa account can be linked to only one nwsnotes user (see "Questions to decide" for a household sharing one Echo).
- If Alexa hears something with no linked account, it says: "This Alexa isn't linked to nwsnotes yet. In nwsnotes, go to Settings, Alexa, and press Link Alexa."

### What to say
- **One go:** "Alexa, ask nwsnotes to <command>" (or "tell nwsnotes to", or "ask nwsnotes", without "to"). Alexa does it, answers and stops listening.
- **Several in a row:** "Alexa, open nwsnotes". Alexa says "What would you like to add?" and keeps listening after each answer ("Saved to Shopping. Anything else?"), so commands can follow without "Alexa, ask nwsnotes" each time. Saying "stop", "no" or "that's all", or saying nothing, ends it.
- **The commands** are the ones texts use:
  - **Add <tab name> <title>:** a note in the named tab (by its name or spoken name), with the tab's tags. If no tab matches, everything after "add" is the title, with no tags.
  - **New <title>,** or **Note <title>:** a note with no tags, so it shows in All. ("Ask nwsnotes to note call the plumber" sounds natural.)
  - **Due <when>:** sets the due date of the note just added, as by text: "Alexa, ask nwsnotes, due tomorrow at 3pm".
  - **Reset New:** every New note becomes Active.
  - **Email tab <tab name>:** emails a summary of that tab.
- **Every command needs its command word.** Alexa can only pass on free speech after a fixed word, so "Alexa, ask nwsnotes oat milk" isn't understood. Alexa says: "Sorry, I didn't catch that. Start with add, new, due, reset new or email tab. For example: add Shopping oat milk."
- **"Help"** gets the same examples.

### What Alexa says
- **A saved note:** "Saved to <tab name>." or "Saved to All." Then, when they apply: "No tab matched, so it has no tags." / "That tab doesn't show New notes." / "It was too long, so I cut it short."
- **A due date set:** "Due <when, spoken: e.g. Tuesday 25th November at 3pm>."
- **Reset New:** "<n> notes made Active." or "There were no New notes."
- **A tab email:** "Emailing <tab name>." (The result comes as a notification; see the technical decisions.)
- **Failures** say why, with the same reasons as texts, worded to be heard rather than read: e.g. "Not saved: you've reached your limit of 1000 notes." or "Not saved: nwsnotes can't save right now. Please try again later."
- **Alexa doesn't read the note back,** so answers stay short. The Alexa app on the person's phone shows what Alexa heard, if they want to check.

### Notifications
- **Failures are also a notification,** with the heading "Not saved" and what Alexa heard, so the note can be added by hand later. Unlike a text, a spoken note isn't kept anywhere else.
- **Saved notes get no notification,** as Alexa has already said so (see "Questions to decide").

### Spoken names for tabs
- A tab's spoken name (see [text-messages.md](text-messages.md)) works for Alexa as for texts. The tab editor's hint becomes: "An easier name to say when adding notes by text message or Alexa, e.g. "do it yourself" for "DIY"."

### Costs
- Nothing: Alexa skills, the developer account and the requests to nwsnotes are free.

## Proposed technical decisions

### The skill (set up once by the admin)
- **In the Alexa developer console** (developer.amazon.com, signed in with the admin's Amazon account): create a custom skill, "Provision your own" as the backend, English (UK) as its language. The steps go in `README.md` ("Adding notes by Alexa").
- **The interaction model** is kept in the repository, `deploy/alexa-model.json`, to paste into the console's JSON editor, so changes to it are reviewed like code:
  - an intent for each command, each with one `AMAZON.SearchQuery` slot, `words`, after its fixed word: `AddIntent` ("add {words}"), `NewIntent` ("new {words}", "note {words}"), `DueIntent` ("due {words}", "due date {words}"), `EmailTabIntent` ("email tab {words}", "email {words}"), with a few variants of each ("to add {words}", "add to {words}");
  - `ResetNewIntent` ("reset new"), with no slot;
  - `LinkIntent` ("link {code}"), with a `code` slot of type `AMAZON.NUMBER`, so a spoken 6-digit code arrives as digits;
  - Amazon's required intents: `AMAZON.HelpIntent`, `AMAZON.StopIntent`, `AMAZON.CancelIntent`, `AMAZON.NavigateHomeIntent` and `AMAZON.FallbackIntent`.
- **The endpoint:** "HTTPS", `https://nwsnotes.com/api/alexa`, with "My development endpoint has a certificate from a trusted certificate authority" (Let's Encrypt is one).
- **Settings on the VM,** in `/etc/nwsnotes/config.json`: `alexaSkillId` (the skill's ID, `amzn1.ask.skill.…`). `deploy/set-alexa.sh` asks for it and restarts the app, like `set-sms.sh`.
- **Turned off when not set up:** without `alexaSkillId`, the server has no Alexa route and Settings has no "Alexa" section. Development and the tests always have it on, with a fake (see Tests).

### Checking it's Alexa
Amazon requires every self-hosted skill to check each request, and its certification tests send bad ones to make sure they're refused. Even unpublished, the route is open to the internet, so the server checks all of these, in its own code like the Twilio check, and answers 400 to anything that fails:
- **The signature:** the `SignatureCertChainUrl` header must be `https://s3.amazonaws.com/echo.api/…` (host `s3.amazonaws.com`, any case; path starting `/echo.api/` after normalising `..`; port 443 if given). The certificate chain from there must be in date, lead to a trusted root (Node's own list), and its first certificate must name `echo-api.amazon.com`. The `Signature-256` header must be the base64 RSA-SHA256 signature of the raw request body, by that certificate's key. Certificates are kept in memory by URL until they expire.
- **The time:** `request.timestamp` must be within 150 seconds of now.
- **The skill:** `context.System.application.applicationId` must be `alexaSkillId`. This also stops other people's skills from sending requests here.
- **The raw body** is needed for the signature, so the route reads it with `express.raw` (64 KB limit) and parses the JSON itself.

### Answering
- **Alexa's JSON format:** `{ version: "1.0", response: { outputSpeech: { type: "PlainText", text }, shouldEndSession } }`, with a `reprompt` when the session stays open ("Anything else?").
- **One go or several:** a `LaunchRequest` ("open nwsnotes") opens a session. An `IntentRequest` with `session.new` true is a one-go command and ends the session; one inside an open session keeps it open. `SessionEndedRequest` gets an empty answer.
- **Within 8 seconds:** Alexa gives up after 8. So the tab email is answered "Emailing <tab name>." as soon as the tab is found, and sent after the answer; whether it was sent comes as the notification texts already get ("Emailed <tab name>" or "Not emailed").

### Reusing the text-message code
- **The words become a text:** each intent's fixed word and its `words` slot are put back together ("add" + "shopping oat milk" → "add shopping oat milk") and handled by the same code as a text, from `readSmsCommand` on: the tab matching, spoken names, `readSpokenDue`, Reset New and tab emails all come for free.
- **One shared core:** the part of `SmsNotes.received` after the phone is identified (turned-off accounts, the rate limit, reading the command and carrying it out) moves into a module both use, which returns what happened (saved to which tab, cut short, due set, failed and why) rather than a text. Text messages turn that into their reply text and notifications as now; Alexa turns it into speech. Text messages behave exactly as before.
- **The rate limit:** the same 20 commands in 10 minutes, counted for each Alexa account.
- **The History** says "by Alexa" (e.g. "Added "Oat milk and bin bags" by Alexa"), a new `ChangeSource`, `alexa`.
- **Capital letters:** Alexa sends the words in lower case. The title's first letter is put in upper case, as for texts, but the rest stays as heard, so names lose their capitals ("Ring dave").
- **Opt-out words** (STOP etc.) are a Twilio matter, so they're not checked for Alexa.

### Linking
- **Stored with the user,** in the `users` table's `data`: `alexaUserId` (Alexa's `context.System.user.userId`) and `alexaLinkedDateTime`, as for phones: not in the History, backups or save-files; linking an Alexa account takes it from anyone else it was linked to.
- **Codes:** "Link Alexa" calls `POST /api/me/alexa/link-code`, which returns a 6-digit code, made, kept and expired as text-message codes are (15 minutes, memory only, works once). `LinkIntent` with that code links the Alexa account, says "Linked. You can now add notes to nwsnotes." and sends the "Alexa linked" notification.
- **Guessing codes:** after 5 wrong codes from one Alexa account in 15 minutes, `LinkIntent` stops checking for that account until the 15 minutes are up ("Too many wrong codes. Wait a few minutes and make a new one in Settings.").
- **Showing it:** `GET /api/me/alexa` returns `{ linked: false }` or `{ linked: true, linkedDateTime }`. "Unlink", after "Unlink Alexa? It will no longer add notes.", calls `DELETE /api/me/alexa`.
- **A new userId:** Alexa gives an account a new `userId` if the skill is turned off and on again in the Alexa app, so it needs linking again. Settings says so under "Linked to Alexa".
- **The users page** shows an "Alexa" label on the rows of users who have linked it. `UserSummary` gains `alexaLinked`.

### Logging
- **One line in the server's log for each request,** like texts: e.g. `Alexa …4f2a: AddIntent, saved as user 1's note 42, in tab 3.` The outcomes: refused (naming which check failed), not linked, linked, a wrong code, too many codes, too many commands, a turned-off account, and each command's outcomes as for texts.
- **Never the words,** and only the last 4 characters of the Alexa `userId`.

### Tests
- **A fake Alexa:** in test mode the route is on, with a test skill ID, and trusts a test certificate made for the tests instead of Amazon's: requests are signed with its key, and its `SignatureCertChainUrl` is served by the test server itself. Every other check is the same.
- **New `alexa.spec.ts`:** linking from Settings (a wrong, expired or reused code; too many wrong codes); unlinking; an unlinked account gets the "isn't linked" answer and adds nothing; each command (add to a tab, by spoken name, no match, new, note, due, reset new, email tab) with what Alexa says and the History entry; a session opened with "open nwsnotes" staying open, and a one-go command ending; help and fallback; the failure answers and their notifications; the rate limit; and refusals for a wrong signature, a certificate URL that isn't Amazon's, an old timestamp and another skill's ID.
- **Unit tests** for the certificate URL rules and for putting the intent's words back together.
- **`text-messages.spec.ts`** is run after the shared core is moved, to show texts are unchanged.

### Later, not now
- Asking Alexa what's in a tab ("Alexa, ask nwsnotes what's on Shopping"), read out loud.
- Telling apart the people in a household who share one Echo by their Alexa voice profiles (see "Questions to decide").
- Reminders spoken by the Echo when a note is due.

## Questions to decide

1. **The skill's name.** Alexa only answers to a name it can pronounce, and "nwsnotes" isn't a word. The choices are spelling it out, "n. w. s. notes" (said "en double-you ess notes"), or a different spoken name such as "my notebook". Which is easier to say every day?
2. **Other people's Amazon accounts.** A beta test lasts at most 90 days, after which the admin has to start a new one and invite people again. Is it enough that only the admin's account (and so the Echos in the admin's home) can use it? Or should other users be invited, accepting the renewal every 90 days?
3. **A household sharing one Echo.** Everyone talking to the admin's Echo has the same Alexa account, so all their notes would go to one nwsnotes user. If each person has an Alexa voice profile, Alexa can say who's speaking (`context.System.person.personId`), and each voice profile could be linked to its own nwsnotes user instead. Is that needed now, or later?
4. **A notification for each saved note,** as texts get. The proposal is none, since Alexa has already said it was saved. Would one be useful anyway, to check afterwards what Alexa heard?
5. **Reading the note back.** "Saved to Shopping: oat milk and bin bags" catches mishearing straight away, but makes every answer longer. Read it back, or not?
