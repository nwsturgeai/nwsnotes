#!/usr/bin/env bash
# Turns on sending email through Brevo (see "Emailing a tab" in Specs/text-messages.md): stores the Brevo
# API key and the sender's address in config.json. Run on the VM as root:
#
#   sudo bash set-email.sh
#
# It asks for the key (not shown, nor kept in the shell's history) and the sender, then restarts the app.
set -euo pipefail

CONFIG_DIR=/etc/nwsnotes
CONFIG_FILE=$CONFIG_DIR/config.json
APP_USER=nwsnotes
DEFAULT_FROM=noreply@nwsnotes.com

if [[ $EUID -ne 0 ]]; then
  echo "Run this as root: sudo bash set-email.sh" >&2
  exit 1
fi
if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "$CONFIG_FILE doesn't exist yet: run setup-vm.sh first." >&2
  exit 1
fi

read -rsp "Paste the Brevo API key (Brevo → SMTP & API → API Keys): " BREVO_API_KEY
echo
BREVO_API_KEY=${BREVO_API_KEY// /}
if [[ ! "$BREVO_API_KEY" =~ ^xkeysib-[A-Za-z0-9-]+$ ]]; then
  echo "That doesn't look like a Brevo API key: it should start with xkeysib-. (An SMTP key, starting xsmtpsib-, won't work.)" >&2
  exit 1
fi

read -rp "The sender's address, on your domain authenticated in Brevo [$DEFAULT_FROM]: " EMAIL_FROM
EMAIL_FROM=${EMAIL_FROM:-$DEFAULT_FROM}
if [[ ! "$EMAIL_FROM" =~ ^[^[:space:]@]+@[^[:space:]@.]+(\.[^[:space:]@.]+)+$ ]]; then
  echo "That isn't an email address." >&2
  exit 1
fi

# Adds the two settings, keeping everything else in config.json as it is.
BREVO_API_KEY="$BREVO_API_KEY" EMAIL_FROM="$EMAIL_FROM" CONFIG_FILE="$CONFIG_FILE" node -e '
  const fs = require("node:fs");
  const file = process.env.CONFIG_FILE;
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  config.brevoApiKey = process.env.BREVO_API_KEY;
  config.emailFrom = process.env.EMAIL_FROM;
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
'
chown "$APP_USER:$APP_USER" "$CONFIG_FILE"
chmod 600 "$CONFIG_FILE"
echo "Saved the email settings in $CONFIG_FILE."

if sudo -iu "$APP_USER" pm2 describe nwsnotes >/dev/null 2>&1; then
  sudo -iu "$APP_USER" pm2 restart nwsnotes --update-env >/dev/null
  echo "Restarted the app. Check it with: sudo -iu $APP_USER pm2 logs nwsnotes --lines 20 (it says \"Emails are sent from ...\")"
else
  echo "The app isn't running yet; email will work when it's next deployed."
fi
