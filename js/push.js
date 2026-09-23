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
  return { state: sub ? 'on' : Notification.permission === 'denied' ? 'denied' : 'off', sub };
}

/** Ask permission, subscribe, and publish the subscription. Must run from a tap. */
export async function enable(caregiver) {
  const { VAPID_PUBLIC_KEY, SPACE } = await conf();
  if (!VAPID_PUBLIC_KEY) throw new Error('No push key in the config');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications were not allowed');
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) });
  const id = await deviceId();
  const F = (await import('./sync.js')).firestore();
  if (!F) throw new Error('Sync is not connected');
  await F.setDoc(F.doc(F.store, 'families', SPACE || 'witte', 'push', id),
    { sub: JSON.stringify(sub.toJSON()), device: caregiver || '', updated: Date.now() });
  return sub;
}

export async function disable() {
  const { SPACE } = await conf();
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  await sub?.unsubscribe();
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
  return { error: `GitHub ${res.status}` };
}
