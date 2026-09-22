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
 *
 * This file is the engine: config, streams, push/pull, budget, status. The
 * optional per-caregiver account flow (REQUIRE_SIGN_IN) is in sync-accounts.js.
 */
import { db } from './db.js';

const SDK_VERSION = '12.19.0';
// Overridable so the emulator harness can serve the SDK locally.
const sdkBase = () => localStorage.getItem('firebaseSdkBase')
  || `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;

// Shared across devices. Running timers are included so a sleep started on one
// phone shows (and can be stopped) on the other.
const SYNCED_META = ['profiles', 'current', 'units', 'profile', 'activeSleep', 'activeFeed'];

/**
 * Free-tier guard. Firestore's Spark plan allows 50,000 reads and 20,000
 * writes per project per day. Two phones share that, so each phone stops at
 * well under half and resumes after midnight — dirty rows simply wait, and
 * nothing is lost. Normal use is ~25 of each per day; the caps exist for the
 * one-off cases (a 4,000-row import, a repeated re-upload, a bug).
 */
export const QUOTA = { reads: 50000, writes: 20000 };
const cap = key => Number(localStorage.getItem(`sync${key}Cap`)) || (key === 'Write' ? 9000 : 22000);
const usageKey = () => { const d = new Date(); return `usage:${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
let usage = { reads: 0, writes: 0, day: usageKey() };

async function loadUsage() {
  const stored = await db.metaGet(usageKey(), null);
  usage = stored ? { ...stored, day: usageKey() } : { reads: 0, writes: 0, day: usageKey() };
  announce({ usage: { ...usage } });
}
async function count(kind, n) {
  if (usage.day !== usageKey()) await loadUsage();                 // midnight rolled over
  usage[kind] += n;
  await db.metaSet(usageKey(), { reads: usage.reads, writes: usage.writes });
  announce({ usage: { ...usage } });
}
const writesLeft = () => Math.max(0, cap('Write') - usage.writes);
const readsLeft = () => Math.max(0, cap('Read') - usage.reads);
export function budget() { return { ...usage, writeCap: cap('Write'), readCap: cap('Read') }; }

function msToMidnight() { const d = new Date(); d.setHours(24, 0, 5, 0); return d.getTime() - Date.now(); }
let resumeTimer = null;
function resumeAfterMidnight() {
  clearTimeout(resumeTimer);
  resumeTimer = setTimeout(async () => {
    await loadUsage();
    announce({ throttled: '' });
    if (sync.state === 'live' && !unsubEvents) startStreams(sync.family.id);
    schedulePush();
  }, msToMidnight());
}
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
  usage: { reads: 0, writes: 0 },
  throttled: '',         // '' | 'writes' | 'reads' — paused until midnight
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

    // Per-caregiver accounts: the whole flow lives in sync-accounts.js and is
    // only loaded when the config asks for it.
    auth = U.getAuth(app);
    if (emulator) U.connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true });
    const accounts = await import('./sync-accounts.js');
    accounts.bind({ sdk, auth, store, announce, describe, startStreams, stopStreams, schedulePush, uploadEverything, db });
    unsubAuth?.();
    unsubAuth = U.onAuthStateChanged(auth, accounts.onUser);
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
  await loadUsage();
  // Make the parent document real once, so the Firestore console shows the tree.
  if (await db.metaGet('spaceDocWritten', null) !== space) {
    await F.setDoc(F.doc(store, 'families', space), { name }, { merge: true })
      .catch(err => debug('space doc write skipped:', err.code));
    await count('writes', 1);
    await db.metaSet('spaceDocWritten', space);
  }
  startStreams(space);
  if (await db.metaGet('uploadedTo', null) !== space) {
    await db.metaSet('uploadedTo', space);
    await uploadEverything();
  }
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
  if (!snap.metadata.fromCache) await count('reads', changes.length);
  if (readsLeft() === 0 && !sync.throttled) {
    // Over this phone's share for today: stop listening, resume after midnight.
    stopStreams();
    announce({ throttled: 'reads' });
    resumeAfterMidnight();
  }

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
  const fresh = snap.docChanges().filter(c => c.type !== 'removed' && !c.doc.metadata.hasPendingWrites);
  if (fresh.length && !snap.metadata.fromCache) await count('reads', fresh.length);
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

    if (usage.day !== usageKey()) await loadUsage();
    const allowed = Math.min(rows.length, writesLeft());
    if (allowed < rows.length) {
      debug(`write budget: ${allowed} of ${rows.length} today`);
      announce({ throttled: 'writes' });
      resumeAfterMidnight();
    } else if (sync.throttled === 'writes') announce({ throttled: '' });
    rows = rows.slice(0, allowed);

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
      await count('writes', slice.length);
      debug(`batch ${i / BATCH + 1}: committed ${slice.length} in ${Date.now() - t0}ms`);
      await db.markClean(slice.map(r => r.id));
      debug(`batch ${i / BATCH + 1}: marked clean in ${Date.now() - t0}ms`);
      announce({ pending: Math.max(0, rows.length - i - slice.length), lastSync: Date.now() });
    }
    if (allowed < (await db.dirty()).length) announce({ pending: (await db.dirty()).length });

    if (writesLeft() > 0) await pushMeta();
    if (writesLeft() > 0) await publishStatus();
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
    await count('writes', 1);
    await db.metaSet(`${key}:updated`, dirtyAt);
    await db.metaSet(`${key}:dirty`, 0);
  }
}

