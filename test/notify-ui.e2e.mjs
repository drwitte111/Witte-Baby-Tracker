import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await c.addInitScript(() => { localStorage.setItem('installHintDismissed', '1'); Object.defineProperty(navigator, 'standalone', { value: true }); });
const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
// intercept the GitHub dispatch so we can inspect what the phone sends
let dispatched = null;
await p.route('https://api.github.com/**', route => { dispatched = { url: route.request().url(), headers: route.request().headers(), body: route.request().postDataJSON() }; route.fulfill({ status: 204, body: '' }); });
await p.goto('http://127.0.0.1:8099/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(800);
await p.tap('[data-route="settings"]'); await p.waitForTimeout(500);
await p.tap('[data-act="add-baby"]'); await p.waitForTimeout(300);
await p.fill('.sheet [name=nm]', 'Nadine'); await p.locator('.sheet .btn', { hasText: 'Add' }).click(); await p.waitForTimeout(800);
await p.fill('[name=caregiver]', 'David'); await p.tap('[data-act="save-profile"]'); await p.waitForTimeout(500);
console.log('card text:', (await p.locator('.card:has(.card-title:text("Notifications"))').innerText()).replace(/\n+/g, ' | ').slice(0, 160));
await p.fill('[name=ghtoken]', 'github_pat_TEST123'); await p.tap('[data-act="save-token"]'); await p.waitForTimeout(500);
await p.tap('[data-act="test-push"]'); await p.waitForTimeout(800);
console.log('test dispatch →', dispatched?.url, '| auth ok:', dispatched?.headers.authorization === 'Bearer github_pat_TEST123', '| payload:', JSON.stringify(dispatched?.body?.client_payload));
// a real sleep start / end from Home must dispatch too, with the baby and caregiver
dispatched = null;
await p.tap('[data-route="home"]'); await p.waitForTimeout(500);
await p.tap('[data-act="sleep-start"]'); await p.waitForTimeout(700);
console.log('sleep-start →', dispatched?.body?.event_type, JSON.stringify(dispatched?.body?.client_payload));
dispatched = null;
await p.tap('[data-act="sleep-wake"]'); await p.waitForTimeout(700);
console.log('sleep-end →', JSON.stringify(dispatched?.body?.client_payload));
// token must never leave the phone: not in the synced meta keys
const synced = await p.evaluate(() => new Promise(res => { const r = indexedDB.open('witte-baby'); r.onsuccess = () => {
  const q = r.result.transaction('meta').objectStore('meta').getAll(); q.onsuccess = () => res(q.result.filter(x => /dirty/.test(x.key)).map(x => x.key)); }; }));
console.log('meta keys flagged for sync:', synced.join(', '), '| token flagged:', synced.some(k => k.startsWith('ghToken')));
await p.tap('[data-route="settings"]'); await p.waitForTimeout(500);
await p.locator('.card:has(.card-title:text("Notifications"))').screenshot({ path: '/tmp/shots/110-notify-card.png' });
console.log(errs.length ? 'ERRORS ' + errs.join('|') : 'no page errors');
await b.close();
