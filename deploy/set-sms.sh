#!/usr/bin/env bash
# Turns on adding notes by text message (see Specs/text-messages.md): stores the Twilio auth token, the
# nwsnotes number and the site's address in config.json. Run on the VM as root:
#
#   sudo bash set-sms.sh
#
# It asks for the three settings (the auth token isn't shown, nor kept in the shell's history), then
# restarts the app.
set -euo pipefail

CONFIG_DIR=/etc/nwsnotes
CONFIG_FILE=$CONFIG_DIR/config.json
APP_USER=nwsnotes
DEFAULT_URL=https://nwsnotes.duckdns.org

if [[ $EUID -ne 0 ]]; then
  echo "Run this as root: sudo bash set-sms.sh" >&2
  exit 1
fi
if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "$CONFIG_FILE doesn't exist yet: run setup-vm.sh first." >&2
  exit 1
fi

read -rsp "Paste the Twilio auth token (Twilio Console → Account info → Auth Token): " TWILIO_AUTH_TOKEN
echo
if [[ ! "$TWILIO_AUTH_TOKEN" =~ ^[0-9a-f]{32}$ ]]; then
  echo "That doesn't look like a Twilio auth token: it should be 32 letters (a-f) and digits." >&2
  exit 1
fi

read -rp "The nwsnotes number, in international form (e.g. +447700900123): " SMS_NUMBER
SMS_NUMBER=${SMS_NUMBER// /}
if [[ ! "$SMS_NUMBER" =~ ^\+[1-9][0-9]{6,14}$ ]]; then
  echo "That isn't in international form: it should start with + and the country code, e.g. +447700900123." >&2
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
TWILIO_AUTH_TOKEN="$TWILIO_AUTH_TOKEN" SMS_NUMBER="$SMS_NUMBER" PUBLIC_URL="$PUBLIC_URL" CONFIG_FILE="$CONFIG_FILE" node -e '
  const fs = require("node:fs");
  const file = process.env.CONFIG_FILE;
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  config.twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
  config.smsNumber = process.env.SMS_NUMBER;
  config.publicUrl = process.env.PUBLIC_URL;
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
'
chown "$APP_USER:$APP_USER" "$CONFIG_FILE"
chmod 600 "$CONFIG_FILE"
echo "Saved the text message settings in $CONFIG_FILE."
echo "In Twilio, set the number's \"A message comes in\" webhook to: $PUBLIC_URL/api/sms/incoming (HTTP POST)."

if sudo -iu "$APP_USER" pm2 describe nwsnotes >/dev/null 2>&1; then
  sudo -iu "$APP_USER" pm2 restart nwsnotes --update-env >/dev/null
  echo "Restarted the app. Check it with: sudo -iu $APP_USER pm2 logs nwsnotes --lines 20 (it says \"Notes can be texted to ...\")"
else
  echo "The app isn't running yet; text messages will work when it's next deployed."
fi
