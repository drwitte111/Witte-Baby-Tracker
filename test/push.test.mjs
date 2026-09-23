// Notification wording (unit) and the sender end to end against the emulator
// with a fake push endpoint:  node test/push.test.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
process.env.SEND_PUSH_TEST = '1';
process.env.VAPID_PUBLIC_KEY = keys.publicKey; process.env.VAPID_PRIVATE_KEY = keys.privateKey;
const { compose } = await import('../tools/send-push.mjs');

const at = new Date('2026-09-22T20:41:00-04:00').getTime();
let m = compose({ kind: 'sleep-start', baby: 'Nadine', by: 'Alaina', at, tz: 'America/New_York' });
assert.equal(m.title, 'Nadine is asleep');
assert.equal(m.body, 'Sleep timer started at 8:41 PM (Alaina)');
m = compose({ kind: 'sleep-end', baby: 'Nadine', by: 'David', at, tz: 'America/New_York', duration: '1h 12m' });
assert.equal(m.title, 'Nadine woke up');
assert.equal(m.body, 'Slept 1h 12m · woke at 8:41 PM (David)');
m = compose({ kind: 'sleep-pause', baby: 'Nadine', by: 'Alaina', at, tz: 'America/New_York', elapsed: '42m' });
assert.equal(m.title, 'Nadine stirred'); assert.equal(m.body, 'Sleep timer paused at 42m · 8:41 PM (Alaina)');
m = compose({ kind: 'sleep-resume', baby: 'Nadine', by: 'Alaina', at, tz: 'America/New_York' });
assert.equal(m.title, 'Nadine settled'); assert.equal(m.body, 'Sleep timer running again · 8:41 PM (Alaina)');
assert.deepEqual(compose({ kind: 'test', baby: 'Nadine', text: 'Test from David' }), { title: 'Nadine', body: 'Test from David' });
console.log('push wording: ok');

// ---- end to end: two subscriptions in the emulator; one is the sender (skipped),
// the other points at a fake push service that answers 410 (gone) → must be deleted.
const EMU = 'http://127.0.0.1:8080';
const DOCS = `${EMU}/v1/projects/witte-baby-tracker/databases/(default)/documents/families/witte/push`;
// web-push always uses TLS, so the fake push service must be HTTPS (self-signed).
import https from 'node:https';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
const dir = mkdtempSync(`${tmpdir()}/fakepush-`);
execSync(`openssl req -x509 -newkey rsa:2048 -nodes -subj /CN=127.0.0.1 -keyout ${dir}/key.pem -out ${dir}/cert.pem -days 1 2>/dev/null`);
const hits = [];
const fake = https.createServer({ key: readFileSync(`${dir}/key.pem`), cert: readFileSync(`${dir}/cert.pem`) },
  (req, res) => { hits.push(req.url); res.writeHead(410); res.end(); }).listen(9911);
// a real P-256 key so web-push accepts the subscription and actually contacts the endpoint
import { generateKeyPairSync, randomBytes } from 'node:crypto';
const p256dh = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'jwk' });
const raw = Buffer.concat([Buffer.from([4]), Buffer.from(p256dh.x, 'base64url'), Buffer.from(p256dh.y, 'base64url')]).toString('base64url');
const sub = id => JSON.stringify({ endpoint: `https://127.0.0.1:9911/${id}`, keys: { p256dh: raw, auth: randomBytes(16).toString('base64url') } });
const put = (id, body) => fetch(`${DOCS}?documentId=${id}`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ fields: { sub: { stringValue: body }, device: { stringValue: id } } }) });
await fetch(`${DOCS}/sender`, { method: 'DELETE' }); await fetch(`${DOCS}/other`, { method: 'DELETE' });
await put('sender', sub('sender')); await put('other', sub('other'));

// async spawn: the fake push service lives in this process and must stay responsive
const run = await new Promise(resolve => {
  const child = spawn('node', ['tools/send-push.mjs', JSON.stringify({ kind: 'sleep-start', from: 'sender', baby: 'Nadine', at })],
    { env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/proxy/i.test(k))),
             NO_PROXY: '127.0.0.1,localhost', FIRESTORE_HOST: EMU, SEND_PUSH_TEST: '', NODE_TLS_REJECT_UNAUTHORIZED: '0' } });
  let stdout = '', stderr = '';
  child.stdout.on('data', d => stdout += d); child.stderr.on('data', d => stderr += d);
  const t = setTimeout(() => child.kill(), 60000);
  child.on('close', status => { clearTimeout(t); resolve({ status, stdout, stderr }); });
});
fake.closeAllConnections?.(); fake.close();
assert.equal(run.status, 0, run.stderr);
assert.deepEqual(hits, ['/other'], 'only the other phone is contacted');
const left = await (await fetch(DOCS)).json();
const ids = (left.documents || []).map(d => d.name.split('/').pop());
assert.ok(ids.includes('sender') && !ids.includes('other'), `stale subscription pruned, sender kept: ${ids}`);
console.log('push sender: contacted only the other phone, pruned the dead subscription');
