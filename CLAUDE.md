# Rules for working on this repo

## Firebase quota is sacred
The app runs on the Firestore Spark (free) plan: 50,000 reads and 20,000 writes per day,
shared by two phones. On 2026-09-22 the quota was exhausted by browser tests that loaded
the app against the real project. That took sync down for both phones for a night. Never again.

- **Never point anything at the real project from this environment.** No Playwright page,
  no node script, no curl beyond a single-document probe. Every browser test sets
  `localStorage.firebaseEmulator` and `firebaseSdkBase` and runs against the emulator
  (`node_modules/.bin/firebase emulators:start --project witte-baby-tracker --only firestore`).
  The app itself refuses sync on localhost without the flag (`localWithoutEmulator()` in
  `js/sync.js`); do not weaken that guard.
- **Before adding any code path that reads or writes Firestore, count its cost** per
  phone per day in the commit message or PR description. A cold load costs one read per
  stored event (~3,900 today). Anything that could run on every app open must be O(1).
- **Never add a poll.** Live data comes from the two `onSnapshot` streams only.
- The per-phone budget (`QUOTA`, `cap()` in `js/sync.js`) and the Pacific-midnight reset
  stay. Do not raise the caps.

## Other standing rules
- Both phones are iPhone 16 Pro on iOS 26, installed to the Home Screen. Optimize for that.
- No login. Firestore is only the shared database; rules allow `families/witte/**` only.
- The GitHub token lives on the phone only (IndexedDB meta `ghToken`); never sync it, never commit it.
- The personal Nara CSV export is never committed (`*.csv` is ignored).
- Push to `main` directly when asked; a Pages deploy runs on every push and stamps `version.json`.
- No emojis in the UI. Illustrated looks are vector art (`tools/look-art.py`).
