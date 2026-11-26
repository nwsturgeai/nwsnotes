# Stylus

## Stylus support

I will be using this website on an android device that has a stylus.
It should be possible to put the site into stylus mode.  This should be a toggle setting at the top of the settings page.
This new setting should be saved into browser local storage so that if the site is reloaded, this setting is remembered on this device.
When in stylus mode, a small icon (use fa-signature) should be displayed next to the settings cog at the right of the top header.
When in stylus mode, instead of typing a new note, I want to write the note onto an HTML canvas element.  In other words, when in stylus mode, whilst the stylus is "touched down" within the canvas, the website should capture the points that the stylus tip moves over, and should colour those black.  This should give the user the sense that they are writing onto the canvas.
Saving the note should capture the image data from the canvas and store that as the note's titleImage.  The canvas should be 80 pixels high.  When saving the image, crop down to just the area of the canvas that has anything written.
When displaying the list of notes, if a note has a title image (and no title text) then the image should be displayed, and no title text should be displayed.
Handwritten notes can still have tags the same as typed notes.

In stylus mode, the add-note area has a "Clear" button (as well as the Add button).  The Clear button should be the same size as the Add button and should use icon fa-delete-left and have no text.
The "Clear" button should be shown underneath the "Add" button - this gives more horizontal space for handwriting.
Considering the "Add" and "Clear" buttons, and all of the new note tag dropdowns: when in stylus mode, these controls should not respond to touch inputs - they should only respond to stylus or mouse inputs. Touch inputs should continue to work when not in stylus mode.

### Pen thickness

In the settings page, underneath the Stylus-mode/Columns section, and before the History section, add a new section for Pen controls. The Pen section is only shown while stylus mode is on.
For now the only control is for Pen thickness.  There are 3 possible pen thicknesses: 1.5px, 2.5px, 4.5px.  Show a set of buttons for these, with exactly one selected (colour inverted) at any time.  Clicking on one of the buttons selects that thickness.
The selected thickness should be remembered in browser local storage so that it persists on this device.
When creating/editing a canvas-based note, also when creating/editing the details of a canvas-based long-form note: when the pen is in writing mode (i.e. not eraser mode), then touching down with the pen should cause a line to be drawn on the canvas with a width given by the current pen thickness setting.
While creating or editing a long-form note with handwritten details, there are also 3 pen-thickness buttons in the editor, to the right of the eraser button, with a slightly larger than usual gap between the eraser and them. They change the same setting.

## Agreed technical decisions

### Stylus mode
- **Setting:** a "Stylus mode" switch at the top of the settings page, stored in the browser's local storage, so each device remembers its own setting. While it's on, an `fa-signature` icon sits just left of the cog in the header, the same size as the note buttons (a 16px icon in a 24px box). The icon only shows the mode (tooltip "Stylus mode is on"); clicking it does nothing.
- **Canvas:** while stylus mode is on, the title text box is hidden and a canvas takes its place, as wide as the text box would be and 80 CSS pixels high. To type a note instead, switch stylus mode off. Writing past the canvas edge is cut off.
- **What draws:** only a stylus (`pointerType` "pen") and, for testing on a computer, a mouse. Fingers and palms touching the canvas are ignored. The page doesn't scroll while writing on the canvas (`touch-action: none`).
- **Ink:** black, with rounded ends and joins, in the width chosen by the Pen thickness setting (1.5, 2.5 or 4.5 CSS pixels; default 2.5). No pressure sensitivity.
- **Pen thickness:**
  - **Settings:** a "Pen" section on the settings page, between Stylus mode/Columns and History. It's only shown while stylus mode is on: turning stylus mode on or off shows or hides it straight away. The chosen thickness is kept while it's hidden, and still used when a handwritten note is edited outside stylus mode.
  - **Buttons:** three buttons in a row, one per thickness. Each shows a short sample line drawn at that thickness, with its size in small text ("1.5px", "2.5px", "4.5px").
    - Exactly one is selected, shown with its colours inverted (accent background, light line and text) and marked as pressed for screen readers. Clicking one selects it.
  - **In the long-form editor:** the same three thicknesses as 40px square buttons, in the bottom row to the right of the eraser, with a 16px gap after the eraser and the usual 4px between them. They show whenever the eraser does (see [long-form.md](long-form.md)).
    - Each shows only a short sample line at its thickness (no text); its tooltip and accessible label are "Pen thickness 1.5px" and so on. They're a radio group, like the settings buttons, with the chosen one's colours inverted.
    - They change the same device setting as the Pen section, so a choice made in either place shows in both.
    - Choosing one also turns the eraser off, as a pen is wanted for writing.
    - They're greyed out while the details are locked, like the eraser, and in stylus mode finger taps on them are ignored.
  - **Remembered:** the choice is kept on this device in local storage (default 2.5px). An unknown stored value counts as 2.5.
  - **What it affects:** new strokes on every canvas, drawn with a stylus or mouse: the new-note canvas, editing a handwritten note, and long-form details. It doesn't change ink already drawn, or the eraser's size.
  - **Saved images:** cropping allows for the thickest pen, so thick lines aren't clipped at the edge.
