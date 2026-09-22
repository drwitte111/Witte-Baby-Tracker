// More: profile, units, caregiver, Nara import/export, data management.
import { db } from '../db.js';
import { fromNaraCsv, toNaraCsv } from '../csv.js';
import { T } from '../model.js';
import { esc, icon, toast, confirm, shareOrDownload } from '../ui.js';
import { toDateInput, ageFrom } from '../format.js';
import { syncCard, wireSync } from './sync-ui.js';
import { sync, pushNow } from '../sync.js';

export async function render(root, ctx) {
  const count = await db.count();
  const lastImport = await db.metaGet('lastImport', null);
  const p = ctx.state.profile || {};
  const u = ctx.state.units;

  root.innerHTML = `
  <section class="card tone-growth">
    <div class="card-head"><span class="chip-ico">${icon('i-ruler')}</span><span class="card-title">Baby</span>
      <span class="meta">${esc(ageFrom(p.birth))}</span></div>
    <label class="field"><span>Name</span><input name="name" value="${esc(p.name || '')}" placeholder="Baby"></label>
    <label class="field"><span>Birth date</span><input type="date" name="birth" value="${p.birth ? toDateInput(p.birth) : ''}"></label>
    <label class="field"><span>Your name <span class="muted">(saved on entries you add)</span></span>
      <input name="caregiver" value="${esc(ctx.state.caregiver || '')}" placeholder="e.g. Alaina"></label>
    <div class="row"><button class="btn tone wide" data-act="save-profile">${icon('i-check', 'sm')}Save</button></div>
  </section>

  <section class="card tone-neutral">
    <div class="card-head"><span class="chip-ico">${icon('i-more')}</span><span class="card-title">Units</span></div>
    <div class="field-row">
      <label class="field"><span>Weight</span><select name="uw">
        <option value="lb"${u.weight === 'lb' ? ' selected' : ''}>lb / oz</option>
        <option value="kg"${u.weight === 'kg' ? ' selected' : ''}>kg</option>
      </select></label>
      <label class="field"><span>Length</span><select name="ul">
        <option value="in"${u.length === 'in' ? ' selected' : ''}>inches</option>
        <option value="cm"${u.length === 'cm' ? ' selected' : ''}>cm</option>
      </select></label>
      <label class="field"><span>Volume</span><select name="uv">
        <option value="oz"${u.volume === 'oz' ? ' selected' : ''}>fl oz</option>
        <option value="ml"${u.volume === 'ml' ? ' selected' : ''}>ml</option>
      </select></label>
    </div>
  </section>

  <section class="card tone-accent">
    <div class="card-head"><span class="chip-ico">${icon('i-share')}</span><span class="card-title">Data</span>
      <span class="meta">${count} entries</span></div>
    <p class="sub">Import your Nara Baby export to bring history across; export writes the same format back. Without sync turned on, data stays on this device only.</p>
    <div class="row">
      <label class="btn">${icon('i-plus', 'sm')}Import CSV
        <input type="file" accept=".csv,text/csv" id="import-file" style="display:none">
      </label>
      <button class="btn" data-act="export">${icon('i-share', 'sm')}Export</button>
    </div>
    <div id="import-status">${lastImport ? `<p class="banner">${esc(lastImport.summary)}</p>` : ''}</div>
    <div class="row"><button class="btn danger wide" data-act="wipe">Delete all data</button></div>
  </section>

  ${syncCard()}

  <section class="card tone-neutral">
    <div class="card-head"><span class="chip-ico">${icon('i-home')}</span><span class="card-title">App</span></div>
    <p class="sub">Add to your home screen for a full-screen, offline-capable app: in Safari tap Share → Add to Home Screen; in Chrome use the install prompt in the address bar.</p>
    <p class="sub" style="margin-top:8px" id="storage-line"></p>
  </section>`;

  wireSync(root, ctx);

  /* persistent storage: ask the browser not to evict the database */
  navigator.storage?.persisted?.().then(async persisted => {
    const line = document.getElementById('storage-line');
    if (!line) return;
    if (!persisted && navigator.storage.persist) persisted = await navigator.storage.persist();
    const est = await navigator.storage.estimate?.();
    const mb = est?.usage ? (est.usage / 1048576).toFixed(1) : '?';
    line.textContent = persisted
      ? `Storage is persistent · ${mb} MB used.`
      : `Storage is best-effort — the browser may clear it if space runs low. Export regularly (${mb} MB used).`;
  });

  root.querySelector('#import-file').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const status = document.getElementById('import-status');
    status.innerHTML = `<p class="sub">Reading ${esc(file.name)}…</p>`;
    try {
      const text = await file.text();
      const { events, profile, skipped } = fromNaraCsv(text);
      if (!events.length) { status.innerHTML = `<p class="banner">No activities found in that file.</p>`; return; }

      const existing = await db.count();
      const ok = await confirm(
        `Import ${events.length} entries${skipped ? ` (${skipped} rows skipped)` : ''}?` +
        (existing ? ' Entries with the same id are replaced; the rest are kept.' : ''),
        { danger: false, okLabel: 'Import' });
      if (!ok) { status.innerHTML = ''; return; }

      status.innerHTML = `<p class="sub">Importing…</p><progress max="${events.length}" value="0"></progress>`;
      const bar = status.querySelector('progress');
      await db.putMany(events, done => { bar.value = done; });

      if (profile) {
        const merged = { ...ctx.state.profile, ...profile };
        await ctx.setProfile(merged);
      }
      const byType = events.reduce((a, ev) => (a[ev.type] = (a[ev.type] || 0) + 1, a), {});
      const summary = `Imported ${events.length} entries from ${file.name} · ${
        Object.entries(byType).map(([k, v]) => `${v} ${k}`).join(', ')}`;
      await db.metaSet('lastImport', { at: Date.now(), summary });
      toast('Import complete');
      ctx.refresh();                                   // repaints with the summary banner
    } catch (err) {
      console.error(err);
      status.innerHTML = `<p class="banner">Import failed: ${esc(err.message)}</p>`;
    } finally {
      e.target.value = '';
    }
  });

  root.addEventListener('change', async e => {
    const n = e.target.name;
    if (n === 'uw' || n === 'ul' || n === 'uv') {
      const units = {
        weight: root.querySelector('[name=uw]').value,
        length: root.querySelector('[name=ul]').value,
        volume: root.querySelector('[name=uv]').value,
      };
      await ctx.setUnits(units);
      toast('Units updated');
    }
  });

  root.addEventListener('click', async e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;

    if (act === 'save-profile') {
      const birthStr = root.querySelector('[name=birth]').value;
      await ctx.setProfile({
        ...ctx.state.profile,
        name: root.querySelector('[name=name]').value.trim(),
        birth: birthStr ? new Date(`${birthStr}T00:00:00`).getTime() : null,
      });
      await ctx.setCaregiver(root.querySelector('[name=caregiver]').value.trim());
      toast('Saved');
      ctx.refresh();
    }

    if (act === 'export') {
      const all = await db.all();
      if (!all.length) return toast('Nothing to export');
      const csv = toNaraCsv(all, ctx.state.profile, ctx.state.units);
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const who = (ctx.state.profile?.name || 'baby').toLowerCase().replace(/\W+/g, '');
      const how = await shareOrDownload(`export_wittebaby_${who}_${stamp}.csv`, csv);
      if (how !== 'cancelled') toast(`Exported ${all.length} entries`);
    }

    if (act === 'wipe') {
      const live = sync.state === 'live';
      const n = await db.count();
      if (!await confirm(live
        ? `Delete all ${n} entries for everyone in ${sync.family?.name || 'the family'}?`
        : `Delete all ${n} entries from this device?`)) return;
      if (!await confirm('This cannot be undone. Export first if you want a copy.')) return;
      // While synced, a local wipe would just come back — delete for real instead.
      if (live) { await db.tombstoneAll(); await pushNow(); }
      else await db.clearEvents();
      await ctx.setActiveFeed(null);
      await ctx.setActiveSleep(null);
      toast('All data deleted');
      ctx.refresh();
    }
  });
}
