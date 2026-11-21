# nwsnotes

A personal notes website: a React front end and an Express API, written in TypeScript and served by Node.js from a DigitalOcean Ubuntu VM at https://nwsnotes.duckdns.org.

The full specification is in [Specs/](Specs/README.md), one file per area.

## Project layout

| Folder | What's in it |
| --- | --- |
| `client/` | The website (React + Vite) |
| `server/` | The API and web server (Express) |
| `shared/` | TypeScript types and title validation used by both |
| `e2e/` | End-to-end tests (Playwright) and their test data |
| `deploy/` | VM setup scripts and pm2 settings |
| `.github/workflows/deploy.yml` | Automatic deployment on push to `main`, after the tests pass |
| `.github/workflows/test.yml` | The tests, on every pull request |

## Running it on your own computer

You need Node.js 24 or later.

```bash
npm install
npm run dev
```

Then open http://localhost:5173 and log in as `admin` with the password `dev`. Notes are saved in `server/dev-data/` (ignored by Git), in PGlite, a local copy of Postgres that runs inside Node, so you don't need Supabase or anything else installed.

`npm run build` produces the deployable app in `dist/`, and `npm run typecheck` checks the TypeScript.

## Automated tests

The end-to-end tests use the app in a real browser (Chromium), at tablet and desktop sizes. They start their own server on port 3100 with its own test data (in `e2e/.test-data/`, reset before every test from `e2e/fixtures/seed.json`), so they never touch real or dev notes and can run while `npm run dev` is running.

Once, to download the test browser:

```bash
npx playwright install chromium
```

Then:

- `npm run test:e2e` builds the app and runs every test. Add a file name to run just those tests, e.g. `npm run test:e2e -- notes.spec` (the name must not just be "notes", which the folder name "nwsnotes" also matches).
- `npm run test:e2e:ui` opens Playwright's UI mode, to run and watch tests one by one.
- After a failure, `npx playwright show-report e2e/playwright-report` shows what went wrong, with a screenshot, a video and a step-by-step trace.

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
- **Your login**: the name `admin` and a password (32 random characters). Save them in your password manager. Only a hash of the password is kept. You are the admin (user 1), who adds everyone else's accounts in the app.

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

### 5. Connect the database (Supabase)

The notes are kept in a Supabase database (the free plan is enough). **Do this before deploying the version with the database**: without it, the app won't start.

1. At https://supabase.com, create a project. Choose the **region nearest the VM**, and save the **database password** in your password manager.
2. In the project, open **Connect** and copy the **Session pooler** connection string (it works over IPv4, which the VM uses). It looks like `postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-eu-west-2.pooler.supabase.com:5432/postgres`. Put your database password in place of `[YOUR-PASSWORD]`.
3. Open **Project Settings → Database → SSL configuration** and **Download certificate** (`prod-ca-2021.crt`).
4. Copy the certificate and the script to the VM, and run the script there. It asks for the connection string, without showing it:

   ```bash
   scp deploy/set-database.sh prod-ca-2021.crt root@nwsnotes.duckdns.org:
   ssh root@nwsnotes.duckdns.org
   sudo bash set-database.sh prod-ca-2021.crt
   ```

5. Deploy (merge to `main`). On its first start the app creates its tables and imports the latest save-file from `/var/lib/nwsnotes/data`. The save-files are left as they are; no new ones are written.

The app makes a small query every day, so Supabase sees the project as in use. If it's paused anyway (free projects pause after a week without activity), the app goes offline: open the project in Supabase and press **Restore**, and the app carries on by itself.

## Day-to-day

- **Deploying changes:** push or merge to `main`.
- **Viewing the app's logs:** `sudo -iu nwsnotes pm2 logs nwsnotes`
- **Restarting the app:** `sudo -iu nwsnotes pm2 restart nwsnotes`
- **Adding someone:** Settings → **Manage users** → **Add user**. The app makes a password and shows it once, for you to send them. The same page resets a password or turns an account off and on. Each person has their own notebook, which nobody else (you included) can see.
- **Changing your password:** Settings → **Change password**. Your other devices are logged out.
- **A forgotten password (yours or anyone's):** `sudo bash setup-vm.sh --new-password <login name>` (or `sudo -iu nwsnotes bash -c 'cd /opt/nwsnotes/app && NODE_ENV=production node server.cjs --reset-password <login name>'`, then restart the app). It prints a new password and logs that person out everywhere.
- **Taking a backup:** click the cog at the top right, then **Download backup**. This downloads a file with all your notes, categories, tags and tabs. The app also writes one every day for each person, to `/var/lib/nwsnotes/data/backups/<user id>/` (you are user 1), keeping the last seven.
- **Going back to an earlier state:** Settings → **History** lists the last 30 days of changes; **Go back to here** undoes everything after one (and can itself be undone).
- **Restoring a backup file** (replaces all of one person's notes, as one change in their History, so it can be undone): `sudo -iu nwsnotes bash -c 'cd /opt/nwsnotes/app && NODE_ENV=production node server.cjs --restore /path/to/notes-….json --user <login name>'`, then restart the app. It refuses without `--user`, so a backup can't go into the wrong notebook.

### The first start of the version with users

The first time the version with several users starts, it moves everything that's there (notes, categories, tabs, History, backup files and reminder devices) to the admin, user 1, in one go. The admin's login name is `admin` (or `"adminLoginName"` in `/etc/nwsnotes/config.json`, if you add it before the update), and the password stays the one you have now. Every device is logged out once: log in again with the name and your usual password.

## Installing it as an Android app

Open https://nwsnotes.duckdns.org in Chrome on the phone, log in, then choose **⋮ → Add to Home screen → Install**. The app opens full-screen from its own icon and updates itself after each deployment. Notes are always loaded from the server, so it needs a connection to work.

## Where things live on the VM

| Path | Contents |
| --- | --- |
| `/opt/nwsnotes/app` | The deployed app (replaced on every deployment) |
| Supabase | The users, and each one's notes, categories, tabs and their 30-day history |
| `/var/lib/nwsnotes/data/backups/<user id>` | A backup file a day for each user, the last seven, e.g. `backups/1/notes-2026-11-18.json` |
| `/var/lib/nwsnotes/data` | Push-notification keys and devices, and the save-files from before the database |
| `/etc/nwsnotes/config.json` | Session secret, the database's connection string, and the admin's first password hash (only used to make user 1) |
| `/etc/nwsnotes/supabase-ca.crt` | Supabase's SSL certificate, to check the database connection |
| `/etc/nwsnotes/certs` | The app's copy of the HTTPS certificate |


