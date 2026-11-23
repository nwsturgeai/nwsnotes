# nwsnotes

## Testing
- After a change, run only the e2e tests that cover what changed (e.g. `npx playwright test settings.spec.ts` from `e2e/`), not the full suite. The full suite takes about 10 minutes.
- Never run the full suite locally, including before opening a pull request. It runs automatically on GitHub when a pull request is opened or updated (`.github/workflows/test.yml`); check that run's result instead.
