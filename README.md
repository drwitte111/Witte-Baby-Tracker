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

## Data and privacy

Everything is local. There is no backend, no analytics, and no network request after the page
loads. That also means **there is no sync between devices and no backup** — export to CSV
regularly, especially before clearing browser data. The app asks the browser for persistent
storage on the More screen and tells you whether it was granted.

Personal exports are git-ignored; don't commit them.

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
js/db.js              IndexedDB (events + meta stores)
js/model.js           event shapes, derived values, day/night aggregation
js/format.js          durations, relative time, unit conversion
js/csv.js             Nara CSV parser and writer
js/charts.js          inline-SVG bar / stacked / line / rhythm charts
js/forms.js           add & edit sheets
js/ui.js              sheets, toasts, confirm, tooltips, download
js/views/*.js         home, log, stats, growth, settings
```

## Not included

Multi-caregiver sync, WHO percentile curves, bottle/pump entry UI, reminders, and photo
journaling. The importer preserves the bottle and pump rows so any of those can be added later
without a data migration.
