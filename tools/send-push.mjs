// Sends one web-push notification to every subscribed phone except the sender.
// Run by .github/workflows/notify.yml; needs VAPID_PRIVATE_KEY in the env.
//
//   node tools/send-push.mjs '<client_payload json>'
//
// Subscriptions live in Firestore at families/<SPACE>/push/<deviceId>, written
// by the app when a phone turns notifications on. Rules make that path
// readable without auth, so this needs no Firebase credentials at all.
import webpush from 'web-push';

const PROJECT = process.env.FIREBASE_PROJECT || 'witte-baby-tracker';
const SPACE = process.env.SPACE || 'witte';
// FIRESTORE_HOST lets the test point at the emulator.
const HOST = process.env.FIRESTORE_HOST || 'https://firestore.googleapis.com';
const BASE = `${HOST}/v1/projects/${PROJECT}/databases/(default)/documents/families/${SPACE}/push`;

const payload = JSON.parse(process.argv[2] || '{}');
// Public key comes from the same config file the app uses; only the private half is a secret.
const publicKey = process.env.VAPID_PUBLIC_KEY || (await import('../assets/firebase-config.js').catch(() => ({}))).VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
if (!publicKey || !privateKey) { console.error('VAPID keys missing (VAPID_PRIVATE_KEY secret, VAPID_PUBLIC_KEY in assets/firebase-config.js)'); process.exit(1); }
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://drwitte111.github.io/Witte-Baby-Tracker/', publicKey, privateKey);

/** Title and body for a payload from the app. Exported for the test. */
export function compose(p) {
  const baby = p.baby || 'Baby';
  const who = p.by ? ` (${p.by})` : '';
  const at = p.at ? new Date(p.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: p.tz || 'America/New_York' }) : '';
  switch (p.kind) {
    case 'sleep-start': return { title: `${baby} is asleep`, body: `Sleep timer started${at ? ` at ${at}` : ''}${who}` };
    case 'sleep-end':   return { title: `${baby} woke up`, body: `Slept ${p.duration || ''}${at ? ` · woke at ${at}` : ''}${who}`.replace('Slept  ·', 'Woke') };
    default:            return { title: baby, body: p.text || 'Update' };
  }
}

const decode = v => v?.stringValue ?? v?.integerValue ?? (v?.mapValue ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, decode(x)])) : null);

async function main() {
  const res = await fetch(`${BASE}?pageSize=50`);
  if (!res.ok) throw new Error(`Firestore ${res.status}: ${await res.text()}`);
  const docs = (await res.json()).documents || [];
  const targets = docs.map(d => ({ name: d.name, id: d.name.split('/').pop(), ...Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, decode(v)])) }))
    .filter(t => t.sub && t.id !== payload.from);
  const msg = compose(payload);
  console.log(`sending "${msg.title}" to ${targets.length} phone(s)`);
  let sent = 0;
  for (const t of targets) {
    const sub = typeof t.sub === 'string' ? JSON.parse(t.sub) : t.sub;
    try {
      await webpush.sendNotification(sub, JSON.stringify({ ...msg, kind: payload.kind, at: payload.at }), { TTL: 600, urgency: 'high' });
      sent++;
    } catch (err) {
      console.log(`  ${t.id}: ${err.statusCode || err.message}`);
      if (err.statusCode === 404 || err.statusCode === 410) {          // phone unsubscribed or app removed: forget it
        await fetch(`${HOST}/v1/${t.name}`, { method: 'DELETE' });
        console.log(`  ${t.id}: removed stale subscription`);
      }
    }
  }
  console.log(`sent ${sent}/${targets.length}`);
}

if (process.argv[1] && process.argv[1].endsWith('send-push.mjs') && !process.env.SEND_PUSH_TEST) main().catch(err => { console.error(err); process.exit(1); });
