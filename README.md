# nwsnotes

A personal notes website: a React front end and an Express API, written in TypeScript and served by Node.js from a DigitalOcean Ubuntu VM at https://nwsnotes.com.

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

Then open http://localhost:5173 and log in as `admin@example.com` with the password `dev` (or as `admin`, if your `server/dev-data/` was made before login names became email addresses). Notes are saved in `server/dev-data/` (ignored by Git), in PGlite, a local copy of Postgres that runs inside Node, so you don't need Supabase or anything else installed.

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

Before starting, check that nwsnotes.com (and, if you want it to work too, www.nwsnotes.com) points at the VM's IP address, and if you use a DigitalOcean cloud firewall, that it allows ports 22, 80 and 443.

### 1. Run the setup script on the VM

From a copy of this repository on your computer, copy the two scripts to the VM and log in (use whatever user you normally SSH in as):

```bash
scp deploy/setup-vm.sh deploy/get-certificate.sh root@nwsnotes.com:
ssh root@nwsnotes.com
sudo bash setup-vm.sh you@example.com
```

Use your own email address: it's what you'll log in with, as the admin.

The script installs Node.js 24, pm2 and certbot, creates an `nwsnotes` user and the app folders, sets up the firewall, and makes pm2 start the app on boot. Near the end it prints two things you need:

- **A private SSH key**, used by GitHub to deploy. You'll paste it into GitHub in the next step. It isn't stored on the VM, so copy it before closing the window.
- **Your login**: your email address and a password (32 random characters). Save them in your password manager. Only a hash of the password is kept. You are the admin (user 1), who adds everyone else's accounts in the app.

### 2. Add the GitHub secrets

In GitHub, open the repository's **Settings → Secrets and variables → Actions** and add two repository secrets:

| Name | Value |
| --- | --- |
| `VM_HOST` | `nwsnotes.com` |
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

Then open https://nwsnotes.com and log in.

The certificate also covers www.nwsnotes.com and the old nwsnotes.duckdns.org, if they point at the VM; the app sends visitors on those addresses to https://nwsnotes.com.

### 5. Connect the database (Supabase)

The notes are kept in a Supabase database (the free plan is enough). **Do this before deploying the version with the database**: without it, the app won't start.

1. At https://supabase.com, create a project. Choose the **region nearest the VM**, and save the **database password** in your password manager.
2. In the project, open **Connect** and copy the **Session pooler** connection string (it works over IPv4, which the VM uses). It looks like `postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-eu-west-2.pooler.supabase.com:5432/postgres`. Put your database password in place of `[YOUR-PASSWORD]`.
3. Open **Project Settings → Database → SSL configuration** and **Download certificate** (`prod-ca-2021.crt`).
4. Copy the certificate and the script to the VM, and run the script there. It asks for the connection string, without showing it:

   ```bash
   scp deploy/set-database.sh prod-ca-2021.crt root@nwsnotes.com:
   ssh root@nwsnotes.com
   sudo bash set-database.sh prod-ca-2021.crt
   ```

5. Deploy (merge to `main`). On its first start the app creates its tables and the admin (user 1), with an empty notebook. To bring notes across, restore a backup file into it (see "Restoring a backup file" below).

The app makes a small query every day, so Supabase sees the project as in use. If it's paused anyway (free projects pause after a week without activity), the app goes offline: open the project in Supabase and press **Restore**, and the app carries on by itself.

### 6. Adding notes by text message (Twilio, optional)

Lets everyone text notes in, e.g. by voice from the car with Android Auto (see [Specs/text-messages.md](Specs/text-messages.md)). Without it, the app works as before, and Settings has no "Text messages" section.

1. At https://www.twilio.com, sign up and **upgrade** the account (a top-up of about $20, used up gradually). In **Billing**, leave **auto-recharge off**, so a fault can never run up a bill.
2. In **Phone Numbers → Regulatory Compliance**, make a **UK bundle** for a mobile number, as an individual, with proof of address. Approval can take a few working days.
3. Buy a **UK mobile number** (07…) that can receive SMS, about $2.50 a month.
4. In the number's settings, under **Messaging → A message comes in**, choose **Webhook**, `https://nwsnotes.com/api/sms/incoming`, **HTTP POST**.
5. Copy the script to the VM and run it. It asks for the **Auth Token** (Twilio Console → Account info), without showing it, the number and the site's address, then restarts the app:

   ```bash
   scp deploy/set-sms.sh root@nwsnotes.com:
   ssh root@nwsnotes.com
   sudo bash set-sms.sh
   ```

6. Each person then opens Settings → **Text messages** → **Link my phone**, texts the code shown to the number, and saves the number in their contacts as "nwsnotes".

