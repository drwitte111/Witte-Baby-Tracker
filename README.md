# Witte Baby Tracker

A private, offline-first baby tracker for **breastfeeding, sleep, diapers and growth** —
modelled on Nara Baby, with a one-click importer for its CSV export.

No build step, no server, no account. It is plain HTML/CSS/ES modules; all data lives in
IndexedDB on the device that entered it.

## Using it

Open `index.html` over HTTP (GitHub Pages, or `npx http-server`) and add it to your home
screen. It then runs full-screen and works with no connection.

| Screen | What it does |
|---|---|
| **Home** | Time since the last feed / sleep / diaper, live nursing and sleep timers, one-tap diaper logging, today's totals |
| **Log** | Full history grouped by day, filter by type, tap any entry to edit or delete |
| **Stats** | 7/14/30-day daily rhythm, sleep per day (night vs. naps), feeds per day, diapers per day, and the same numbers as a table |
| **Growth** | Weight / length / head curves, gain per week, editable measurement table |
| **More** | Baby profile, units, CSV import & export, delete-all |

### Nursing timer

Pick a side, and the timer runs on that side. **Switch** moves to the other side and keeps
each side's total separately; **Pause** stops the clock. The session is written to IndexedDB
as it runs, so closing the app or locking the phone mid-feed loses nothing. The home screen
suggests the side opposite the one the last feed ended on. The screen stays awake while a
feed timer is running.

### Sleep

**Start sleep** / **Woke up**, or enter a past sleep with both times. A sleep with no end is
kept as in-progress and can be closed later from the log. Sleep that crosses midnight is
attributed to both calendar days in the stats, and night is counted as 7pm–7am.

## Nara Baby import / export

**More → Import CSV** reads a Nara Baby export directly. All six activity types are
imported — breastfeeds, sleeps, diapers and growth are fully editable; bottles and pumps are
imported and shown read-only so nothing in the history is lost.

Rows are keyed on Nara's `_activityKey`, so importing the same file twice updates rather than
duplicates. **Export CSV** writes the same 49-column format back, and a Nara export → import →
export round-trip reproduces every field, including per-side nursing durations, diaper colour
and texture, and the original volume units.

Growth measurements are stored canonically in grams and centimetres, so a file mixing `CM` and
`IN` head measurements (as the Nara export does) converts cleanly and displays in whichever
unit you pick.

## Sync between caregivers (optional)

Sync is off until you connect a Firebase project of your own. Everything below is one-time
setup; after it, both phones show the same data within a second or two, and each phone keeps
working with no signal — changes queue and upload when it reconnects.

### Make the Firebase project

