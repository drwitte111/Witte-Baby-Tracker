/**
 * Push notifications to the other phone. Two halves:
 *  - receiving: this phone subscribes (Apple's push service, VAPID) and stores
 *    the subscription in Firestore so the sender can find it;
 *  - sending: when THIS phone starts or ends a sleep, it triggers a GitHub
 *    Action (repository_dispatch) that pushes to every other subscription.
 * The GitHub token lives only on the phone; it never syncs or ships in the repo.
 */
import { db } from './db.js';
import { getConfig } from './sync.js';

const REPO = 'drwitte111/Witte-Baby-Tracker';
let cfg = null;
async function conf() {
  if (!cfg) { try { cfg = await import('../assets/firebase-config.js'); } catch { cfg = {}; } }
  return cfg;
}

export const push = {
  supported: 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
  standalone: navigator.standalone === true || matchMedia('(display-mode: standalone)').matches,
};

export async function deviceId() {
  let id = await db.metaGet('deviceId', null);
  if (!id) { id = 'd-' + Math.random().toString(36).slice(2, 10); await db.metaSet('deviceId', id); }
  return id;
}

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

/* ---------------- receiving ---------------- */

export async function status() {
  if (!push.supported) return { state: 'unsupported' };
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  const published = !!sub && await db.metaGet('pushPublished', '') === sub.endpoint;
  return { state: sub ? 'on' : Notification.permission === 'denied' ? 'denied' : 'off', sub, published };
}

/** Ask permission, subscribe, and publish the subscription. Must run from a tap. */
export async function enable(caregiver) {
  const { VAPID_PUBLIC_KEY, SPACE } = await conf();
  if (!VAPID_PUBLIC_KEY) throw new Error('No push key in the config');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications were not allowed');
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) });
  await publish(sub, caregiver);
  return sub;
}

/** Store the subscription where the sender can find it, and remember that it landed. */
async function publish(sub, caregiver) {
  const { SPACE } = await conf();
  const F = (await import('./sync.js')).firestore();
  if (!F) throw new Error('Sync is not connected');
  await F.setDoc(F.doc(F.store, 'families', SPACE || 'witte', 'push', await deviceId()),
    { sub: JSON.stringify(sub.toJSON()), device: caregiver || '', updated: Date.now() });
  await db.metaSet('pushPublished', sub.endpoint);
}

/**
 * Self-heal: a subscription that exists on this phone but never reached
 * Firestore (the write failed, or the app was closed mid-way) is published
 * again. Costs nothing when it already landed. Safe to call any time sync is live.
 */
export async function ensurePublished(caregiver) {
  try {
    const { sub } = await status();
    if (!sub) return false;
    if (await db.metaGet('pushPublished', '') === sub.endpoint) return true;
    await publish(sub, caregiver);
    return true;
  } catch (err) { console.warn('push publish pending:', err.message); return false; }
}

export async function disable() {
  const { SPACE } = await conf();
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  await sub?.unsubscribe();
  await db.metaSet('pushPublished', '');
  const F = (await import('./sync.js')).firestore();
  if (F) await F.deleteDoc(F.doc(F.store, 'families', SPACE || 'witte', 'push', await deviceId())).catch(() => {});
}

/* ---------------- sending ---------------- */

export async function getToken() { return db.metaGet('ghToken', ''); }
export async function setToken(t) { return db.metaSet('ghToken', (t || '').trim()); }

/**
 * Tell the other phone. Fire-and-forget: a failure here must never block
 * logging, so it only surfaces through the returned promise.
 */
export async function send(kind, fields = {}) {
  const token = await getToken();
  if (!token) return { skipped: 'no-token' };
  const body = { event_type: 'notify', client_payload: { kind, from: await deviceId(), at: Date.now(),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone, ...fields } };
  const res = await fetch(`https://api.github.com/repos/${REPO}/dispatches`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 204) return { ok: true };
  const why = res.status === 401 ? 'GitHub rejected the token (401). Paste a fresh one.'
    : res.status === 403 ? 'Token lacks permission (403): it needs Contents: Read and write on this repo.'
    : res.status === 404 ? 'GitHub said 404: the token cannot see this repo — check its repository access.'
    : `GitHub answered ${res.status}.`;
  return { error: why, status: res.status };
}

/** Plain-words verdict for a send() result, for a toast. */
export function explain(r) {
  if (!r) return '';
  if (r.ok) return 'Other phone notified';
  if (r.skipped === 'no-token') return 'Not sent: this phone has no GitHub token (More → Notifications)';
  return `Not sent: ${r.error}`;
}

/** How many phones are subscribed to receive. */
export async function receiverCount() {
  try {
    const { SPACE } = await conf();
    const F = (await import('./sync.js')).firestore();
    if (!F) return null;
    const snap = await F.getDocs(F.collection(F.store, 'families', SPACE || 'witte', 'push'));
    return snap.size;
  } catch { return null; }
}
