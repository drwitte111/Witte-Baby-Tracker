# Tests

Both suites run against the Firebase emulators — no real project, no cost, no data leaves the machine.

## Setup

```bash
npm install --no-save firebase@12 firebase-tools@15      # not committed
firebase emulators:start --project demo-witte --only auth,firestore
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
| `rules.test.mjs` | Firestore rules: members read/write their family, strangers are refused the family doc, its events, other users' links, writing events, joining with invites closed, and minting invites; a holder of an open code can join and then read |
| `sync.e2e.mjs` | Two browser contexts as two phones: import 3,841 rows, create a family, bulk upload, join by code, pull the whole history, log entries offline and see them arrive after reconnecting |

```bash
node test/rules.test.mjs        # exits non-zero if any rule check fails
node test/sync.e2e.mjs          # needs playwright + the served app
```
