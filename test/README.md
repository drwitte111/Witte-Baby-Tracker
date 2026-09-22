# Tests

Both suites run against the Firebase emulators — no real project, no cost, no data leaves the machine.

## Setup

```bash
npm install --no-save firebase@12 firebase-tools@15      # not committed
firebase emulators:start --project demo-witte --only firestore
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
| `rules.test.mjs` | Firestore rules: the app's one shared path is readable and writable, and every other path in the project is denied |
| `sync.e2e.mjs` | Two browser contexts as two phones: import 3,841 rows, connect, bulk upload, second phone pulls the whole history with nothing to sign into, entries travel both ways, and an entry logged offline arrives after reconnecting |

```bash
node test/rules.test.mjs        # exits non-zero if any rule check fails
node test/sync.e2e.mjs          # needs playwright + the served app
```
