#!/usr/bin/env bash
#
# Gets the HTTPS certificate for nwsnotes.duckdns.org from Let's Encrypt.
# Run once, after the app has been deployed and is running:
#
#   sudo bash get-certificate.sh you@example.com
#
# The email address is only used by Let's Encrypt for expiry warnings.
# Renewal is automatic after this (certbot's timer), and each renewal copies the
# new certificate to the app and restarts it.
set -euo pipefail

DOMAIN=nwsnotes.duckdns.org
ACME_DIR=/var/lib/nwsnotes/acme

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

certbot certonly \
  --webroot -w "$ACME_DIR" \
  -d "$DOMAIN" \
  --email "$EMAIL" --agree-tos --no-eff-email --non-interactive \
  --deploy-hook /usr/local/bin/nwsnotes-cert-deploy

echo
echo "Done. Your site should now be available at https://$DOMAIN"
