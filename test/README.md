# Tests

Both suites run against the Firebase emulators — no real project, no cost, no data leaves the machine.

## Setup

```bash
npm install --no-save firebase@12 firebase-tools@15      # not committed
firebase emulators:start --project witte-baby-tracker --only firestore
```

For the browser suite, serve the app and give it a local copy of the SDK
(the CDN build is blocked in some sandboxes):

```bash
mkdir -p sdktest
cp node_modules/firebase/firebase-{app,auth,firestore}.js sdktest/
sed -i 's|https://www.gstatic.com/firebasejs/[0-9.]*/|/sdktest/|g' sdktest/*.js
npx http-server -p 8099 -c-1
```

The app reads two localStorage overrides, set by the test harness:
`firebaseSdkBase` (where to import the SDK from) and `firebaseEmulator`
(`host:authPort:firestorePort`).

## Suites

| File | Covers |
|---|---|
| `sessions.test.mjs` | Timer arithmetic (pause, switch sides, started-earlier, wheel time rollover). No browser, no emulator: `node test/sessions.test.mjs` |
| `rules.test.mjs` | Firestore rules: the app's one shared path is readable and writable, and every other path in the project is denied |
| `sync.e2e.mjs` | Two phones: import 3,841 rows, bulk upload, second phone pulls the whole history with nothing to sign into, entries travel both ways, an entry logged offline arrives after reconnecting |
| `babies.e2e.mjs` | Two phones: an import creates the baby on both, adding a second baby switches both phones, each baby's log stays separate |
| `timers.e2e.mjs` | Two phones: a sleep started on one shows on the other, either can adjust or end it |
| `quota.e2e.mjs` | A phone with a forced 150-write allowance pushes exactly that, parks the rest with a notice, and the other phone receives what was sent |

```bash
node test/rules.test.mjs        # exits non-zero if any rule check fails
node test/sync.e2e.mjs          # needs playwright + the served app
```
