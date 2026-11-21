#!/bin/bash
# Run at the start of every Claude Code session (see .claude/settings.json), but only does anything
# in a cloud session: installs the project's packages, then Playwright's Chromium and ffmpeg at the
# project's own Playwright version, so the end-to-end tests use the builds they expect. (The cloud
# environment's setup script installs the system libraries Chromium needs.)
[ "$CLAUDE_CODE_REMOTE" = "true" ] || exit 0
set -e
cd "$CLAUDE_PROJECT_DIR"
npm install --no-audit --no-fund
npx playwright install chromium ffmpeg
