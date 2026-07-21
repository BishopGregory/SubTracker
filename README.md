# SubTracker

A personal subscription-renewal tracker. A Google Sheet is the database; a Google
Apps Script Web App is the API; a small PWA (installable to your iPhone home
screen, hosted on GitHub Pages) is the front end. Same pattern as the WestSUS
web app: Sheet ⇄ Apps Script ⇄ static PWA, two-way sync on refresh.

```
Sheet "SubTracker" (tab: Subscriptions)
        ↕  doGet / doPost
Apps Script Web App  (appsscript/Code.gs)
        ↕  fetch()
PWA (index.html, app.js, sw.js, manifest.json) — GitHub Pages
```

## Sheet columns

| Column | Notes |
|---|---|
| ID | Added beyond the original spec — a UUID Apps Script generates on `add`, used internally to match rows for edit/delete. Safe to ignore/leave alone in the sheet. |
| Vendor | |
| Plan/Notes | |
| Cost | Number |
| Billing cycle | `monthly` or `annual` |
| Key date | `YYYY-MM-DD` |
| Auto-renews? | `yes` or `no` — drives the reminder wording |
| Intended action | `renew`, `cancel`, or `undecided` |
| Status | `active`, `expired`, or `cancelled` |
| Last updated | Auto-filled by Apps Script on every add/edit |

Reminder wording (for whenever notifications are added, see below):
- Auto-renews = yes → *"Cancel by [date] to avoid being charged for [Vendor]."*
- Auto-renews = no → *"Renew by [date] or you'll lose access to [Vendor]."*

## Notifications (not yet implemented)

The original plan was Web Push sent directly from a daily Apps Script trigger.
Building that turned out to be a bad trade: real Web Push requires
elliptic-curve crypto (ECDSA P-256 for the VAPID JWT, ECDH + AES-128-GCM to
encrypt the payload), and Apps Script has none of that built in. There is no
known working, tested implementation of this running purely inside Apps
Script — you'd be hand-assembling EC math and AES-GCM from generic JS crypto
libraries with no way to verify delivery until you're debugging live on your
phone. Given that risk, this first version ships without notifications.

**Recommended follow-up:** Firebase Cloud Messaging (FCM). The PWA would
subscribe via the FCM Web SDK instead of raw `pushManager.subscribe`, and
Apps Script would call FCM's HTTP v1 API (`UrlFetchApp.fetch` with an OAuth
token signed from a Firebase service account) to actually send each push —
FCM handles the VAPID/encryption internally, so no hand-rolled crypto is
needed. This is a well-documented path with working examples of Apps Script
→ FCM. It needs one extra piece of infrastructure: a free Firebase project.
Ask for this as a separate follow-up once the tracker itself is confirmed
working.

## Manual setup

You'll do these steps yourself — paste-and-click, no coding required.

### 1. Create the Google Sheet + Apps Script Web App

1. Go to [sheets.google.com](https://sheets.google.com) → **Blank spreadsheet**. Name it "SubTracker".
2. **Extensions → Apps Script**. This opens the Apps Script editor, bound to this sheet.
3. Delete the placeholder `myFunction() {}` in `Code.gs` and paste in the entire contents of [`appsscript/Code.gs`](appsscript/Code.gs) from this repo.
4. Click the **Save** icon (or Ctrl/Cmd+S).
5. In the function dropdown at the top (next to Debug), select **setupSheet**, then click **Run**. The first time, Google will ask you to authorize the script — click through **Review permissions → (your account) → Advanced → Go to (project name) → Allow**. This creates the "Subscriptions" tab with the correct header row.
6. Click **Deploy → New deployment**.
7. Click the gear icon next to "Select type" → **Web app**.
8. Set **Execute as: Me**, **Who has access: Anyone with the link**.
9. Click **Deploy**. Authorize again if prompted.
10. Copy the **Web app URL** shown (looks like `https://script.google.com/macros/s/AKfycb.../exec`). You'll paste this into `app.js` in a moment.

**Important:** when you need to push a code change to Apps Script later, use **Deploy → Manage deployments → (pencil/edit icon) → New version → Deploy**, not "New deployment" — the latter mints a brand-new URL and you'd have to update `app.js` again.

### 2. Wire the PWA to your Web App

1. Open [`app.js`](app.js) in this repo.
2. Replace `PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE` with the Web app URL from step 1.10.
3. Change `USE_MOCK_DATA: true` to `USE_MOCK_DATA: false`.
4. Save, commit, and push (see below).

### 3. Create the GitHub repo and enable Pages

1. Go to [github.com/new](https://github.com/new).
2. Repository name: `SubTracker`. Keep it **Public** (GitHub Pages on a free plan requires a public repo, unless you have GitHub Pro/Team/Enterprise). Do **not** initialize with a README (this repo already has one).
3. Click **Create repository**.
4. Back in your terminal, from this project folder, run:
   ```
   git remote add origin https://github.com/BishopGregory/SubTracker.git
   git branch -M main
   git push -u origin main
   ```
5. On GitHub, go to the repo's **Settings → Pages**.
6. Under **Build and deployment → Source**, choose **Deploy from a branch**.
7. Under **Branch**, choose **main** and folder **/ (root)**, then **Save**.
8. Wait a minute or two, then refresh — GitHub shows the live URL at the top of the Pages settings page (typically `https://bishopgregory.github.io/SubTracker/`).

### 4. Install to your iPhone home screen

1. Open the GitHub Pages URL in **Safari** on your iPhone (must be Safari, not Chrome, for install-to-home-screen).
2. Tap the **Share** icon → **Add to Home Screen** → **Add**.
3. Launch SubTracker from the home screen icon (not from Safari) from now on.

## Local development

```
python3 -m http.server 8765
```
then open `http://localhost:8765`. `USE_MOCK_DATA` is `true` by default so you can develop the UI without a live backend; flip it to `false` once you've completed the manual setup above.

## Two-way sync

- Editing in the app → `POST`s to the Apps Script Web App → writes the row in the Sheet.
- Editing in the Sheet directly → shows up in the app the next time you tap **Refresh** or reload.
- Writes are sent as `Content-Type: text/plain` on purpose — Apps Script Web Apps can't answer a CORS preflight request, so this avoids triggering one (same trick the WestSUS app uses against the same backend pattern).

## Repo layout

```
index.html   — app shell + markup
app.js       — state, rendering, API calls, mock data
sw.js        — service worker (offline shell caching)
manifest.json
icons/
appsscript/Code.gs — paste into the Apps Script editor
```
