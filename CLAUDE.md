# nwsnotes

## Testing
- After a change, run only the e2e tests that cover what changed (e.g. `npx playwright test settings.spec.ts` from `e2e/`), not the full suite. The full suite takes about 10 minutes.
- Run the full suite only when asked, or once before opening a pull request.
