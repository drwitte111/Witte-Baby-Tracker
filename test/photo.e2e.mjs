import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
await fetch('http://127.0.0.1:8080/emulator/v1/projects/witte-baby-tracker/databases/(default)/documents', { method: 'DELETE' }).catch(() => {});
const browser = await chromium.launch();
const errors = [];
async function phone(label) {
  const c = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await c.addInitScript(() => { localStorage.setItem('firebaseSdkBase', '/sdktest'); localStorage.setItem('firebaseEmulator', '127.0.0.1:9099:8080'); localStorage.setItem('installHintDismissed', '1'); });
  const p = await c.newPage(); p.on('pageerror', e => errors.push(`[${label}] ${e.message}`));
  await p.goto('http://127.0.0.1:8099/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500); return p;
}
const A = await phone('A'), B = await phone('B');
await A.tap('[data-route="settings"]'); await A.waitForTimeout(400);
await A.tap('[data-act="add-baby"]'); await A.waitForTimeout(300);
await A.fill('.sheet [name=nm]', 'Nadine'); await A.locator('.sheet .btn', { hasText: 'Add' }).click(); await A.waitForTimeout(1200);
await A.setInputFiles('#baby-photo', '/home/user/Witte-Baby-Tracker/assets/icon-512.png'); await A.waitForTimeout(1500);
const size = await A.evaluate(() => new Promise(res => { const r = indexedDB.open('witte-baby'); r.onsuccess = () => {
  const q = r.result.transaction('meta').objectStore('meta').get('profiles'); q.onsuccess = () => res(q.result.value[0].photo?.length || 0); }; }));
console.log('A photo stored:', size, 'bytes as data URL | header shows img:', await A.locator('#profile-avatar img').count(), '| list shows img:', await A.locator('.baby img').count());
await A.screenshot({ path: '/tmp/shots/100-photo.png', fullPage: true });
let t = Date.now(); while (Date.now() - t < 30000 && (await B.locator('#profile-avatar img').count()) === 0) await B.waitForTimeout(500);
console.log('B header got the photo in', ((Date.now() - t) / 1000).toFixed(1), 's');
await A.tap('[data-act="remove-photo"]'); await A.waitForTimeout(800);
console.log('after remove, A header img:', await A.locator('#profile-avatar img').count());
t = Date.now(); while (Date.now() - t < 30000 && (await B.locator('#profile-avatar img').count()) > 0) await B.waitForTimeout(500);
console.log('B cleared in', ((Date.now() - t) / 1000).toFixed(1), 's');
console.log(errors.length ? 'ERRORS ' + errors.join('|') : 'no page errors');
await browser.close();
