/**
 * Optional Firebase sync.
 *
 * The app is local-first: IndexedDB stays the source of truth and everything
 * works signed out. When a family is linked, every local row carries `updated`
 * (device clock) and a `dirty` flag; this engine pushes dirty rows up and
 * subscribes to rows the server has stamped since the last watermark.
 * Conflicts resolve last-write-wins on `updated`, and deletes travel as
 * tombstones so a delete on one phone doesn't sync straight back from the other.
 *
 * The SDK is loaded from the CDN on demand, so a signed-out install never
 * downloads it and offline start-up never waits on it.
 */
import { db } from './db.js';

const SDK_VERSION = '12.19.0';
// Overridable so the emulator harness can serve the SDK locally.
const sdkBase = () => localStorage.getItem('firebaseSdkBase')
  || `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;

const SYNCED_META = ['profile', 'units'];       // meta keys shared across devices
const PUSH_DEBOUNCE = 900;
const BATCH = 400;

let sdk = null;          // { app, auth?, fs }
let app = null, auth = null, store = null;
let baked = null;        // assets/firebase-config.js, if it carries a project
let space = 'family';    // the shared dataset everything lives under
let requireSignIn = false;
let unsubEvents = null, unsubMeta = null, unsubAuth = null;
let pushTimer = null, pushing = false, pushAgain = false;

export const sync = {
  state: 'off',          // off | loading | signed-out | no-family | live | error
  user: null,
  family: null,          // { id, name, members }
  pending: 0,
  lastSync: null,
  error: '',
};

// `localStorage.syncDebug = 1` turns on a running commentary in the console.
const debug = (...a) => { if (localStorage.getItem('syncDebug')) console.log('[sync]', ...a); };

const watchers = new Set();
export function onSyncChange(fn) { watchers.add(fn); return () => watchers.delete(fn); }
function announce(patch = {}) {
  Object.assign(sync, patch);
  watchers.forEach(fn => { try { fn(sync); } catch {} });
}

/* ---------------- configuration ---------------- */

async function loadBaked() {
  if (baked) return baked;
  try {
    const m = await import('../assets/firebase-config.js');
    baked = m;
    space = m.SPACE || space;
    requireSignIn = !!m.REQUIRE_SIGN_IN;
    return m;
  } catch {
    baked = {};
    return baked;
  }
}

export async function getConfig() {
  const b = await loadBaked();
  return b.firebaseConfig || db.metaGet('firebaseConfig', null);
}

export async function spaceLabel() {
  const b = await loadBaked();
  return b.SPACE_NAME || b.SPACE || 'Shared';
}

export function isBaked() { return !!baked?.firebaseConfig; }
export function needsSignIn() { return requireSignIn; }

export async function setConfig(config) {
  await db.metaSet('firebaseConfig', config);
  location.reload();                              // simplest way to re-init cleanly
}

export async function clearConfig() {
  await db.metaSet('firebaseConfig', null);
  await db.metaSet('syncWatermark', 0);
  location.reload();
}

/** Accepts the JS snippet Firebase shows, or plain JSON. */
export function parseConfig(text) {
  const t = text.trim();
  const json = t.startsWith('{') ? t : (t.match(/\{[\s\S]*\}/) || [''])[0];
  if (!json) throw new Error('No config object found');
  // The console prints unquoted keys and single quotes; make it strict JSON.
  const strict = json
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/'/g, '"')
    .replace(/,(\s*[}\]])/g, '$1');
  const cfg = JSON.parse(strict);
  for (const k of ['apiKey', 'authDomain', 'projectId', 'appId']) {
    if (!cfg[k]) throw new Error(`Config is missing ${k}`);
  }
  return cfg;
}

/* ---------------- SDK ---------------- */

async function loadSdk() {
  if (sdk) return sdk;
  const base = sdkBase();
  const parts = [
    import(/* @vite-ignore */ `${base}/firebase-app.js`),
    import(/* @vite-ignore */ `${base}/firebase-firestore.js`),
  ];
  // 400 KB of auth code is dead weight when there is no sign-in.
  if (requireSignIn) parts.push(import(/* @vite-ignore */ `${base}/firebase-auth.js`));
  const [a, c, b] = await Promise.all(parts);
  sdk = { app: a, fs: c, auth: b || null };
  return sdk;
}

/* ---------------- lifecycle ---------------- */

export async function init() {
  const config = await getConfig();
  if (!config) { announce({ state: 'off' }); return; }
  announce({ state: 'loading', error: '' });
  try {
    const { app: A, auth: U, fs: F } = await loadSdk();
    app = A.getApps().length ? A.getApp() : A.initializeApp(config);
    store = F.initializeFirestore(app, {
      localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }),
      ignoreUndefinedProperties: true,
    });
    const emulator = localStorage.getItem('firebaseEmulator');
    const [host, authPort, fsPort] = (emulator || '').split(':');
    if (emulator) F.connectFirestoreEmulator(store, host, Number(fsPort));

    if (!requireSignIn) { await attachSpace(); return; }

    auth = U.getAuth(app);
    if (emulator) U.connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true });
    unsubAuth?.();
    unsubAuth = U.onAuthStateChanged(auth, onUser);
  } catch (err) {
    console.error(err);
    announce({ state: 'error', error: describe(err) });
  }
}

/**
 * No-sign-in mode: both phones point at the same fixed path and start
 * streaming. The first device to connect uploads whatever history it holds.
 */
async function attachSpace() {
  const { fs: F } = sdk;
  const name = await spaceLabel();
  announce({ state: 'live', user: null, family: { id: space, name, members: {} }, error: '' });
  await db.metaSet('familyId', space);
  // Make the parent document real so the Firestore console shows the tree.
  F.setDoc(F.doc(store, 'families', space), { name, touchedAt: F.serverTimestamp() }, { merge: true })
    .catch(err => debug('space doc write skipped:', err.code));
  startStreams(space);
  if (await db.metaGet('uploadedTo', null) !== space) {
    await db.metaSet('uploadedTo', space);
    await uploadEverything();
  }
  schedulePush();
}

async function onUser(user) {
  stopStreams();
  if (!user) {
    announce({ state: 'signed-out', user: null, family: null });
    return;
  }
  announce({ user: { uid: user.uid, email: user.email, name: user.displayName || '' } });
  const { fs: F } = sdk;
  try {
    const link = await F.getDoc(F.doc(store, 'users', user.uid));
    const familyId = link.exists() ? link.data().familyId : null;
    if (!familyId) { announce({ state: 'no-family', family: null }); return; }
    await attachFamily(familyId);
  } catch (err) {
    console.error(err);
    announce({ state: 'error', error: describe(err) });
  }
}

async function attachFamily(familyId) {
  const { fs: F } = sdk;
  const snap = await F.getDoc(F.doc(store, 'families', familyId));
  if (!snap.exists()) { announce({ state: 'no-family', family: null }); return; }
  announce({ state: 'live', family: { id: familyId, ...snap.data() }, error: '' });
  await db.metaSet('familyId', familyId);
  startStreams(familyId);
  schedulePush();
}

function stopStreams() {
  unsubEvents?.(); unsubEvents = null;
  unsubMeta?.(); unsubMeta = null;
}

/* ---------------- pull ---------------- */

async function startStreams(familyId) {
  const { fs: F } = sdk;
  const watermark = await db.metaGet('syncWatermark', 0);
  const events = F.collection(store, 'families', familyId, 'events');

  debug('subscribing from watermark', watermark, new Date(watermark).toISOString());
  unsubEvents = F.onSnapshot(
    F.query(events, F.where('syncedAt', '>', F.Timestamp.fromMillis(watermark))),
    snap => applyRemoteEvents(snap).catch(err => announce({ error: describe(err) })),
    err => announce({ state: 'error', error: describe(err) }),
  );

  unsubMeta = F.onSnapshot(
    F.collection(store, 'families', familyId, 'meta'),
    snap => applyRemoteMeta(snap).catch(() => {}),
    () => {},
  );
}

async function applyRemoteEvents(snap) {
  // A first sync can carry thousands of docs, so read the local side once.
  const changes = snap.docChanges().filter(c =>
    c.type !== 'removed' && !c.doc.metadata.hasPendingWrites);   // skip our own echo
  if (!changes.length) return;

  const local = new Map((await db.allRaw()).map(r => [r.id, r]));
  let highest = await db.metaGet('syncWatermark', 0);
  const incoming = [];

  for (const { doc: d } of changes) {
    const data = d.data();
    const stamped = data.syncedAt?.toMillis?.();
    if (stamped && stamped > highest) highest = stamped;
    const mine = local.get(d.id);
    if (mine && (mine.updated || 0) >= (data.updated || 0)) continue;     // ours is newer
    const { syncedAt, ...row } = data;
    incoming.push({ ...row, id: d.id });
  }

  debug(`pulled ${changes.length} docs, applying ${incoming.length}`);
  if (incoming.length) await db.putMany(incoming, null, { remote: true });
  await db.metaSet('syncWatermark', highest);
  announce({ lastSync: Date.now() });
}

async function applyRemoteMeta(snap) {
  let changed = false;
  for (const change of snap.docChanges()) {
    if (change.type === 'removed') continue;
    const d = change.doc;
    if (d.metadata.hasPendingWrites) continue;
    if (!SYNCED_META.includes(d.id)) continue;
    const data = d.data();
    const localStamp = await db.metaGet(`${d.id}:updated`, 0);
    if ((data.updated || 0) <= localStamp) continue;
    await db.metaSet(d.id, data.value ?? null);
    await db.metaSet(`${d.id}:updated`, data.updated || Date.now());
    changed = true;
  }
  if (changed) db.notify('remote');                  // repaint with the new profile/units
}

/* ---------------- push ---------------- */

const defined = obj => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

export function schedulePush() {
  if (sync.state !== 'live') return;
  clearTimeout(pushTimer);
  // A failed upload must be visible: a silently swallowed one looks like "synced".
  pushTimer = setTimeout(() => {
    pushNow().catch(err => {
      console.error(err);
      announce({ error: describe(err) });
    });
  }, PUSH_DEBOUNCE);
}

export async function pushNow() {
  if (sync.state !== 'live') return;
  if (pushing) { pushAgain = true; return; }
  pushing = true;
  announce({ error: '' });
  try {
    const { fs: F } = sdk;
    const familyId = sync.family.id;
    let rows = await db.dirty();
    announce({ pending: rows.length });

    debug(`pushing ${rows.length} dirty rows`);
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const batch = F.writeBatch(store);
      for (const row of slice) {
        const { dirty, ...doc } = row;
        batch.set(F.doc(store, 'families', familyId, 'events', row.id),
          { ...defined(doc), syncedAt: F.serverTimestamp() });
      }
      const t0 = Date.now();
      await batch.commit();
      debug(`batch ${i / BATCH + 1}: committed ${slice.length} in ${Date.now() - t0}ms`);
      await db.markClean(slice.map(r => r.id));
      debug(`batch ${i / BATCH + 1}: marked clean in ${Date.now() - t0}ms`);
      announce({ pending: Math.max(0, rows.length - i - slice.length), lastSync: Date.now() });
    }

    await pushMeta();
  } finally {
    pushing = false;
    if (pushAgain) { pushAgain = false; schedulePush(); }
  }
}

async function pushMeta() {
  const { fs: F } = sdk;
  const familyId = sync.family.id;
  for (const key of SYNCED_META) {
    const dirtyAt = await db.metaGet(`${key}:dirty`, 0);
    if (!dirtyAt) continue;
    const value = await db.metaGet(key, null);
    await F.setDoc(F.doc(store, 'families', familyId, 'meta', key),
      { value, updated: dirtyAt, syncedAt: F.serverTimestamp() });
    await db.metaSet(`${key}:updated`, dirtyAt);
    await db.metaSet(`${key}:dirty`, 0);
  }
}

/** Call after changing a shared setting (profile, units) so it travels. */
export async function markMetaDirty(key) {
  if (!SYNCED_META.includes(key)) return;
  await db.metaSet(`${key}:dirty`, Date.now());
  schedulePush();
}

/** Mark every local row for upload — used when a device first joins a family. */
export async function uploadEverything() {
  const all = await db.allRaw();
  if (!all.length) return;
  await db.putMany(all.map(r => ({ ...r })), null, { remote: false });
  schedulePush();
}

/* ---------------- accounts & families ---------------- */

export async function signUp(email, password, name) {
  const { auth: U } = sdk;
  const cred = await U.createUserWithEmailAndPassword(auth, email.trim(), password);
  if (name) await U.updateProfile(cred.user, { displayName: name });
  return cred.user;
}

export async function signIn(email, password) {
  const { auth: U } = sdk;
  const cred = await U.signInWithEmailAndPassword(auth, email.trim(), password);
  return cred.user;
}

export async function signOutNow() {
  stopStreams();
  if (auth) await sdk.auth.signOut(auth);
  await db.metaSet('syncWatermark', 0);
  await db.metaSet('familyId', null);
}

export async function createFamily(name) {
  const { fs: F } = sdk;
  const user = auth.currentUser;
  const ref = F.doc(F.collection(store, 'families'));
  await F.setDoc(ref, {
    name: name || 'Our family',
    createdAt: F.serverTimestamp(),
    memberIds: [user.uid],
    members: { [user.uid]: { name: user.displayName || user.email, email: user.email } },
    inviteOpen: false,
    inviteExpires: F.Timestamp.fromMillis(0),
  });
  await F.setDoc(F.doc(store, 'users', user.uid), { familyId: ref.id, name: user.displayName || '' });
  await attachFamily(ref.id);
  await uploadEverything();
  return ref.id;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no I/O/0/1
function makeCode(len = 8) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/** Opens the family to joiners for 24 hours and returns the code to share. */
export async function createInvite() {
  const { fs: F } = sdk;
  const familyId = sync.family.id;
  const code = makeCode();
  const expires = Date.now() + 24 * 3600 * 1000;
  await F.setDoc(F.doc(store, 'invites', code), {
    familyId, createdBy: auth.currentUser.uid,
    expiresAt: F.Timestamp.fromMillis(expires),
  });
  await F.updateDoc(F.doc(store, 'families', familyId), {
    inviteOpen: true,
    inviteExpires: F.Timestamp.fromMillis(expires),
  });
  return { code, expires };
}

export async function revokeInvites() {
  const { fs: F } = sdk;
  await F.updateDoc(F.doc(store, 'families', sync.family.id), {
    inviteOpen: false,
    inviteExpires: F.Timestamp.fromMillis(0),
  });
}

export async function joinFamily(code) {
  const { fs: F } = sdk;
  const user = auth.currentUser;
  const invite = await F.getDoc(F.doc(store, 'invites', code.trim().toUpperCase()));
  if (!invite.exists()) throw new Error('That code is not valid');
  const { familyId, expiresAt } = invite.data();
  if (expiresAt?.toMillis?.() < Date.now()) throw new Error('That code has expired');

  await F.updateDoc(F.doc(store, 'families', familyId), {
    memberIds: F.arrayUnion(user.uid),
    [`members.${user.uid}`]: { name: user.displayName || user.email, email: user.email },
  });
  await F.setDoc(F.doc(store, 'users', user.uid), { familyId, name: user.displayName || '' });
  await attachFamily(familyId);
  await uploadEverything();
  return familyId;
}

/* ---------------- misc ---------------- */

function describe(err) {
  const code = err?.code || '';
  const map = {
    'auth/invalid-credential': 'Wrong email or password',
    'auth/invalid-email': 'That email address looks wrong',
    'auth/email-already-in-use': 'That email already has an account — sign in instead',
    'auth/weak-password': 'Password needs at least 6 characters',
    'auth/network-request-failed': 'No connection to Firebase',
    'auth/operation-not-allowed': 'Enable Email/Password sign-in in the Firebase console',
    'permission-denied': 'Firestore rules rejected that — check the rules are deployed',
    'unavailable': 'Offline — changes are queued and will sync when you reconnect',
    'failed-precondition': 'Firestore needs an index for this query — follow the link in the console',
  };
  return map[code] || err?.message || String(err);
}

/** Wire the engine to local changes; called once at boot. */
export function attachLocalPusher() {
  db.onChange(reason => { if (reason === 'local') schedulePush(); });
  addEventListener('online', () => schedulePush());
}
