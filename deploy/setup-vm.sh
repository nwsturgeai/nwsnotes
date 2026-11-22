#!/usr/bin/env bash
#
# One-time setup of the Ubuntu VM for nwsnotes. Safe to run again.
#
#   sudo bash setup-vm.sh                               # first-time setup
#   sudo bash setup-vm.sh --new-password [login name]   # a new password for a user (default: admin)
#
# See README.md for the full list of steps.
set -euo pipefail

APP_USER=nwsnotes
APP_DIR=/opt/nwsnotes/app
DATA_DIR=/var/lib/nwsnotes/data
ACME_DIR=/var/lib/nwsnotes/acme
CONFIG_DIR=/etc/nwsnotes
CERT_DIR=$CONFIG_DIR/certs
CONFIG_FILE=$CONFIG_DIR/config.json
NODE_MAJOR=24

if [[ $EUID -ne 0 ]]; then
  echo "Please run with sudo: sudo bash $0" >&2
  exit 1
fi

NEW_PASSWORD=false
[[ "${1:-}" == "--new-password" ]] && NEW_PASSWORD=true
# The admin's login name (user 1), unless the config's "adminLoginName" says otherwise.
LOGIN_NAME=${2:-admin}

step() { printf '\n==> %s\n' "$*"; }

# Prints a password and a hash of it, one per line. The hash format must match
# hashPassword() in server/src/auth.ts.
generate_password_and_hash() {
  node -e '
    const crypto = require("node:crypto");
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let password = "";
    for (let i = 0; i < 32; i++) password += chars[crypto.randomInt(chars.length)];
    const N = 16384;
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(password, salt, 64, { N });
    console.log(password);
    console.log(`scrypt$${N}$${salt.toString("base64")}$${hash.toString("base64")}`);
  '
}

# Writes config.json with the given password hash (the admin's first password: once the app has made
# user 1 from it, passwords are kept with the users in the database), keeping the existing session secret and any other
# settings already in it (such as the database's, from set-database.sh).
write_config() {
  local hash=$1
  HASH="$hash" CONFIG_FILE="$CONFIG_FILE" DATA_DIR="$DATA_DIR" CERT_DIR="$CERT_DIR" ACME_DIR="$ACME_DIR" node -e '
    const fs = require("node:fs");
    const crypto = require("node:crypto");
    const file = process.env.CONFIG_FILE;
    let existing = {};
    try { existing = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
    const config = {
      ...existing,
      passwordHash: process.env.HASH,
      sessionSecret: existing.sessionSecret || crypto.randomBytes(32).toString("base64url"),
      dataDir: process.env.DATA_DIR,
      certDir: process.env.CERT_DIR,
      acmeDir: process.env.ACME_DIR,
      httpPort: 80,
      httpsPort: 443,
    };
    fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  '
  chown "$APP_USER:$APP_USER" "$CONFIG_FILE"
  chmod 600 "$CONFIG_FILE"
}

show_password() {
  cat <<EOF

  ================================================================
    Your nwsnotes login (the password is shown only once):

        Name:     admin
        Password: $1

    Save it in your password manager now.
  ================================================================
EOF
}

restart_app_if_running() {
  if runuser -u "$APP_USER" -- env PM2_HOME="/home/$APP_USER/.pm2" pm2 describe nwsnotes >/dev/null 2>&1; then
    runuser -u "$APP_USER" -- env PM2_HOME="/home/$APP_USER/.pm2" pm2 restart nwsnotes --update-env >/dev/null
    echo "App restarted."
  fi
}

if $NEW_PASSWORD; then
  [[ -f $CONFIG_FILE ]] || { echo "Run the full setup first (without --new-password)." >&2; exit 1; }
  [[ -f $APP_DIR/server.cjs ]] || { echo "The app hasn't been deployed yet." >&2; exit 1; }
  # Passwords are kept with the users in the database: the app makes a new one, and logs them out everywhere.
  runuser -u "$APP_USER" -- env NODE_ENV=production LOGIN_NAME="$LOGIN_NAME" bash -c 'cd '"$APP_DIR"' && node server.cjs --reset-password "$LOGIN_NAME"'
  restart_app_if_running
  exit 0
fi

step "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg rsync ufw certbot

if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt $NODE_MAJOR ]]; then
  step "Installing Node.js $NODE_MAJOR"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -q nodejs
fi
echo "Node $(node -v)"

if ! command -v pm2 >/dev/null; then
  step "Installing pm2"
  npm install -g pm2
fi

step "Creating the $APP_USER user and folders"
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$APP_USER"
fi
install -d -o "$APP_USER" -g "$APP_USER" -m 755 /opt/nwsnotes "$APP_DIR"
install -d -o "$APP_USER" -g "$APP_USER" -m 700 /var/lib/nwsnotes "$DATA_DIR"
install -d -o "$APP_USER" -g "$APP_USER" -m 755 "$ACME_DIR"
install -d -o root -g "$APP_USER" -m 750 "$CONFIG_DIR"
install -d -o "$APP_USER" -g "$APP_USER" -m 700 "$CERT_DIR"
chmod 755 /var/lib/nwsnotes   # certbot (root) and the app both need to reach the acme folder

step "Allowing the app to use ports 80 and 443 without running as root"
echo "net.ipv4.ip_unprivileged_port_start=80" > /etc/sysctl.d/60-nwsnotes.conf
sysctl -q --system

step "Configuring the firewall (SSH, HTTP, HTTPS only)"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
ufw status | sed 's/^/    /'

step "Making pm2 start the app when the VM boots"
pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" >/dev/null
echo "Done."

step "Setting up the deployment SSH key"
SSH_DIR=/home/$APP_USER/.ssh
install -d -o "$APP_USER" -g "$APP_USER" -m 700 "$SSH_DIR"
touch "$SSH_DIR/authorized_keys"
chown "$APP_USER:$APP_USER" "$SSH_DIR/authorized_keys"
chmod 600 "$SSH_DIR/authorized_keys"
if grep -q "nwsnotes-github-deploy" "$SSH_DIR/authorized_keys"; then
  echo "A deployment key is already installed. To make a new one, delete its line from"
  echo "$SSH_DIR/authorized_keys and run this script again."
else
  KEY_TMP=$(mktemp -d)
  ssh-keygen -q -t ed25519 -N "" -C "nwsnotes-github-deploy" -f "$KEY_TMP/key"
  cat "$KEY_TMP/key.pub" >> "$SSH_DIR/authorized_keys"
  echo
  echo "  Copy EVERYTHING between the lines below (including the BEGIN and END lines)"
  echo "  into a GitHub secret named VM_SSH_KEY:"
  echo "  ----------------------------------------------------------------"
  cat "$KEY_TMP/key"
  echo "  ----------------------------------------------------------------"
  rm -rf "$KEY_TMP"
fi

step "Creating the app configuration"
if [[ -f $CONFIG_FILE ]]; then
  echo "$CONFIG_FILE already exists; keeping the current password."
  echo "(To get a new password: sudo bash $0 --new-password <login name>)"
else
  mapfile -t secrets < <(generate_password_and_hash)
  write_config "${secrets[1]}"
  show_password "${secrets[0]}"
fi

cat <<EOF

Setup complete. Next steps (details in README.md):
  1. Add the GitHub secrets VM_HOST and VM_SSH_KEY.
  2. Merge to main (or run the Deploy workflow) so the app is copied here and started.
  3. Run: sudo bash get-certificate.sh you@example.com
EOF
