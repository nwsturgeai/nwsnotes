# nwsnotes

A personal notes website: a React front end and an Express API, written in TypeScript and served by Node.js from a DigitalOcean Ubuntu VM at https://nwsnotes.duckdns.org.

The full specification is in [Specs/Main.md](Specs/Main.md).

## Project layout

| Folder | What's in it |
| --- | --- |
| `client/` | The website (React + Vite) |
| `server/` | The API and web server (Express) |
| `shared/` | TypeScript types and title validation used by both |
| `deploy/` | VM setup scripts and pm2 settings |
| `.github/workflows/deploy.yml` | Automatic deployment on push to `main` |

## Running it on your own computer

You need Node.js 24 or later.

```bash
npm install
npm run dev
```

Then open http://localhost:5173 and log in with the password `dev`. Notes are saved in `server/dev-data/` (ignored by Git).

`npm run build` produces the deployable app in `dist/`, and `npm run typecheck` checks the TypeScript.

## Setting up the VM (once)

Before starting, check that nwsnotes.duckdns.org points at the VM's IP address, and if you use a DigitalOcean cloud firewall, that it allows ports 22, 80 and 443.

### 1. Run the setup script on the VM

From a copy of this repository on your computer, copy the two scripts to the VM and log in (use whatever user you normally SSH in as):

```bash
scp deploy/setup-vm.sh deploy/get-certificate.sh root@nwsnotes.duckdns.org:
ssh root@nwsnotes.duckdns.org
sudo bash setup-vm.sh
```

The script installs Node.js 24, pm2 and certbot, creates an `nwsnotes` user and the app folders, sets up the firewall, and makes pm2 start the app on boot. Near the end it prints two things you need:

- **A private SSH key**, used by GitHub to deploy. You'll paste it into GitHub in the next step. It isn't stored on the VM, so copy it before closing the window.
- **Your login password** (32 random characters). Save it in your password manager. Only a hash of it is kept on the VM.

### 2. Add the GitHub secrets

In GitHub, open the repository's **Settings → Secrets and variables → Actions** and add two repository secrets:

| Name | Value |
| --- | --- |
| `VM_HOST` | `nwsnotes.duckdns.org` |
| `VM_SSH_KEY` | The whole private key from step 1, including the `BEGIN` and `END` lines |

### 3. Deploy the app

Merge your branch into `main`. GitHub Actions builds the app, copies it to the VM and starts it; you can watch progress under the repository's **Actions** tab. To deploy without a new commit, open **Actions → Deploy → Run workflow**.

At this point the app only answers on port 80, and only to say the certificate isn't set up yet.

### 4. Get the HTTPS certificate

Back on the VM:

```bash
sudo bash get-certificate.sh you@example.com
```

Let's Encrypt only uses the email for expiry warnings. The certificate renews automatically; each renewal copies it to the app and restarts it.

Then open https://nwsnotes.duckdns.org and log in.

## Day-to-day

- **Deploying changes:** push or merge to `main`.
- **Viewing the app's logs:** `sudo -iu nwsnotes pm2 logs nwsnotes`
- **Restarting the app:** `sudo -iu nwsnotes pm2 restart nwsnotes`
- **Getting a new password:** `sudo bash setup-vm.sh --new-password` (existing sessions stay logged in).
- **Taking a backup:** click the cog at the top right, then **Download backup**. This downloads the latest save-file, which can be copied straight back into `/var/lib/nwsnotes/data` to restore.

## Installing it as an Android app

Open https://nwsnotes.duckdns.org in Chrome on the phone, log in, then choose **⋮ → Add to Home screen → Install**. The app opens full-screen from its own icon and updates itself after each deployment. Notes are always loaded from the server, so it needs a connection to work.

## Where things live on the VM

| Path | Contents |
| --- | --- |
| `/opt/nwsnotes/app` | The deployed app (replaced on every deployment) |
| `/var/lib/nwsnotes/data` | Note save-files, e.g. `notes-2026-10-24T09-40-12-345Z.json` |
| `/etc/nwsnotes/config.json` | Password hash and session secret |
| `/etc/nwsnotes/certs` | The app's copy of the HTTPS certificate |

Save-files older than 7 days are deleted automatically, except the most recent one, which is always kept.
