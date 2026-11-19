# Automated tests

## Automated tests
The app should have automated end-to-end tests, which use the app the way a person does: in a real browser, tapping and typing.
They should cover the main features, so that later changes (such as moving to a database) can be checked quickly and reliably.
The tests must never touch real notes: they use their own test data, starting from the same known state every time.
It should be easy to run the tests on my PC, and they should also run automatically on GitHub.
When a test fails, it should be easy to see what went wrong.

## Agreed technical decisions

### Automated tests
- **Tool:** Playwright Test (`@playwright/test`), in Chromium, the engine of Chrome on the Android tablet.
- **Where:** a new workspace, `e2e/`, with `playwright.config.ts`, the tests in `e2e/tests/*.spec.ts`, and their starting data in `e2e/fixtures/`.
- **What's tested:** the built app, served by the Express server, as in production apart from HTTPS. This is closer to what runs on the tablet than the Vite dev server.
  - The tests start their own server on its own port (3100), so they run alongside the dev servers (3000 and 5173) without clashing.
  - `npm run test:e2e` builds the client first, then runs the tests.
- **Test data, never real notes:**
  - The test server keeps its data in a temporary folder, set by a new `NWSNOTES_DATA_DIR` setting. It's only honoured outside production; production still uses `config.json`.
  - The tests start from a known set of data in `e2e/fixtures/seed.json`: a few categories (one single-select, one multi-select, with colours), a few tabs, and a mix of notes (typed, handwritten, long-form with children, and every Lifetime).
  - Before each test, the data is put back to that seed through `POST /api/test/reset`. This test-only endpoint exists only when the server is started with `NWSNOTES_TEST=1` and isn't in production. In production it doesn't exist at all, so it can't be called.
  - It also clears the push devices and resets note ids, so every test starts identically and tests don't depend on each other.
  - Tests run one at a time (one worker), because they share the one server and its data.
- **Logging in:** a setup step logs in once with the dev password and saves the session. Every test reuses it, apart from the login tests themselves.
- **Screen sizes:** every test runs twice, as two Playwright "projects":
  - **tablet:** 768×1024, touch, the Android Chrome user agent;
  - **desktop:** 1280×800, mouse.
- **Browser features:**
  - **Service workers** are blocked by default, so a cached old build can't confuse a test. They're allowed in the offline and app-update tests, and in the logout test (logging out turns off the device's reminders, which needs the service worker).
  - **Time zone and language:** the browser is set to Europe/London and en-GB, so dates show the same wherever the tests run.
  - **Notifications:** permission is granted where reminders are tested. Headless Chromium always reports `Notification.permission` as "denied", so that test also tells the page the permission is granted.
  - **New versions:** the app-update tests make a "new version" by changing the built `sw.js` the test server serves, and put it back after each test. The browser fetches that file itself, so a test can't intercept the request instead.
  - **Time:** tests that depend on time (due dates turning bold or red, the daily update check) use Playwright's clock control instead of waiting.
- **First set of tests,** one file per area:
  - **login:** wrong password, logging in, logging out.
  - **notes:** adding typed notes with tags (Enter, Ctrl+Enter to the top, long press), editing, cancelling, the "Cr."/"Due" dates.
  - **lifetime:** waiting, archive, reinstate, bin, Reset New, Archived to Bin and Empty Bin, with their confirmations and counts.
  - **tabs and filters:** switching tabs, the filter row, its counts and TOTAL, reset filters, search, and the "…" menu at narrow widths.
  - **ordering:** edit-order mode and dragging a note.
  - **multi-select:** selecting notes, All/None, and bulk tag changes.
  - **long-form:** creating, editing, autosave, cancel and delete, child notes, converting a note, matching the tab, and the formatting overlay lining up.
  - **formatting:** `*bold*`, `_underline_` and `/italic/` in the list, and words like "and/or" left alone.
  - **stylus:** drawing a handwritten note, the eraser, and pen width.
  - **settings:** categories (add, rename, reorder, colours, changing to single-select, deleting tags), tabs (add, edit, reorder, delete), stylus mode and columns.
  - **due dates:** setting, clearing and the colours over time.
  - **offline:** the server is cut off mid-test. Adding and editing still work, the offline icon shows, and the changes sync when the server comes back.
  - **live updates:** two browser windows. A change in one appears in the other.
  - **app updates and reminders:** the settings sections and their buttons. Real push delivery can't be tested, as it needs Google's push service.
- **Writing tests:** tests find things the way a person would, by their labels and text (`getByRole`, `getByLabel`), rather than by CSS classes, so restyling doesn't break them. Where that isn't possible, elements get a `data-testid`.
- **When a test fails:** Playwright keeps a screenshot, a video and a trace of the failed test, a step-by-step recording that shows each action and the page at that moment. `npx playwright show-report` opens them. `npm run test:e2e:ui` opens Playwright's UI mode, to run and watch tests one by one.
- **On GitHub:**
  - A new workflow, `.github/workflows/test.yml`, runs the tests on every pull request. The report is kept as a download when a test fails.
  - The deploy workflow also runs the tests first, so a failing test stops a deployment.
- **From now on:** each new feature or change comes with new or updated tests, as part of the same branch.
