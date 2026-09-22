import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import fs from 'fs';
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true });
await c.addInitScript(() => localStorage.setItem('installHintDismissed', '1'));
const p = await c.newPage();
let reloads = 0; p.on('load', () => reloads++);
await p.goto('http://127.0.0.1:8099/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1200);
const base = reloads;
// same version, foreground again → no reload
await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await p.waitForTimeout(800);
console.log('same version → reloads:', reloads - base, '(expect 0)');
// new deploy lands: version.json changes → next foreground reloads
fs.writeFileSync('/home/user/Witte-Baby-Tracker/version.json', '{"version":"bbbbbbb","built":"y"}');
await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await p.waitForTimeout(1500);
console.log('new version → reloads:', reloads - base, '(expect 1)');
// with a sheet open, the reload waits until it closes
fs.writeFileSync('/home/user/Witte-Baby-Tracker/version.json', '{"version":"ccccccc","built":"z"}');
await p.waitForTimeout(800);
await p.tap('[data-act="feed-manual"]'); await p.waitForTimeout(400);
const before = reloads;
await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await p.waitForTimeout(1200);
console.log('sheet open → reloads:', reloads - before, '(expect 0)');
await p.locator('.sheet .btn', { hasText: 'Cancel' }).click(); await p.waitForTimeout(1500);
console.log('sheet closed → reloads:', reloads - before, '(expect 1)');
await b.close();
fs.writeFileSync('/home/user/Witte-Baby-Tracker/version.json', '{"version":"dev","built":""}\n');
