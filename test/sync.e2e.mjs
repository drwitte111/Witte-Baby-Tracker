import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const CSV = '/root/.claude/uploads/cf815e03-f7e5-5f24-a6b7-f1485f8a4a45/65328401-export_narababy_nadine_20260922.csv';
const CFG = `{ apiKey: "demo-key", authDomain: "127.0.0.1", projectId: "demo-witte", appId: "1:1:web:1" }`;
await fetch('http://127.0.0.1:8080/emulator/v1/projects/witte-baby-tracker/databases/(default)/documents', { method: 'DELETE' });
const browser = await chromium.launch();
const errors = [];
const iPhone = { viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1' };

async function phone(label) {
  const c = await browser.newContext(iPhone);
  await c.addInitScript(() => {
    localStorage.setItem('firebaseSdkBase', '/sdktest');
    localStorage.setItem('firebaseEmulator', '127.0.0.1:9099:8080');
    localStorage.setItem('syncDebug', '1');
    localStorage.setItem('installHintDismissed', '1');
  });
  const p = await c.newPage();
  p.on('pageerror', e => errors.push(`[${label}] ${e.message}`));
  p.on('console', m => { const t = m.text();
    if (t.startsWith('[sync]')) console.log(`[${label}]`, t.slice(0, 120));
    else if (m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED/.test(t)) errors.push(`[${label}] ${t.slice(0,160)}`); });
  await p.goto('http://127.0.0.1:8099/', { waitUntil: 'domcontentloaded' }); // a live Firestore stream means the network is never idle
  p._ctx = c; return p;
}
const stats = p => p.evaluate(() => new Promise(res => {
  const r = indexedDB.open('witte-baby');
  r.onsuccess = () => { const q = r.result.transaction('events').objectStore('events').getAll();
    q.onsuccess = () => res({ live: q.result.filter(e => !e.deleted).length, dirty: q.result.filter(e => e.dirty).length }); };
}));
async function until(p, test, label, timeout = 240000) {
  const t = Date.now();
  while (Date.now() - t < timeout) {
    if (test(await stats(p))) return ((Date.now() - t) / 1000).toFixed(1);
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log(`TIMEOUT ${label}; last`, JSON.stringify(await stats(p)));
  return -1;
}
// Nothing to do: the project is baked into assets/firebase-config.js, so a
// phone is connected the moment it opens the page.
async function connect(p) { await p.waitForTimeout(3000); }

// Phone A: has the Nara history, connects, uploads. No accounts anywhere.
const A = await phone('A');
await A.tap('[data-route="settings"]'); await A.waitForTimeout(400);
await A.setInputFiles('#import-file', CSV); await A.waitForTimeout(600);
await A.locator('.sheet .btn', { hasText: 'Import' }).click(); await A.waitForTimeout(5000);
await connect(A);
await A.tap('[data-route="settings"]'); await A.waitForTimeout(800);
console.log('A card:', (await A.locator('#sync-card').innerText()).replace(/\n+/g, ' | '));
console.log('A upload took', await until(A, s => s.dirty === 0 && s.live >= 3841, 'A upload'), 's');

// Phone B: nothing local, just connects — should pull everything, no code to enter
const B = await phone('B');
await connect(B);
console.log('B pulled everything in', await until(B, s => s.live >= 3841, 'B pull'), 's');
await B.tap('[data-route="settings"]'); await B.waitForTimeout(600);
console.log('B card:', (await B.locator('#sync-card').innerText()).replace(/\n+/g, ' | '));

// live both ways
await B.tap('[data-route="home"]'); await B.waitForTimeout(600);
await B.tap('[data-act="diaper"][data-kind="both"]'); await B.waitForTimeout(500);
console.log('A saw B\'s entry in', await until(A, s => s.live >= 3842, 'A<-B', 30000), 's');
await A.tap('[data-route="home"]'); await A.waitForTimeout(500);
await A.tap('[data-act="sleep-start"]'); await A.waitForTimeout(1200);
await A.tap('[data-act="sleep-wake"]'); await A.waitForTimeout(800);
console.log('B saw A\'s entry in', await until(B, s => s.live >= 3843, 'B<-A', 30000), 's');

// offline on B, then back
await B._ctx.setOffline(true);
await B.tap('[data-act="diaper"][data-kind="wet"]'); await B.waitForTimeout(1200);
await B._ctx.setOffline(false);
console.log('offline entry reached A in', await until(A, s => s.live >= 3844, 'A<-offline B', 60000), 's');

await B.tap('[data-route="settings"]'); await B.waitForTimeout(800);
await B.screenshot({ path: '/tmp/shots/40-nologin-sync.png' });
console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 6).join('\n') : 'no page errors');
await browser.close();
