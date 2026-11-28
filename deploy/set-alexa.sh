#!/usr/bin/env bash
# Turns on adding notes by Alexa (see Specs/alexa.md): stores the Alexa skill's ID in config.json, so
# requests from that skill (and no other) are answered. Run on the VM as root:
#
#   sudo bash set-alexa.sh
#
# It asks for the skill ID (Alexa developer console → the skill → "Copy Skill ID"), then restarts the app.
set -euo pipefail

CONFIG_DIR=/etc/nwsnotes
CONFIG_FILE=$CONFIG_DIR/config.json
APP_USER=nwsnotes

if [[ $EUID -ne 0 ]]; then
  echo "Run this as root: sudo bash set-alexa.sh" >&2
  exit 1
fi
if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "$CONFIG_FILE doesn't exist yet: run setup-vm.sh first." >&2
  exit 1
fi

read -rp "Paste the skill ID (Alexa developer console → your skill → Copy Skill ID): " ALEXA_SKILL_ID
ALEXA_SKILL_ID=${ALEXA_SKILL_ID// /}
if [[ ! "$ALEXA_SKILL_ID" =~ ^amzn1\.ask\.skill\.[0-9a-f-]+$ ]]; then
  echo "That doesn't look like a skill ID: it should start with amzn1.ask.skill." >&2
  exit 1
fi

# Adds the setting, keeping everything else in config.json as it is.
ALEXA_SKILL_ID="$ALEXA_SKILL_ID" CONFIG_FILE="$CONFIG_FILE" node -e '
  const fs = require("node:fs");
  const file = process.env.CONFIG_FILE;
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  config.alexaSkillId = process.env.ALEXA_SKILL_ID;
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
'
chown "$APP_USER:$APP_USER" "$CONFIG_FILE"
chmod 600 "$CONFIG_FILE"
echo "Saved the Alexa skill ID in $CONFIG_FILE."

if sudo -iu "$APP_USER" pm2 describe nwsnotes >/dev/null 2>&1; then
  sudo -iu "$APP_USER" pm2 restart nwsnotes --update-env >/dev/null
  echo "Restarted the app. Check it with: sudo -iu $APP_USER pm2 logs nwsnotes --lines 20 (it says \"Notes can be added by Alexa ...\")"
else
  echo "The app isn't running yet; Alexa will work when it's next deployed."
fi
