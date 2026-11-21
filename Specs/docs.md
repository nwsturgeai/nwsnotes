# Documentation pages

## Requirements

The app has help pages, such as an introduction guide for new users, served as static HTML pages by the same server.

- They're public: anyone can read them without logging in, so someone who has just been sent a password can read the introduction first.
- They're written as simple text files in the repository and published with the app on every deployment.
- They look like part of nwsnotes, read well on a phone, and have a way back to the app.
- The installed app can open them offline.
- The app links to them: a "Help" link in Settings, and "New here? Read the introduction" on the login page.
- **The first page is the introduction:** at its top, a link to the help contents; then a basic introduction to the app, why people might want to use it, and how to use it in a basic way. The owner writes the introduction first; the other help pages are written after that.

## Agreed technical decisions

### Writing the pages
- **Markdown source** in `docs/` at the repository root (next to `Specs/`), one file per page, plus `docs/images/` for screenshots and `docs/docs.css` for the pages' look.
- **`docs/index.md`** is the introduction, at `/docs/`: the first page anyone sees. It starts with a link to the contents, then the introduction itself, written by the owner.
- **`docs/contents.md`** is the contents page, at `/docs/contents/`. Its list of links sets the pages' order (the introduction first), used for each page's "Previous" and "Next" links.
- Each page's title is its first `# heading`.
- To start with, there's `index.md` as a placeholder for the owner to fill in, and `contents.md` listing just the introduction. The other pages come later.

### Building them
- `npm run build` turns each `docs/<name>.md` into `client/dist/docs/<name>/index.html` (`index.md` becomes `client/dist/docs/index.html`), and copies `docs.css`, `images/` and the app's font (`docs/font.woff2`). It's done by a small Vite plugin in `client/vite.config.ts` (the work is in `client/docsBuild.ts`, using the `marked` library), which adds the pages to the build before the service worker is made, so they're saved for offline use.
- **Previewing while writing:** with `npm run dev`, the dev server (port 5173) builds the pages afresh on each request, so saving a `.md` file and reloading the page shows the change. A broken link shows as an error message instead of the page.
- **Addresses:** `/docs/` for the introduction, `/docs/contents/` for the contents and `/docs/<name>/` for each other page. Links between pages are written in the Markdown as `name.md` and turned into those addresses.
- **One shared layout** for every page:
  - a header with "nwsnotes help" (a link to the introduction), "Contents" and "← Back to the app" (a link to `/`);
  - the page;
  - "Previous" and "Next" links at the bottom.
- The pages have no scripts, so they work with the server's security headers (helmet's default Content Security Policy) unchanged.
- **The look:** the app's colours, fonts and accent, a comfortable reading width (about 40rem), images shrunk to fit, and at least 44px-tall tap targets for links in lists. It works on a phone, the tablet and a PC.
- **Checked when building:** the build fails if a page links to a page or image that doesn't exist, or if a page isn't in the contents list.

### Serving them
- **Public:** the server already serves everything in `client/dist` without a login, so the pages need no login check.
- **Missing pages:** today any unknown address gets the app. Addresses under `/docs/` that don't exist get a plain 404 page ("This help page doesn't exist", with a link to the contents) instead.
- **Service worker:** `/docs/` is added to `navigateFallbackDenylist`, so the installed app doesn't show itself instead of a help page. The pages, `docs.css` and images are in the precache (the existing `globPatterns` already include `html`, `css`, `svg` and `png`), so they open offline in the installed app.

### Links from the app
- **Settings:** a "Help" section, just above Account, with a "Help pages" link to `/docs/`.
- **Login page:** under the form, "New here? Read the introduction" linking to `/docs/`.
- Both open in the same window. The pages' "← Back to the app" link returns.

### Tests
- A new `docs.spec.ts`:
  - `/docs/` (the introduction) opens without a login and links to the contents; the contents lists the pages, and each page opens with its title, "← Back to the app" and working "Previous" and "Next" links;
  - a missing `/docs/nothing/` gives a 404 with a link to the contents;
  - the Settings "Help pages" link and the login page's link reach the help pages.
