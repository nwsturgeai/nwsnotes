# Icon designs

Icons designed for the app but not used in it yet, kept here so they can be picked up later. They aren't
in `client/public`, so they aren't shipped with the app.

| File | What it is |
| --- | --- |
| [people-arrow.svg](people-arrow.svg) | People with a thick arrow pointing into them from the left (design "C1"). The arrow's point reaches the middle person's shoulder, with a gap cut out of the people round it; the left-hand person is cut away completely. No use decided yet. |

## How they're drawn

They're built the same way as the sharing icons in `client/src/sharingIcons.tsx`:

- Font Awesome Free solid icons (`users`, `arrow-right`, ...) as the shapes, with `fill="currentColor"`
  so they take the text colour.
- The gap round an overlapping shape is an SVG mask: the shape drawn in black with a thick black outline,
  over a white rectangle, hides the people underneath it.
- `people-arrow.svg` is 878 x 532 units: the arrow from the left edge, then the 640 x 512 people icon. Shown
  at 1em high it's about 1.65em wide.

To use one in the app, copy its paths into a React component like `SharingIcons`, giving the mask an id of
its own per copy (`useId()`), as several copies of one icon can be on a page at once.
