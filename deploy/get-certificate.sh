#!/usr/bin/env bash
#
# Gets the HTTPS certificate for nwsnotes.com from Let's Encrypt. Safe to run again.
# Run after the app has been deployed and is running:
#
#   sudo bash get-certificate.sh you@example.com
#
# The email address is only used by Let's Encrypt for expiry warnings.
# The certificate also covers www.nwsnotes.com and the old nwsnotes.duckdns.org when they point at
# this VM, so those addresses still work (the app sends them on to nwsnotes.com).
# Renewal is automatic after this (certbot's timer), and each renewal copies the
# new certificate to the app and restarts it.
set -euo pipefail

DOMAIN=nwsnotes.com
OTHER_NAMES=(www.nwsnotes.com nwsnotes.duckdns.org)
CERT_NAME=nwsnotes
OLD_CERT_NAME=nwsnotes.duckdns.org
APP_USER=nwsnotes
ACME_DIR=/var/lib/nwsnotes/acme
CERT_DIR=/etc/nwsnotes/certs
HOOK=/usr/local/bin/nwsnotes-cert-deploy

if [[ $EUID -ne 0 ]]; then
  echo "Please run with sudo: sudo bash $0 you@example.com" >&2
  exit 1
fi
EMAIL=${1:-}
if [[ -z $EMAIL ]]; then
  echo "Usage: sudo bash $0 you@example.com" >&2
  exit 1
fi

status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://localhost/" || true)
if [[ $status == "000" ]]; then
  echo "The app doesn't seem to be running on port 80 yet." >&2
  echo "Deploy it first (merge to main, or run the Deploy workflow in GitHub), then try again." >&2
  exit 1
fi

# The address Let's Encrypt will reach a name at must be this VM's, or the whole request fails.
my_ip=$(curl -s --max-time 5 https://api.ipify.org || true)
points_here() {
  local ip
  ip=$(getent ahostsv4 "$1" | awk 'NR==1 { print $1 }')
  [[ -n $ip && ( -z $my_ip || $ip == "$my_ip" ) ]]
}
if ! points_here "$DOMAIN"; then
  echo "$DOMAIN doesn't point at this VM (${my_ip:-its IP address}) yet." >&2
  echo "Add an A record for it at your domain registrar, wait a few minutes, then try again." >&2
  exit 1
fi
names=(-d "$DOMAIN")
for name in "${OTHER_NAMES[@]}"; do
  if points_here "$name"; then
    names+=(-d "$name")
  else
    echo "Leaving out $name: it doesn't point at this VM."
  fi
done

# Copies the certificate where the app can read it and restarts the app, after each issue or renewal.
cat > "$HOOK" <<HOOK_SCRIPT
#!/usr/bin/env bash
# Run by certbot after the nwsnotes certificate is issued or renewed:
# copies it where the app can read it and restarts the app.
set -euo pipefail
LIVE=/etc/letsencrypt/live/$CERT_NAME
install -o $APP_USER -g $APP_USER -m 600 "\$LIVE/fullchain.pem" $CERT_DIR/fullchain.pem
install -o $APP_USER -g $APP_USER -m 600 "\$LIVE/privkey.pem" $CERT_DIR/privkey.pem
runuser -u $APP_USER -- env PM2_HOME=/home/$APP_USER/.pm2 pm2 restart nwsnotes --update-env \\
  || echo "Certificate copied, but the app isn't running yet; it will use it when it starts."
HOOK_SCRIPT
chmod 755 "$HOOK"

certbot certonly \
  --webroot -w "$ACME_DIR" \
  --cert-name "$CERT_NAME" "${names[@]}" \
  --email "$EMAIL" --agree-tos --no-eff-email --non-interactive \
  --deploy-hook "$HOOK"
# certbot only runs the hook for a new certificate; run it anyway, in case this one was already there.
"$HOOK"

# The certificate from before the move to nwsnotes.com, which this one replaces.
if [[ -d /etc/letsencrypt/live/$OLD_CERT_NAME ]]; then
  certbot delete --cert-name "$OLD_CERT_NAME" --non-interactive
fi

echo
echo "Done. Your site should now be available at https://$DOMAIN"
