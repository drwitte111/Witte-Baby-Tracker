import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const CSV = '/root/.claude/uploads/cf815e03-f7e5-5f24-a6b7-f1485f8a4a45/65328401-export_narababy_nadine_20260922.csv';
const CFG = `{ apiKey: "demo-key", authDomain: "127.0.0.1", projectId: "demo-witte", appId: "1:1:web:1" }`;
await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-witte/accounts', { method: 'DELETE' });
await fetch('http://127.0.0.1:8080/emulator/v1/projects/demo-witte/databases/(default)/documents', { method: 'DELETE' });

const browser = await chromium.launch();
const errors = [];
async function phone(label) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await c.addInitScript(() => {
    localStorage.setItem('firebaseSdkBase', '/sdktest');
    localStorage.setItem('firebaseEmulator', '127.0.0.1:9099:8080');
    localStorage.setItem('syncDebug', '1');
  });
  const p = await c.newPage();
  p.on('pageerror', e => errors.push(`[${label}] ${e.message}`));
  p.on('console', m => {
    const t = m.text();
    if (t.startsWith('[sync]')) console.log(`[${label}]`, t);
    else if (m.type() === 'error' && !t.includes('ERR_INTERNET_DISCONNECTED')) errors.push(`[${label}] ${t.slice(0,200)}`);
  });
  await p.goto('http://127.0.0.1:8099/', { waitUntil: 'networkidle' });
  p._ctx = c; p._label = label;
  return p;
}
const status = p => p.locator('#sync-card .card-head .muted').innerText();
const stats = p => p.evaluate(() => new Promise(res => {
  const r = indexedDB.open('witte-baby');
  r.onsuccess = () => {
    const q = r.result.transaction('events').objectStore('events').getAll();
    q.onsuccess = () => res({
      live: q.result.filter(e => !e.deleted).length,
      dirty: q.result.filter(e => e.dirty).length,
      total: q.result.length,
    });
  };
}));
const localCount = async p => (await stats(p)).live;
async function until(p, test, label, timeout = 240000) {
  const t = Date.now();
  while (Date.now() - t < timeout) {
    const s = await stats(p);
    if (test(s)) return (Date.now() - t) / 1000;
    await new Promise(r => setTimeout(r, 1000));
  }
  const s = await stats(p);
  console.log(`TIMEOUT waiting for ${label}; last:`, JSON.stringify(s));
  return -1;
}

async function connect(p, { name, email }) {
  await p.click('[data-route="settings"]'); await p.waitForTimeout(400);
  await p.fill('#sync-card [name="cfg"]', CFG);
  await p.click('[data-sync="save-config"]');
  await p.waitForLoadState('networkidle');
  await p.click('[data-route="settings"]'); await p.waitForTimeout(1200);
  await p.fill('#sync-card [name="name"]', name);
  await p.fill('#sync-card [name="email"]', email);
  await p.fill('#sync-card [name="password"]', 'test1234');
  await p.click('[data-sync="sign-up"]'); await p.waitForTimeout(2500);
}

// A: import 3841 rows THEN create the family — exercises the bulk upload path
const A = await phone('A');
await A.click('[data-route="settings"]'); await A.waitForTimeout(300);
await A.setInputFiles('#import-file', CSV); await A.waitForTimeout(600);
await A.locator('.sheet .btn', { hasText: 'Import' }).click(); await A.waitForTimeout(5000);
console.log('A local rows after import:', await localCount(A));

await connect(A, { name: 'Alaina', email: 'a@example.com' });
const t0 = Date.now();
await A.click('[data-sync="create-family"]');
const upSecs = await until(A, s => s.dirty === 0 && s.total >= 3841, 'A outbox drain');
console.log(`A uploaded 3841 rows in ${upSecs}s`);
await A.click('[data-sync="invite"]'); await A.waitForTimeout(1500);
const code = (await A.locator('.sheet p[style*="letter-spacing"]').innerText()).trim();
await A.locator('.sheet .btn', { hasText: 'Cancel' }).click();

// B joins and should pull the whole history
const B = await phone('B');
await connect(B, { name: 'David', email: 'd@example.com' });
await B.fill('#sync-card [name="code"]', code);
const t1 = Date.now();
await B.click('[data-sync="join-family"]');
const downSecs = await until(B, s => s.live >= 3841, 'B pull');
console.log(`B pulled ${await localCount(B)} rows in ${downSecs}s`);
console.log('B status:', (await status(B)).trim());

// offline queue: B logs entries with the network down, then reconnects
await B._ctx.setOffline(true);
await B.click('[data-route="home"]'); await B.waitForTimeout(600);
await B.click('[data-act="diaper"][data-kind="dirty"]'); await B.waitForTimeout(300);
await B.click('[data-act="diaper"][data-kind="wet"]'); await B.waitForTimeout(1500);
const offlineAdded = await localCount(B);
console.log('B offline, local rows:', offlineAdded);
await B._ctx.setOffline(false);
const backSecs = await until(A, s => s.live >= 3843, 'A receives B offline entries', 60000);
console.log(`A rows after B reconnected: ${await localCount(A)} (took ${backSecs}s)`);

console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 8).join('\n') : 'no page errors');
await browser.close();
