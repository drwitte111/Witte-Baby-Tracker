import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true });
await c.addInitScript(() => localStorage.setItem('installHintDismissed', '1'));
const p = await c.newPage(); const cdp = await c.newCDPSession(p);
await p.goto('http://127.0.0.1:8099/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
const tab = () => p.evaluate(() => document.querySelector('.tab[aria-selected="true"]').dataset.route);
async function swipe(fromX, toX, y = 500, dy = 0, steps = 6) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y }] });
  for (let i = 1; i <= steps; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: fromX + (toX - fromX) * i / steps, y: y + dy * i / steps }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(450);
}
const out = [];
out.push('start ' + await tab());
await swipe(300, 80);  out.push('← ' + await tab());
await swipe(300, 80);  out.push('← ' + await tab());
await swipe(80, 300);  out.push('→ ' + await tab());
await swipe(300, 230); out.push('short ← (ignored?) ' + await tab());
await swipe(300, 120, 300, 260); out.push('diagonal (ignored?) ' + await tab());
await swipe(80, 300); await swipe(80, 300); await swipe(80, 300); out.push('→→→ past first ' + await tab());
console.log(out.join(' | '));
console.log('history length:', await p.evaluate(() => history.length));
// swipe starting on the filter chips must scroll them, not switch tabs
await p.tap('[data-route="log"]'); await p.waitForTimeout(500);
const chipY = await p.evaluate(() => document.querySelector('.chips').getBoundingClientRect().y + 15);
await swipe(300, 80, chipY); console.log('swipe on chips row stays on:', await tab());
await b.close();
