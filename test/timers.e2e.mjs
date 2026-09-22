import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
await fetch('http://127.0.0.1:8080/emulator/v1/projects/witte-baby-tracker/databases/(default)/documents', { method: 'DELETE' });
const browser = await chromium.launch();
const errors = [];
async function phone(label) {
  const c = await browser.newContext({ viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true });
  await c.addInitScript(() => { localStorage.setItem('firebaseSdkBase', '/sdktest'); localStorage.setItem('firebaseEmulator', '127.0.0.1:9099:8080'); localStorage.setItem('installHintDismissed', '1'); });
  const p = await c.newPage();
  p.on('pageerror', e => errors.push(`[${label}] ${e.message}`));
  p.on('console', m => { if (m.type() === 'error') errors.push(`[${label}] ${m.text().slice(0, 140)}`); });
  await p.goto('http://127.0.0.1:8099/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500);
  return p;
}
async function waitFor(p, fn, label, ms = 30000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return ((Date.now() - t) / 1000).toFixed(1) + 's'; await p.waitForTimeout(500); } return `TIMEOUT ${label}`; }

const A = await phone('A'), B = await phone('B');
// A gives the baby a name first (so status has one)
await A.tap('[data-route="settings"]'); await A.waitForTimeout(400);
await A.tap('[data-act="add-baby"]'); await A.waitForTimeout(300);
await A.fill('.sheet [name=nm]', 'Nadine'); await A.locator('.sheet .btn', { hasText: 'Add' }).click(); await A.waitForTimeout(1500);
await A.tap('[data-route="home"]'); await A.waitForTimeout(500);

// A starts a sleep → B's sleep card must switch to "Sleeping"
await A.tap('[data-act="sleep-start"]'); await A.waitForTimeout(300);
console.log('B sees A\'s sleep timer:', await waitFor(B, async () => (await B.locator('[data-act="sleep-wake"]').count()) > 0, 'B sleep'));
await B.tap('[data-route="home"]').catch(() => {});
await B.waitForTimeout(2500);
console.log('B elapsed reads:', await B.locator('[data-live="sleep-elapsed"]').innerText());

// B moves the start back 5 min → A should show it
await B.tap('[data-act="sleep-earlier"][data-min="5"]'); await B.waitForTimeout(300);
console.log('A sees the −5m from B:', await waitFor(A, async () => /5m/.test(await A.locator('[data-live="sleep-elapsed"]').innerText()), 'A -5m'));

// B ends the sleep → A's card must go back to "Start sleep" and the entry exists on both
await B.tap('[data-act="sleep-wake"]'); await B.waitForTimeout(300);
console.log('A timer cleared after B woke:', await waitFor(A, async () => (await A.locator('[data-act="sleep-start"]').count()) > 0, 'A cleared'));

console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 5).join('\n') : 'no page errors');
await browser.close();
