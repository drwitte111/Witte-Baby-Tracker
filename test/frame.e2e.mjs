import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await c.addInitScript(() => localStorage.setItem('installHintDismissed', '1'));
const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://127.0.0.1:8099/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(800);
await p.tap('[data-route="settings"]'); await p.waitForTimeout(400);
await p.tap('[data-act="add-baby"]'); await p.waitForTimeout(300);
await p.fill('.sheet [name=nm]', 'Nadine'); await p.locator('.sheet .btn', { hasText: 'Add' }).click(); await p.waitForTimeout(800);
// pick a non-square image so framing matters (the light splash is 1206x2622)
await p.setInputFiles('#baby-photo', '/home/user/Witte-Baby-Tracker/assets/splash-1206x2622-light.png'); await p.waitForTimeout(1500);
console.log('framing sheet opened:', await p.locator('#frame-circle').count(), '| zoom slider:', await p.locator('#frame-zoom').inputValue());
const before = await p.locator('#frame-img').getAttribute('style');
// drag the photo 40px right, 20px down
const box = await p.locator('#frame-circle').boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx + 20, cy + 10); await p.mouse.move(cx + 40, cy + 20); await p.mouse.up();
await p.waitForTimeout(200);
const afterDrag = await p.locator('#frame-img').getAttribute('style');
console.log('drag changed placement:', before !== afterDrag, '|', afterDrag.match(/left:[^;]+;top:[^;]+/)?.[0]);
// zoom in via the slider
await p.locator('#frame-zoom').fill('2'); await p.locator('#frame-zoom').dispatchEvent('input'); await p.waitForTimeout(200);
const afterZoom = await p.locator('#frame-img').getAttribute('style');
console.log('zoom 2 →', afterZoom.match(/width:[^;]+;height:[^;]+/)?.[0]);
await p.screenshot({ path: '/tmp/shots/120-framing.png' });
await p.locator('.sheet .btn', { hasText: 'Save' }).click(); await p.waitForTimeout(1000);
const saved = await p.evaluate(() => new Promise(res => { const r = indexedDB.open('witte-baby'); r.onsuccess = () => {
  const q = r.result.transaction('meta').objectStore('meta').get('profiles'); q.onsuccess = () => res({ frame: q.result.value[0].frame, bytes: q.result.value[0].photo.length }); }; }));
console.log('saved frame:', JSON.stringify(saved.frame), '| photo bytes:', saved.bytes);
const headerStyle = await p.locator('#profile-avatar img').getAttribute('style');
const listStyle = await p.locator('.baby img').first().getAttribute('style');
console.log('header and list use the same framing:', headerStyle === listStyle, '|', headerStyle.slice(0, 70));
// Adjust reopens with the saved framing; Fit and Reset work
await p.tap('[data-act="frame-photo"]'); await p.waitForTimeout(500);
console.log('adjust reopens at zoom:', await p.locator('#frame-zoom').inputValue());
await p.tap('[data-frame="fit"]'); await p.waitForTimeout(200);
console.log('fit →', (await p.locator('#frame-img').getAttribute('style')).match(/width:[^;]+;height:[^;]+/)?.[0], '(longer side = 100%)');
await p.tap('[data-frame="reset"]'); await p.waitForTimeout(200);
console.log('reset → zoom', await p.locator('#frame-zoom').inputValue());
await p.locator('.sheet .btn', { hasText: 'Cancel' }).click(); await p.waitForTimeout(300);
console.log(errs.length ? 'ERRORS ' + errs.join('|') : 'no page errors');
await b.close();
