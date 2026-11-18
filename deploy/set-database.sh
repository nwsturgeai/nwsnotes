#!/usr/bin/env bash
# Connects the app to its Supabase database: stores the connection string in config.json and
# Supabase's SSL certificate next to it. Run on the VM as root:
#
#   sudo bash set-database.sh prod-ca-2021.crt
#
# It asks for the connection string (it isn't shown, nor kept in the shell's history), then restarts the app.
set -euo pipefail

CONFIG_DIR=/etc/nwsnotes
CONFIG_FILE=$CONFIG_DIR/config.json
CA_FILE=$CONFIG_DIR/supabase-ca.crt
APP_USER=nwsnotes

if [[ $EUID -ne 0 ]]; then
  echo "Run this as root: sudo bash set-database.sh <certificate file>" >&2
  exit 1
fi
if [[ $# -ne 1 || ! -f "$1" ]]; then
  echo "Give Supabase's SSL certificate file (Database settings → SSL configuration → Download certificate)." >&2
  exit 1
fi
if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "$CONFIG_FILE doesn't exist yet: run setup-vm.sh first." >&2
  exit 1
fi

read -rsp "Paste the connection string (Connect → Session pooler), with your database password in it: " DATABASE_URL
echo
if [[ "$DATABASE_URL" != postgresql://* && "$DATABASE_URL" != postgres://* ]]; then
  echo "That doesn't look like a connection string: it should start with postgresql://" >&2
  exit 1
fi
if [[ "$DATABASE_URL" == *"[YOUR-PASSWORD]"* ]]; then
  echo "Replace [YOUR-PASSWORD] in it with the database password first." >&2
  exit 1
fi

install -o "$APP_USER" -g "$APP_USER" -m 644 "$1" "$CA_FILE"

# Adds the two settings, keeping everything else in config.json as it is.
DATABASE_URL="$DATABASE_URL" CONFIG_FILE="$CONFIG_FILE" CA_FILE="$CA_FILE" node -e '
  const fs = require("node:fs");
  const file = process.env.CONFIG_FILE;
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  config.databaseUrl = process.env.DATABASE_URL;
  config.databaseCaFile = process.env.CA_FILE;
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
'
chown "$APP_USER:$APP_USER" "$CONFIG_FILE"
chmod 600 "$CONFIG_FILE"
echo "Saved the database settings in $CONFIG_FILE and the certificate in $CA_FILE."

if sudo -iu "$APP_USER" pm2 describe nwsnotes >/dev/null 2>&1; then
  sudo -iu "$APP_USER" pm2 restart nwsnotes --update-env >/dev/null
  echo "Restarted the app. Check it connected with: sudo -iu $APP_USER pm2 logs nwsnotes --lines 20"
else
  echo "The app isn't running yet; it will use the database when it's next deployed."
fi
