// Growth: measurement history, curves, and gain-rate readout.
import { db } from '../db.js';
import { T } from '../model.js';
import { weightLabel, lengthLabel, gramsTo, cmTo, toGrams, toCm, ageFrom, DAY } from '../format.js';
import { esc, icon } from '../ui.js';
import { lineChart, vizCard } from '../charts.js';
import { projectToday } from '../growth-fit.js';
import { addEntry, editEntry } from '../forms.js';

const dateShort = ms => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });

export async function render(root, ctx) {
  const rows = (await db.ofType(T.GROWTH)).slice().sort((a, b) => a.start - b.start);
  const u = ctx.state.units;

  if (!rows.length) {
    root.innerHTML = `<div class="empty"><span class="chip-ico tone-growth">${icon('i-ruler')}</span>No measurements yet.</div>
      <div class="row tone-growth"><button class="btn tone wide" data-add="1">${icon('i-plus', 'sm')}Add measurement</button></div>`;
    root.addEventListener('click', e => { if (e.target.closest('[data-add]')) addEntry(T.GROWTH, ctx); });
    return;
  }

  const latest = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  let gain = '';
  if (prev && latest.weightG != null && prev.weightG != null) {
    const days = (latest.start - prev.start) / (DAY * 1000);
    const perWeek = ((latest.weightG - prev.weightG) / days) * 7;
    const val = u.weight === 'kg' ? `${(perWeek / 1000).toFixed(3)} kg` : `${(gramsTo(perWeek, 'lb')).toFixed(2)} lb`;
    gain = `${perWeek >= 0 ? '+' : ''}${val}/week since ${dateShort(prev.start)}`;
  }

  const series = [
    { key: 'weightG', title: 'Weight', color: 'var(--series-1)', fmt: v => u.weight === 'kg' ? `${v.toFixed(1)}kg` : `${v.toFixed(1)}lb`,
      conv: v => gramsTo(v, u.weight), label: v => weightLabel(v, u.weight), labelConv: v => weightLabel(toGrams(v, u.weight), u.weight) },
    { key: 'heightCm', title: 'Length', color: 'var(--series-2)', fmt: v => `${v.toFixed(0)}${u.length}`,
      conv: v => cmTo(v, u.length), label: v => lengthLabel(v, u.length), labelConv: v => lengthLabel(toCm(v, u.length), u.length) },
    { key: 'headCm', title: 'Head circumference', color: 'var(--series-3)', fmt: v => `${v.toFixed(0)}${u.length}`,
      conv: v => cmTo(v, u.length), label: v => lengthLabel(v, u.length), labelConv: v => lengthLabel(toCm(v, u.length), u.length) },
  ];

  let html = `<section class="card tone-growth">
    <div class="card-head"><span class="chip-ico">${icon('i-ruler')}</span>
      <span class="card-title">Latest · ${esc(dateShort(latest.start))}</span>
      <span class="meta">${esc(ageFrom(ctx.state.profile?.birth, latest.start))}</span></div>
    <div class="grid2">
      <div class="stat"><b>${esc(weightLabel(latest.weightG, u.weight))}</b><span>weight</span></div>
      <div class="stat"><b>${esc(lengthLabel(latest.heightCm, u.length))}</b><span>length</span></div>
      <div class="stat"><b>${esc(lengthLabel(latest.headCm, u.length))}</b><span>head</span></div>
      <div class="stat"><b>${rows.length}</b><span>measurements</span></div>
    </div>
    ${gain ? `<p class="sub">${esc(gain)}</p>` : ''}
    __ESTIMATES__
    <div class="row"><button class="btn tone wide" data-add="1">${icon('i-plus', 'sm')}Add measurement</button></div>
  </section>`;

  const birth = ctx.state.profile?.birth ?? null;
  const estimates = [], est = {};
  for (const s of series) {
    const points = rows.filter(r => r[s.key] != null).map(r => ({
      x: r.start, y: s.conv(r[s.key]),
      tip: `${dateShort(r.start)} · ${s.label(r[s.key])}`,
    }));
    if (points.length < 1) continue;
    // Dashed tail from the last measurement to today, along her own curve.
    const proj = projectToday(points, birth);
    const projection = proj ? { ...proj, tip: `Today · about ${s.labelConv(proj.y)} if she keeps her curve` } : null;
    if (projection) { estimates.push(`${s.title.toLowerCase()} ~${s.labelConv(projection.y)}`); est[s.key] = s.labelConv(projection.y); }
    html += vizCard({
      title: s.title,
      sub: points.length === 1 ? 'one measurement so far'
        : `${points.length} measurements · ${dateShort(points[0].x)} → ${dateShort(points[points.length - 1].x)}${projection ? ' · dotted: estimate to today' : ''}`,
      build: w => lineChart({ points, width: w, color: s.color, fmt: s.fmt, xFmt: dateShort, projection }),
    });
  }

  html = html.replace('__ESTIMATES__', estimates.length
    ? `<p class="sub">Today, if she keeps her curve: ${esc(estimates.join(' · '))}</p>` : '');

  html += `<section class="viz"><h3>All measurements</h3>
    <table class="tbl"><thead><tr><th>Date</th><th>Weight</th><th>Length</th><th>Head</th></tr></thead><tbody>
    ${Object.keys(est).length ? `<tr class="est"><td>Today <span class="muted">est.</span></td>
      <td>${esc(est.weightG || '—')}</td><td>${esc(est.heightCm || '—')}</td><td>${esc(est.headCm || '—')}</td></tr>` : ''}
    ${rows.slice().reverse().map(r => `<tr data-id="${esc(r.id)}" style="cursor:pointer">
      <td>${esc(dateShort(r.start))}</td>
      <td>${esc(r.weightG != null ? weightLabel(r.weightG, u.weight) : '—')}</td>
      <td>${esc(r.heightCm != null ? lengthLabel(r.heightCm, u.length) : '—')}</td>
      <td>${esc(r.headCm != null ? lengthLabel(r.headCm, u.length) : '—')}</td>
    </tr>`).join('')}
    </tbody></table>
    <p class="viz-sub" style="margin-top:10px">Tap a row to edit. The dotted tail on each chart extends her own curve (a √age fit to these points) to today — an estimate, not a percentile.</p>
  </section>`;

  root.innerHTML = html;

  root.addEventListener('click', async e => {
    if (e.target.closest('[data-add]')) return void addEntry(T.GROWTH, ctx);
    const tr = e.target.closest('tr[data-id]');
    if (tr) {
      const ev = await db.get(tr.dataset.id);
      if (ev) await editEntry(ev, ctx);
    }
  });
}