- **Buttons:** "Clear" sits underneath "Add", leaving more width for the canvas; both buttons are the same width. "Add" saves the note and "Clear" wipes the canvas. Adding with nothing written shows "Nothing has been written yet." After a successful save the canvas clears. If saving fails, the error appears under the canvas and the writing is kept so you can retry. The tag dropdowns work exactly as for typed notes.
- **Saved image:** black ink on a transparent background, cropped to the written area plus a 4-pixel margin, as a PNG data URL (`data:image/png;base64,...`). The canvas always works at 2× pixel density, so ink is crisp on tablets and every image is shown at half its pixel size (the size it was written).
- **Paper:** the canvas and handwritten notes in the list sit on a light "paper" background. (The app is now always light, so this simply matches the page.)
- **Notes list:** a handwritten note shows its image at the size it was written, with the alt text "Handwritten note", and its tag pills underneath as usual. Every row in the list, typed or handwritten, has 0.2rem of padding above and below. A note's content (its title or handwriting, and its pills) is centred vertically in the row. The buttons and creation date stay at the top right, and the grip or selection circle stays the full height of the row.
- **Server checks:** exactly one of `titleText` and `titleImage`; the image must be a PNG data URL of at most 200 KB (counting the data URL's characters). The server's request size limit rises from 20 KB to 256 KB to allow for this.
- **Ignoring finger touches:** whenever the canvas is showing (stylus mode, or editing a handwritten note), finger taps on Add, Update, Cancel, Clear, the tag dropdown buttons and the lists they open do nothing, and fingers still don't draw or erase on the canvas; a stylus or mouse works as normal. Fingers can still scroll the new-note area if it overflows. Outside stylus mode, touch works everywhere as before. (See below for the red flash an ignored tap gives.) This can only be partly tested on a computer, so it is to be checked on the Android device: a palm or finger resting on the controls mustn't open a dropdown or add a note.
- **Ignored taps flash red:** whenever a finger tap on a button is ignored this way (in the new-note area, or on the long-form editor's buttons and page menu in stylus mode), the button's background goes red (white text) for 0.5 seconds, so it's clear the tap was seen but did nothing. Another ignored tap during the flash starts the half-second again. Nothing else happens.
- **Screen rotation:** if the canvas size changes (e.g. the device is rotated), anything written but not yet added is cleared.
- **Image size (accepted):** every save writes all notes, images included, to a new save-file, and a week of save-files is kept. As a guide, 1,000 handwritten notes at about 4 KB each make each save-file about 4 MB. This is accepted for now; if it becomes a problem, images can later be stored as separate files.
