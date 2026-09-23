import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true });
await c.addInitScript(() => { localStorage.setItem('installHintDismissed', '1'); Object.defineProperty(navigator, 'standalone', { value: true }); });
const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
let status = 403;
await p.route('https://api.github.com/**', route => route.fulfill({ status, body: '' }));
await p.goto('http://127.0.0.1:8099/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(800);
await p.tap('[data-route="settings"]'); await p.waitForTimeout(500);
await p.tap('[data-act="add-baby"]'); await p.waitForTimeout(300);
await p.fill('.sheet [name=nm]', 'Nadine'); await p.locator('.sheet .btn', { hasText: 'Add' }).click(); await p.waitForTimeout(800);
const toast = () => p.locator('#toast').innerText();
// no token: starting a sleep must say so
await p.tap('[data-route="home"]'); await p.waitForTimeout(400);
await p.tap('[data-act="sleep-start"]'); await p.waitForTimeout(600);
console.log('no token →', await toast());
await p.tap('[data-act="sleep-discard"]'); await p.waitForTimeout(300); await p.locator('.sheet .btn', { hasText: 'Discard' }).click(); await p.waitForTimeout(300);
// bad token: GitHub 403 must be explained
await p.tap('[data-route="settings"]'); await p.waitForTimeout(500);
await p.fill('[name=ghtoken]', 'github_pat_BAD'); await p.tap('[data-act="save-token"]'); await p.waitForTimeout(400);
console.log('card says:', (await p.locator('.card:has(.card-title:text("Notifications")) .sub').nth(1).innerText()).replace(/\n/g, ' '));
await p.tap('[data-act="test-push"]'); await p.waitForTimeout(600);
console.log('403 →', await toast());
status = 204;
await p.tap('[data-act="test-push"]'); await p.waitForTimeout(600);
console.log('204 →', await toast());
console.log(errs.length ? 'ERRORS ' + errs.join('|') : 'no page errors');
await b.close();
