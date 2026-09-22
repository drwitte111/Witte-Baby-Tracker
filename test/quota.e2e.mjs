import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const CSV = '/root/.claude/uploads/cf815e03-f7e5-5f24-a6b7-f1485f8a4a45/65328401-export_narababy_nadine_20260922.csv';
await fetch('http://127.0.0.1:8080/emulator/v1/projects/witte-baby-tracker/databases/(default)/documents', { method: 'DELETE' });
const browser = await chromium.launch();
const errors = [];
async function phone(label, writeCap) {
  const c = await browser.newContext({ viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true });
  await c.addInitScript(cap => { localStorage.setItem('firebaseSdkBase', '/sdktest'); localStorage.setItem('firebaseEmulator', '127.0.0.1:9099:8080');
    localStorage.setItem('installHintDismissed', '1'); if (cap) localStorage.setItem('syncWriteCap', String(cap)); }, writeCap);
  const p = await c.newPage();
  p.on('pageerror', e => errors.push(`[${label}] ${e.message}`));
  p.on('console', m => { if (m.type() === 'error') errors.push(`[${label}] ${m.text().slice(0, 140)}`); });
  await p.goto('http://127.0.0.1:8099/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500);
  return p;
}
const stats = p => p.evaluate(() => new Promise(res => { const r = indexedDB.open('witte-baby'); r.onsuccess = () => {
  const q = r.result.transaction('events').objectStore('events').getAll(); q.onsuccess = () => res({ live: q.result.filter(e => !e.deleted).length, dirty: q.result.filter(e => e.dirty).length }); }; }));
async function waitFor(p, fn, label, ms = 120000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return ((Date.now() - t) / 1000).toFixed(1) + 's'; await p.waitForTimeout(700); } return `TIMEOUT ${label}`; }

// A is capped at 150 writes today
const A = await phone('A', 150);
await A.tap('[data-route="settings"]'); await A.waitForTimeout(400);
await A.setInputFiles('#import-file', CSV); await A.waitForTimeout(600);
await A.locator('.sheet .btn', { hasText: 'Import' }).click(); await A.waitForTimeout(6000);
await waitFor(A, async () => { const s = await stats(A); return s.dirty > 0 && s.dirty < 3841; }, 'first batch');
await A.waitForTimeout(3000);
const sA = await stats(A);
const card = (await A.locator('#sync-card').innerText()).replace(/\n+/g, ' | ');
console.log('A dirty after cap:', sA.dirty, '(expect 3841 − ~150)');
console.log('A card says:', card.slice(0, 260));
await A.screenshot({ path: '/tmp/shots/80-throttled.png', fullPage: true });

// B (uncapped) should receive only what A managed to push
const B = await phone('B');
console.log('B rows:', await waitFor(B, async () => (await stats(B)).live >= 100, 'B rows'), '→', (await stats(B)).live);
await B.tap('[data-route="settings"]'); await B.waitForTimeout(600);
console.log('B usage line:', (await B.locator('.usage').innerText()).replace(/\s+/g, ' '));
console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 5).join('\n') : 'no page errors');
await browser.close();