/**
 * One small document a widget can read with a single GET: the current baby,
 * what is running, and the last feed / sleep / diaper. Derived from local
 * data, so it is rewritten after every push and never needs a query.
 */
let statusJson = '';
async function publishStatus() {
  const { fs: F } = sdk;
  const profiles = await db.metaGet('profiles', []);
  const current = await db.metaGet('current', null);
  const baby = profiles.find(p => p.id === current) || profiles[0] || null;
  const [lastFeed, lastSleep, lastDiaper] = await Promise.all([
    db.latest('breastfeed'), db.latest('sleep', e => !!e.end), db.latest('diaper'),
  ]);
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const today = await db.range(dayStart.getTime(), Date.now() + 1);
  const pick = (ev, keys) => ev ? Object.fromEntries(keys.filter(k => ev[k] != null).map(k => [k, ev[k]])) : null;

  const status = {
    baby: baby ? { id: baby.id, name: baby.name, birth: baby.birth || null } : null,
    activeSleep: await db.metaGet('activeSleep', null),
    activeFeed: await db.metaGet('activeFeed', null),
    lastFeed: pick(lastFeed, ['start', 'leftSec', 'rightSec', 'beginSide', 'endSide']),
    lastSleep: pick(lastSleep, ['start', 'end', 'durationSec']),
    lastDiaper: pick(lastDiaper, ['start', 'wet', 'dirty']),
    today: {
      feeds: today.filter(e => e.type === 'breastfeed').length,
      diapers: today.filter(e => e.type === 'diaper').length,
    },
    updated: Date.now(),
  };
  const key = JSON.stringify({ ...status, updated: 0 });
  if (key === statusJson) return;                  // nothing changed since last publish
  statusJson = key;
  await F.setDoc(F.doc(store, 'families', sync.family.id, 'meta', 'status'), defined(status));
  await count('writes', 1);
  debug('status published');
}

/** Call after changing a shared setting (profile, units) so it travels. */
export async function markMetaDirty(key) {
  if (!SYNCED_META.includes(key)) return;
  await db.metaSet(`${key}:dirty`, Date.now());
  // A timer starting or stopping is what the other phone is waiting on: no batching delay.
  if (key === 'activeSleep' || key === 'activeFeed') pushNow().catch(err => announce({ error: describe(err) }));
  else schedulePush();
}

/** Mark every local row for upload — used when a device first joins a family. */
export async function uploadEverything() {
  const all = await db.allRaw();
  if (!all.length) return;
  await db.putMany(all.map(r => ({ ...r })), null, { remote: false });
  schedulePush();
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
  // Coming back to the foreground: send anything that queued while iOS had us frozen.
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pushNow().catch(() => {});
  });
}
