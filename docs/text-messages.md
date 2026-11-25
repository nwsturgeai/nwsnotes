# Texting notes in, from the car

nwsnotes has its own mobile number. Texts you send to it from your phone add notes to your notebook, and can do a few other things. Since Android Auto lets Google read and send texts by voice, you can add notes while driving without touching the phone.

## Setting it up (once, at home)

1. Go to **Settings**, then **Text messages**, and tap **Link my phone**.
2. A six-digit code appears. Text it to the number shown, from your own phone. On a phone, tapping the number opens Messages with the code filled in. The code works for 15 minutes.
3. A moment later, Settings shows **Linked to** your number.
4. Save the nwsnotes number in your phone's contacts as **nwsnotes**.

Each person links their own phone, and texts from it only ever go into their own notebook. Texts from a phone that isn't linked are ignored.

## The commands

Every text starts with a command word. Upper or lower case doesn't matter, and you don't need to say "comma" or any other punctuation.

| Text | What it does |
|---|---|
| **Add** *tab* *note* | Adds a note in that tab |
| **New** *note* | Adds a note with no tags |
| **Due** *when* | Sets a due date on the note you just added |
| **Reset New** | Makes all your New notes Active |
| **Email tab** *tab* | Emails you the notes in that tab |

A text that doesn't start with one of these is added as a note with no tags, word for word.

## Adding a note to a tab

In the car, say:

> "Hey Google, send a text to nwsnotes: **Add Shopping**, oat milk and bin bags"

This adds the note "Oat milk and bin bags", with the Shopping tab's tags, so it shows in that tab. Google reads the text back to you before sending it, so you can check it heard you correctly. Small slips, like "Shoppings" or "Shoping", still work. You can also say the word "tab" if that's easier: "Add tab shopping, eggs".

If a tab's filter has several tags in one category, the note gets the first of them.

If no tab has the name you said, everything after "Add" is the note, with no tags, and it shows in **All**.

## Adding a note with no tags

> "Hey Google, send a text to nwsnotes: **New** call the garage about the tyres"

This adds the note "Call the garage about the tyres", with no tags, so it shows in **All**.

### Spoken names

Some tab names are hard to say, or Google keeps mishearing them. Give such a tab a **spoken name**: an extra name for it, used only for texts. Edit the tab in **Settings**, fill in **Spoken name**, and save. For example, a tab called "DIY" could have the spoken name "do it yourself". After "Add" or "Email tab", you can use either name.

## Knowing it worked

- **Each saved note sends a notification** to your devices that have reminders turned on (see [Due dates and reminders](due-dates.md)), e.g. "Saved to Shopping" with the note below it. It tells you if no tab matched. These don't show in the car; they're there to check afterwards.
- **If a note couldn't be saved, you get a text back** saying why, which Android Auto reads out to you. For example, there was nothing after the tab's name, you've reached your limit of notes, or nwsnotes couldn't be reached. The note's text is still in your sent messages, to send again later.
- **A text back every time, if you'd like one:** the admin can turn this on for you. Then every text that works gets a text back too, e.g. `Saved to Shopping: "Oat milk and bin bags"`, which Android Auto reads out, so you know in the car that it worked. Ask the admin if you'd like it.

## Setting a due date

Straight after adding a note (by text or in the app), you can give it a due date with a second text:

> "Hey Google, send a text to nwsnotes: **Due tomorrow at 3pm**"

"Due date tomorrow at 3pm" works too. It sets the due date of the last note you added, as long as that was in the last 5 minutes. Notes other people have added to your notebook don't count.

- **The day:** "today", "tomorrow", a day of the week ("Friday"), or a date ("25th December", "25/12").
- **The time:** "3pm", "3:30 pm", "15:00", "half past three", "noon". With no am or pm, 7 to 11 mean the morning and 1 to 6 the afternoon, so "tomorrow at 2" is 2pm.
- **Leave out the time** and it's due at 8pm. **Leave out the day** and it's today, or tomorrow if that time has already gone.

A notification shows the date it was set to. If it couldn't be set, for example the time has already passed or it wasn't understood, you get a text back saying why.

## Resetting New notes

> "Hey Google, send a text to nwsnotes: **Reset New**"

All your New notes become Active, as with the **Reset New** button in Settings. This includes New notes shared with you that you're allowed to edit. A notification says how many changed.

## Emailing yourself a tab

To get a list of the notes in a tab, for example before going to the shop, text:

> "Hey Google, send a text to nwsnotes: **Email tab Shopping**"

nwsnotes emails you the notes the Shopping tab shows, in the same order, with any due dates, to the email address you log in with. Use a tab's name or its spoken name, or "Email tab All" for everything. Nothing is added as a note.

A notification tells you it's been sent. If it couldn't be sent, for example no tab has that name, you get a text back saying why. You can have up to 10 of these emails a day.

## Unlinking

In **Settings**, under **Text messages**, tap **Unlink**. Texts from that phone then stop adding notes.
