import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const CSV = '/root/.claude/uploads/cf815e03-f7e5-5f24-a6b7-f1485f8a4a45/65328401-export_narababy_nadine_20260922.csv';
await fetch('http://127.0.0.1:8080/emulator/v1/projects/witte-baby-tracker/databases/(default)/documents', { method: 'DELETE' });
const browser = await chromium.launch();
const errors = [];
async function phone(label) {
  const c = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await c.addInitScript(() => { localStorage.setItem('firebaseSdkBase', '/sdktest'); localStorage.setItem('firebaseEmulator', '127.0.0.1:9099:8080'); localStorage.setItem('installHintDismissed', '1'); });
  const p = await c.newPage();
  p.on('pageerror', e => errors.push(`[${label}] ${e.message}`));
  p.on('console', m => { if (m.type() === 'error' && !/ERR_INTERNET/.test(m.text())) errors.push(`[${label}] ${m.text().slice(0, 140)}`); });
  await p.goto('http://127.0.0.1:8099/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500);
  return p;
}
const header = p => p.locator('#profile-name').innerText();
const rows = p => p.evaluate(() => new Promise(res => { const r = indexedDB.open('witte-baby'); r.onsuccess = () => {
  const q = r.result.transaction('events').objectStore('events').getAll(); q.onsuccess = () => res(q.result.filter(e => !e.deleted).length); }; }));
async function waitFor(p, fn, label, ms = 120000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return ((Date.now() - t) / 1000).toFixed(1) + 's'; await p.waitForTimeout(800); } return `TIMEOUT ${label}`; }

// A: import Nadine
const A = await phone('A');
console.log('A header before import:', await header(A));
await A.tap('[data-route="settings"]'); await A.waitForTimeout(400);
await A.setInputFiles('#import-file', CSV); await A.waitForTimeout(600);
await A.locator('.sheet .btn', { hasText: 'Import' }).click(); await A.waitForTimeout(5000);
console.log('A header after import:', await header(A), '| babies listed:', await A.locator('.baby').count(), '| entries:', await A.locator('.baby.on .muted').innerText());
console.log('A upload:', await waitFor(A, async () => (await A.evaluate(() => new Promise(res => { const r = indexedDB.open('witte-baby'); r.onsuccess = () => { const q = r.result.transaction('events').objectStore('events').getAll(); q.onsuccess = () => res(q.result.filter(e => e.dirty).length); }; }))) === 0, 'A upload', 200000));

// B: fresh phone, nothing to type — should show Nadine with everything
const B = await phone('B');
console.log('B pull:', await waitFor(B, async () => (await rows(B)) >= 3841, 'B pull'));
console.log('B follows profile:', await waitFor(B, async () => (await header(B)) === 'Nadine', 'B header'), '→', await header(B));
await B.tap('[data-route="home"]'); await B.waitForTimeout(900);
console.log('B home last feed:', await B.locator('[data-live="feed-since"]').innerText());

// A adds a second baby and switches; B must follow, and its home must be empty for the new baby
await A.tap('[data-route="settings"]'); await A.waitForTimeout(500);
await A.tap('[data-act="add-baby"]'); await A.waitForTimeout(400);
await A.fill('.sheet [name=nm]', 'Theo'); await A.fill('.sheet [name=bd]', '2026-09-01');
await A.locator('.sheet .btn', { hasText: 'Add' }).click(); await A.waitForTimeout(1500);
console.log('A header after add:', await header(A), '| babies:', await A.locator('.baby').count());
await A.screenshot({ path: '/tmp/shots/70-babies.png', fullPage: true });
console.log('B follows switch:', await waitFor(B, async () => (await header(B)) === 'Theo', 'B switch'), '→', await header(B));
await B.tap('[data-route="home"]'); await B.waitForTimeout(900);
console.log('B home for Theo:', await B.locator('[data-live="feed-since"]').innerText());
await B.tap('[data-act="diaper"][data-kind="wet"]'); await B.waitForTimeout(2500);          // logged under Theo

// A switches back to Nadine; B follows and Theo's diaper is not in Nadine's log
await A.tap('[data-route="settings"]'); await A.waitForTimeout(500);
await A.locator('.baby', { hasText: 'Nadine' }).tap(); await A.waitForTimeout(1200);
console.log('B back to Nadine:', await waitFor(B, async () => (await header(B)) === 'Nadine', 'B back'));
await B.tap('[data-route="log"]'); await B.waitForTimeout(900);
console.log('B first log entry (Nadine):', (await B.locator('.entry').first().innerText()).replace(/\n/g, ' | ').slice(0, 60));
await A.locator('.baby', { hasText: 'Theo' }).tap(); await A.waitForTimeout(800);
await A.tap('[data-route="log"]'); await A.waitForTimeout(900);
console.log('A log for Theo:', await A.locator('.entry').count(), 'entry →', (await A.locator('.entry').first().innerText()).replace(/\n/g, ' | ').slice(0, 40));
console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 5).join('\n') : 'no page errors');
await browser.close();
