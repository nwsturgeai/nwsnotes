I want to create an app for managing my notes and to-do lists.
This app will be delivered as a website.
I have created a VM in DigitalOcean to host the server side of my website.
The VM should serve the static content of my website and also include a rest API which the website can call.
The server side API will be coded in typescript and will execute using nodejs.
The browser code should be written in typescript and should use React.

Each note will have the following attributes:
Id - a unique integer id.  Should be auto-created, starting at 1, each new note takes the next id value.
TitleText - a string
DetailsText - a string
CreatedDateTime
LastModifiedDateTime

The main app screen will show:
A list of all notes in the top 3/4 of the page
There will be an area to enter a new note in the bottom 1/4 of the page.

Any time a new note is entered, the website will send to the API a json blob containing all attributes of all notes.  The API will save this new blob to the local disk.  Each save-file should include the timestamp in its filename.

When the website is opened for the first time or refreshed, the site should make an call to the API to retrieve the most recently saved json blob containing all the note data.
