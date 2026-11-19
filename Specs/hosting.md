# Hosting and deployment

## Agreed technical decisions

### Hosting (Ubuntu VM)
- App code lives in `/opt/nwsnotes`, run by a dedicated `nwsnotes` user under pm2. pm2 starts the app on boot.
- Node serves the site directly: HTTPS on port 443; port 80 only redirects to HTTPS and answers Let's Encrypt certificate checks.
- The VM allows normal users to listen on ports 80 and up (`net.ipv4.ip_unprivileged_port_start=80`), so the app doesn't run as root.
- Certificate: Let's Encrypt via `certbot` (webroot mode), renewing automatically. On renewal a hook copies the certificate to `/etc/nwsnotes/certs` and restarts the app.
- Firewall (ufw) allows only ports 22, 80 and 443.

### Deployment
- On push to `main`, GitHub Actions builds the client and server, copies the build to the VM over SSH and reloads the app in pm2.
- GitHub secrets needed: `VM_HOST` and `VM_SSH_KEY` (a private key allowed to log in as the `nwsnotes` user).
- One-time VM setup is done with scripts in `deploy/`, described in `README.md`.
