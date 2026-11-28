#!/usr/bin/env bash
# Turns on syncing notes with Google Calendar (see Specs/google-calendar.md): stores the Google Cloud
# project's OAuth client ID and secret, and the site's address, in config.json. Run on the VM as root:
#
#   sudo bash set-google.sh
#
# It asks for the three settings (the secret isn't shown, nor kept in the shell's history), then restarts
# the app.
set -euo pipefail

CONFIG_DIR=/etc/nwsnotes
CONFIG_FILE=$CONFIG_DIR/config.json
APP_USER=nwsnotes
DEFAULT_URL=https://nwsnotes.com

if [[ $EUID -ne 0 ]]; then
  echo "Run this as root: sudo bash set-google.sh" >&2
  exit 1
fi
if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "$CONFIG_FILE doesn't exist yet: run setup-vm.sh first." >&2
  exit 1
fi

read -rp "Paste the OAuth client ID (Google Cloud console → APIs & Services → Credentials): " CLIENT_ID
CLIENT_ID=${CLIENT_ID// /}
if [[ ! "$CLIENT_ID" =~ \.apps\.googleusercontent\.com$ ]]; then
  echo "That doesn't look like an OAuth client ID: it should end in .apps.googleusercontent.com" >&2
  exit 1
fi

read -rsp "Paste the client secret: " CLIENT_SECRET
echo
CLIENT_SECRET=${CLIENT_SECRET// /}
if [[ -z "$CLIENT_SECRET" ]]; then
  echo "The client secret can't be empty." >&2
  exit 1
fi

read -rp "The site's address [$DEFAULT_URL]: " PUBLIC_URL
PUBLIC_URL=${PUBLIC_URL:-$DEFAULT_URL}
PUBLIC_URL=${PUBLIC_URL%/}
if [[ "$PUBLIC_URL" != https://* ]]; then
  echo "The address should start with https://" >&2
  exit 1
fi

# Adds the three settings, keeping everything else in config.json as it is.
CLIENT_ID="$CLIENT_ID" CLIENT_SECRET="$CLIENT_SECRET" PUBLIC_URL="$PUBLIC_URL" CONFIG_FILE="$CONFIG_FILE" node -e '
  const fs = require("node:fs");
  const file = process.env.CONFIG_FILE;
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  config.googleClientId = process.env.CLIENT_ID;
  config.googleClientSecret = process.env.CLIENT_SECRET;
  config.publicUrl = process.env.PUBLIC_URL;
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
'
chown "$APP_USER:$APP_USER" "$CONFIG_FILE"
chmod 600 "$CONFIG_FILE"
echo "Saved the Google Calendar settings in $CONFIG_FILE."
echo "In the Google Cloud console, the OAuth client's authorised redirect URI must be: $PUBLIC_URL/api/google/callback"

if sudo -iu "$APP_USER" pm2 describe nwsnotes >/dev/null 2>&1; then
  sudo -iu "$APP_USER" pm2 restart nwsnotes --update-env >/dev/null
  echo "Restarted the app. Check it with: sudo -iu $APP_USER pm2 logs nwsnotes --lines 20 (it says \"Google Calendar: ... user(s) connected.\")"
else
  echo "The app isn't running yet; Google Calendar will work when it's next deployed."
fi