1. [console.firebase.google.com](https://console.firebase.google.com) → **Add project**
   (Google Analytics is not needed).
2. **Build → Firestore Database → Create database** → *production mode* → pick the region
   closest to you.
3. **Build → Authentication → Get started → Email/Password → Enable**.
4. **Project settings (gear) → Your apps → Web (`</>`)** → register the app → copy the
   `firebaseConfig` snippet it shows.
5. **Firestore → Rules** → paste the contents of [`firestore.rules`](firestore.rules) →
   **Publish**. (Or `firebase deploy --only firestore:rules` with the included
   `firebase.json`.) Do this before signing in — the default production rules deny everything.

### Connect the phones

1. On the first phone: **More → Sync**, paste the config snippet, **Connect project**.
2. Create an account with your email, then **Create a family**. Any history already on that
   phone uploads.
3. **Invite caregiver** gives an 8-character code, good for 24 hours.
4. On the second phone: same config snippet, create their *own* account, enter the code.
   The whole history downloads.

The config snippet is not a secret — Firebase web keys are public by design, and
`firestore.rules` is what actually protects the data: only members of your family can read or
write its entries, and a stranger can only join while an invite is open and unexpired. That is
covered by [`test/rules.test.mjs`](test/rules.test.mjs).

### How it behaves

- **Local-first.** IndexedDB stays the source of truth; Firestore is the shared copy. Signing
  out leaves the data on the device.
- **Offline.** Entries logged with no signal are marked dirty and pushed on reconnect.
- **Conflicts** resolve last-write-wins per entry, on the editing device's clock. Two people
  editing the same entry within seconds is the only case where one edit wins silently.
- **Deletes travel as tombstones**, so a delete on one phone doesn't sync back from the other.
- **Shared settings.** Baby name, birth date and units sync; the caregiver name on each device
  stays local, so entries record who logged them.
- **Cost.** The free Spark tier allows 50k reads and 20k writes a day. A first sync of ~3,800
  entries uses about 3,800 writes; ordinary daily use is a few dozen operations.

## Data and privacy

With sync off, everything is local: no backend, no analytics, and no network request after the
page loads — which also means no backup, so export to CSV regularly. With sync on, the only
service involved is your own Firebase project; nothing is sent anywhere else, and the Firebase
SDK is fetched from Google's CDN only once sync is connected.

The app asks the browser for persistent storage on the More screen and tells you whether it was
granted. **Delete all data** clears this device when sync is off, and deletes for the whole
family when it is on (it says which).

Personal exports are git-ignored; don't commit them.

## On iPhone

The app is tuned for iPhone 16 Pro on iOS 26, and degrades cleanly elsewhere.

- **Install it:** Safari → Share → *Add to Home Screen*. The app says so once, on the Home
  screen, until dismissed. Installed, it launches full screen with its own launch image, keeps
  its data out of Safari's 7-day eviction rules, and runs offline.
- **Dynamic Island:** the status bar is translucent and every edge respects the safe-area
  insets, so nothing hides under the island or the home indicator.
- **Keyboard:** the tab bar drops away and sheets ride above the keyboard (`visualViewport`),
  so the field you are typing in is never covered.
- **Screen stays awake** while a nursing timer runs, and only then.
- **Export** uses the iOS share sheet — AirDrop the CSV to the other phone, drop it in Files,
  or mail it to the pediatrician. It falls back to a download on desktop.
- **Transitions** use the View Transitions API, so tab switches are smooth on the 120 Hz
  display; they are skipped under Reduce Motion.
- **Touch targets** are at least 48 px with double-tap zoom disabled on controls, so a
  one-handed 3am tap lands where you meant it.

Not possible from a web app on iOS: Live Activities in the Dynamic Island, Lock Screen widgets,
Siri shortcuts, and scheduled local notifications. Web push does work for installed PWAs but
needs a server to send it, so nothing here depends on it.

## Deploying to GitHub Pages

Settings → Pages → deploy from branch, pick the branch and `/` (root). `.nojekyll` is already
present so the `js/` directory is served as-is. The service worker caches the shell under the
scope it is served from, so a project page (`/Witte-Baby-Tracker/`) works without changes.

## Layout

```
index.html            shell, tab bar, sheet + toast + tooltip roots
manifest.webmanifest  PWA manifest
sw.js                 cache-first service worker
assets/styles.css     tokens, light + dark themes, components
js/app.js             boot, state, hash router, one-second ticker, wake lock
js/sync.js            optional Firebase sync: outbox, watermark pull, families, invites
js/db.js              IndexedDB (events + meta stores)
js/model.js           event shapes, derived values, day/night aggregation
js/format.js          durations, relative time, unit conversion
js/csv.js             Nara CSV parser and writer
js/charts.js          inline-SVG bar / stacked / line / rhythm charts
js/forms.js           add & edit sheets
js/ui.js              sheets, toasts, confirm, tooltips, download
js/views/*.js         home, log, stats, growth, settings, sync card
firestore.rules       security rules — paste into the Firebase console
firebase.json         rules deploy + emulator config for the test suites
test/                 rules and two-device sync tests (emulator-based)
```

## Not included

WHO percentile curves, bottle/pump entry UI, reminders, and photo journaling. The importer
preserves the bottle and pump rows so any of those can be added later without a data
migration.
