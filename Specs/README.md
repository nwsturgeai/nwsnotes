# nwsnotes spec

The app's requirements and agreed technical decisions, one file per area. Each file has the
requirements first, then the "Agreed technical decisions" for that area.

| File | What it covers |
| --- | --- |
| [overview.md](overview.md) | What the app is, code and tooling, login, appearance, the header and settings page |
| [notes.md](notes.md) | Notes and the main screen, the new-note area, columns, editing, note ordering, adding at the top |
| [tags.md](tags.md) | Categories and tags, tag order, colours, full-tag-list mode, multi-select |
| [tabs.md](tabs.md) | Tabs (along the top or down the left), tab editing, additional tab filters, search |
| [long-form.md](long-form.md) | Long-form notes and their child notes |
| [stylus.md](stylus.md) | Stylus mode, the eraser, pen thickness |
| [formatting.md](formatting.md) | Text formatting (bold, underline, italic, strikethrough, highlight, tickboxes) |
| [lifetime.md](lifetime.md) | Lifetime: New, Active, Waiting, Archived, Bin |
| [due-dates.md](due-dates.md) | Due dates and reminders |
| [offline-and-updates.md](offline-and-updates.md) | Offline use, live updates, the Android app, app updates |
| [data.md](data.md) | The API, the database (Supabase), history and revert, backups, save files |
| [users.md](users.md) | Several users with separate notebooks: accounts, logging in, forgotten passwords, the users page, per-user data |
| [server-errors.md](server-errors.md) | The admin's view of the server's recent errors and warnings |
| [sharing.md](sharing.md) | Sharing tags with other users: permission levels, "Shared with me", global note and tag ids |
| [text-messages.md](text-messages.md) | Adding notes by text message (e.g. dictated in the car): the Twilio number, linking phones, choosing a tab, spoken names for tabs, notifications |
| [alexa.md](alexa.md) | Adding notes by Alexa (proposal, not built): a private skill, linking Alexa, the same commands as texts, what Alexa says |
| [docs.md](docs.md) | Help pages: public static HTML pages written in Markdown, served by the same server |
| [hosting.md](hosting.md) | The VM and deployment |
| [testing.md](testing.md) | Automated tests |
| [google-calendar.md](google-calendar.md) | Two-way sync with Google Calendar: connecting, events and notes both ways, tags as hashtags |
| [icons/](icons/README.md) | Icon designs kept for later, not yet used in the app |
