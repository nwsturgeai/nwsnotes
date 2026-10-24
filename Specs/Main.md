I want to create an app for managing my notes.
This app will be delivered as a website.
I have created a VM in DigitalOcean to host the server side of my website.
The VM should serve the static content of my website and also include a rest API which the website can call.
The server side API will be coded in typescript and will execute using nodejs.
The browser code should be written in typescript and should use React.
This site will be for a single user (me).  I should need a password to log in, this should be a string of 32 random characters.
The site should be delivered over HTTPS - I have a domain "nwsnotes.duckdns.org" which has a DNS entry pointing to my VM.

Each note will have the following attributes:
id - a unique integer id.  Should be auto-created on the server, starting at 1, each new note takes the next id value.
titleText - a string
createdDateTime
lastModifiedDateTime - for now I will not yet add note-editing or note-deleting capability, those will come in future.
timestamps should be set by the server.  Dates should be stored in ISO 8601 format, UTC timezone.

The main app screen will show:
A list of all notes in the top 3/4 of the page.  Notes should appear in created-date order with the most recently created at the bottom of the list.  Each row should show the note title.  Rows should be separated by a thin horizontal line.
For now, if the top 3/4 of the page isn't enough space to show all notes, then scroll vertically to see the rest.  Only the top 3/4 of the screen should scroll.
There will be an area to enter a new note in the bottom 1/4 of the page - always visible even if there are more notes than fit.
For now, phone layout is not important, I will make changes later to address that use-case.

Any time a new note is entered, the website will send to the API a json blob containing all attributes of the new note.  The API will save a JSON blob to the local disk containing the current state of all notes - previously-added notes and also this new one.  Each save-file should include the timestamp in its filename.  Any and all note files created in the last week should be kept; files older than 1 week should be deleted automatically.

When the website is opened for the first time or refreshed, the site should make an call to the API to retrieve the most recently saved json blob containing all the note data.

I will add a mechanism for backing up the note data later.

Whilst the page is loading, show text "Loading...".  If there is an error (e.g. the API is unavailable) then show a page with all the details of the error.