It costs about $0.0075 for each text received and $0.05 for each text sent back (only when a note couldn't be saved).

### 7. Google Calendar (optional)

Lets everyone sync their notes with due dates with Google Calendar, both ways (see [Specs/google-calendar.md](Specs/google-calendar.md)). Without it, the app works as before, and Settings has no "Google Calendar" section. It's free.

1. At https://console.cloud.google.com, signed in with your own Google account, create a project (e.g. "nwsnotes").
2. In **APIs & Services → Library**, find the **Google Calendar API** and tap **Enable**.
3. In **Google Auth Platform** (or **APIs & Services → OAuth consent screen**), set it up as **External**: the app name "nwsnotes", a support email, and nwsnotes.com as an authorised domain. Leave out a logo (it would need Google's brand check). Under **Data access**, add the scope `https://www.googleapis.com/auth/calendar.app.created`.
4. Under **Audience**, tap **Publish app**, so it's "In production". (While it's "Testing", only listed test users can connect, and their connections stop after 7 days.) It doesn't need Google's verification: people see "Google hasn't verified this app" once, and tap **Advanced → Go to nwsnotes**. Up to 100 people can connect.
5. Under **Clients**, create an **OAuth client**, of type **Web application**, with the authorised redirect URI `https://nwsnotes.com/api/google/callback`. Copy its **client ID** and **client secret**.
6. Copy the script to the VM and run it. It asks for the client ID, the secret (without showing it) and the site's address, then restarts the app:

   ```bash
   scp deploy/set-google.sh root@nwsnotes.com:
   ssh root@nwsnotes.com
   sudo bash set-google.sh
   ```

7. Each person then opens Settings → **Google Calendar** → **Connect Google Calendar**.

### 8. Sending email (Brevo, optional)

Lets nwsnotes send email, e.g. a summary of a tab when someone texts "Email tab Shopping" (see "Emailing a tab" in [Specs/text-messages.md](Specs/text-messages.md)). It goes through Brevo's API over HTTPS, as DigitalOcean blocks the usual mail ports. Without it, the app works as before, and the email command texts back that email isn't set up.

1. At https://www.brevo.com, sign up (the free plan sends 300 emails a day).
2. In **Senders, Domains & Dedicated IPs → Domains**, add `nwsnotes.com` and add the DNS records it shows (a `brevo-code` TXT record, DKIM records and, if there isn't one, DMARC). Wait until Brevo shows the domain as authenticated.
3. Under **Senders**, add `noreply@nwsnotes.com`. It needs no mailbox.
4. Under **SMTP & API → API Keys**, make an **API key** (it starts `xkeysib-`; an SMTP key won't do).
5. Copy the script to the VM and run it. It asks for the key, without showing it, and the sender, then restarts the app:

   ```bash
   scp deploy/set-email.sh root@nwsnotes.com:
   ssh root@nwsnotes.com
   sudo bash set-email.sh
   ```

Emails go to each person's login email. Each person can have at most 10 tab emails a day, so everyone together stays within the free plan.

### 9. Adding notes by Alexa (optional)

Lets you say notes to an Echo: "Alexa, ask Nick Notes to add Shopping oat milk" (see [Specs/alexa.md](Specs/alexa.md)). The skill is private: it's never published, and only works on Echos signed in to your own Amazon account. Without it, the app works as before, and Settings has no "Alexa" section. It's free.

1. At https://developer.amazon.com/alexa/console/ask, sign in with the Amazon account your Echo uses, and tap **Create Skill**.
2. Name it "Nick Notes", choose **English (UK)**, the **Other** experience, the **Custom** model and **Provision your own** hosting, then **Start from Scratch**.
3. Under **Build → Interaction Model → JSON Editor**, replace everything with the contents of `deploy/alexa-model.json`, tap **Save** and then **Build skill**.
4. Under **Build → Endpoint**, choose **HTTPS**, enter `https://nwsnotes.com/api/alexa` as the **Default Region**, and choose **My development endpoint has a certificate from a trusted certificate authority**. Tap **Save**.
5. Under **Test**, change **Skill testing is enabled in** to **Development**. This turns the skill on for your Echos.
6. Copy the skill's ID (the skills list → **Copy Skill ID**, `amzn1.ask.skill.…`). Copy the script to the VM and run it; it asks for the ID, then restarts the app:

   ```bash
   scp deploy/set-alexa.sh root@nwsnotes.com:
   ssh root@nwsnotes.com
   sudo bash set-alexa.sh
   ```

7. In nwsnotes, open Settings → **Alexa** → **Link Alexa**, and say "Alexa, ask Nick Notes to link" and the code shown.

To change the name you say, edit `invocationName` in `deploy/alexa-model.json` (in lower case), paste it in again and build, then change `ALEXA_NAME` in `shared/src/alexa.ts` and the help page `docs/alexa.md` to match.

## Moving from nwsnotes.duckdns.org to nwsnotes.com (once)

If the VM was set up when the site was at nwsnotes.duckdns.org:

1. At your domain registrar, add DNS records for nwsnotes.com pointing at the VM: an **A record** for `@` (the bare name) with the VM's IP address, and either another A record or a **CNAME** to `nwsnotes.com` for `www`. Leave the DuckDNS entry as it is, so old links keep working. Check with `nslookup nwsnotes.com` that it gives the VM's address (this can take from a few minutes to a few hours).
2. Merge to `main` to deploy the version that knows about nwsnotes.com.
3. Copy the new certificate script to the VM and run it:

   ```bash
   scp deploy/get-certificate.sh root@nwsnotes.duckdns.org:
   ssh root@nwsnotes.duckdns.org
   sudo bash get-certificate.sh you@example.com
   ```

   It gets one certificate for nwsnotes.com, www.nwsnotes.com and nwsnotes.duckdns.org, updates the renewal hook, restarts the app and removes the old certificate.
4. In GitHub, change the `VM_HOST` secret to `nwsnotes.com`.
5. If text messages are turned on: change the Twilio webhook to `https://nwsnotes.com/api/sms/incoming`, then run `sudo bash set-sms.sh` again (copy the new one across first) and accept the new address. Texts keep working throughout, whichever address the webhook uses.
6. On each phone, open https://nwsnotes.com, log in (logins don't carry over to a new address), install it again (**⋮ → Add to Home screen → Install**), turn reminders back on in Settings if you use them, and remove the old app's icon. The old app keeps working until then.

## Day-to-day

- **Deploying changes:** push or merge to `main`.
- **Viewing the app's logs:** `sudo -iu nwsnotes pm2 logs nwsnotes`. Each text sent to the nwsnotes number gets a line saying what happened to it (saved, phone not linked, wrong signature…), without its content.
- **Restarting the app:** `sudo -iu nwsnotes pm2 restart nwsnotes`
- **Adding someone:** send them https://nwsnotes.com/signup. They fill in their email, name and a password of their own. A red warning icon then shows at the top of the app; it opens Settings → **Manage users**, where you **Confirm** (or **Decline**) them under "Waiting to be confirmed". Confirming emails them the link to log in (if email is set up, see "Sending email" above). Or add them yourself with **Add user**, which makes a password for you to send them. The app makes a password and shows it once, for you to send them. The same page resets a password or turns an account off and on. Each person has their own notebook, which nobody else (you included) can see.
- **Changing your password:** Settings → **Change password**. Your other devices are logged out.
- **A forgotten password (yours or anyone's):** `sudo bash setup-vm.sh --new-password <login email>` (or `sudo -iu nwsnotes bash -c 'cd /opt/nwsnotes/app && NODE_ENV=production node server.cjs --reset-password <login email>'`, then restart the app). It prints a new password and logs that person out everywhere.
- **Taking a backup:** click the cog at the top right, then **Download backup**. This downloads a file with all your notes, categories, tags and tabs. The app also writes one every day for each person, to `/var/lib/nwsnotes/data/backups/<user id>/` (you are user 1), keeping the last seven.
- **Going back to an earlier state:** Settings → **History** lists the last 30 days of changes; **Go back to here** undoes everything after one (and can itself be undone).
- **Restoring a backup file** (replaces all of one person's notes, as one change in their History, so it can be undone): `sudo -iu nwsnotes bash -c 'cd /opt/nwsnotes/app && NODE_ENV=production node server.cjs --restore /path/to/notes-….json --user <login email>'`, then restart the app. It refuses without `--user`, so a backup can't go into the wrong notebook.

## Installing it as an Android app

Open https://nwsnotes.com in Chrome on the phone, log in, then choose **⋮ → Add to Home screen → Install**. The app opens full-screen from its own icon and updates itself after each deployment. Notes are always loaded from the server, so it needs a connection to work.

## Where things live on the VM

| Path | Contents |
| --- | --- |
| `/opt/nwsnotes/app` | The deployed app (replaced on every deployment) |
| Supabase | The users, and each one's notes, categories, tabs and their 30-day history |
| `/var/lib/nwsnotes/data/backups/<user id>` | A backup file a day for each user, the last seven, e.g. `backups/1/notes-2026-11-18.json` |
| `/var/lib/nwsnotes/data` | Push-notification keys and devices, `server-log.json` (the recent errors shown on the admin's Server errors page), and any old save-files from before the database, which the app no longer reads |
| `/etc/nwsnotes/config.json` | Session secret, the Brevo key and sender (if email is on), the database's connection string, and the admin's email (`adminLoginName`) and first password hash (both only used to make user 1) |
| `/etc/nwsnotes/supabase-ca.crt` | Supabase's SSL certificate, to check the database connection |
| `/etc/nwsnotes/certs` | The app's copy of the HTTPS certificate |


