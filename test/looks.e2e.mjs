import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const CSV = '/root/.claude/uploads/cf815e03-f7e5-5f24-a6b7-f1485f8a4a45/65328401-export_narababy_nadine_20260922.csv';
const b = await chromium.launch();
for (const scheme of ['light', 'dark']) {
  const c = await b.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme });
  await c.addInitScript(() => localStorage.setItem('installHintDismissed', '1'));
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:8099/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.tap('[data-route="settings"]'); await p.waitForTimeout(300);
  await p.setInputFiles('#import-file', CSV); await p.waitForTimeout(600);
  await p.locator('.sheet .btn', { hasText: 'Import' }).click(); await p.waitForTimeout(4000);
  for (const look of ['girl', 'boy', 'default']) {
    await p.tap('[data-route="settings"]'); await p.waitForTimeout(400);
    await p.tap(`[data-act="set-look"][data-look="${look}"]`); await p.waitForTimeout(300);
    if (look === 'girl' && scheme === 'light') await p.screenshot({ path: `/tmp/shots/97-look-picker.png` });
    await p.tap('[data-route="home"]'); await p.waitForTimeout(700);
    await p.screenshot({ path: `/tmp/shots/98-${look}-${scheme}.png` });
    await p.tap('[data-route="stats"]'); await p.waitForTimeout(1200);
    await p.screenshot({ path: `/tmp/shots/99-${look}-${scheme}-stats.png` });
  }
  console.log(scheme, 'persisted look after reload:', await (async () => { await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForTimeout(600); return p.evaluate(() => document.documentElement.dataset.look || 'default'); })());
  console.log(scheme, errs.length ? 'ERRORS ' + errs.join('|') : 'no page errors');
  await c.close();
}
await b.close();
