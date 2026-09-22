// Growth: measurement history, curves, and gain-rate readout.
import { db } from '../db.js';
import { T } from '../model.js';
import { weightLabel, lengthLabel, gramsTo, cmTo, ageFrom, DAY } from '../format.js';
import { esc } from '../ui.js';
import { lineChart, vizCard } from '../charts.js';
import { addEntry, editEntry } from '../forms.js';

const dateShort = ms => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });

export async function render(root, ctx) {
  const rows = (await db.ofType(T.GROWTH)).slice().sort((a, b) => a.start - b.start);
  const u = ctx.state.units;

  if (!rows.length) {
    root.innerHTML = `<p class="empty">No measurements yet.</p>
      <div class="row"><button class="btn primary wide" data-add="1">+ Add measurement</button></div>`;
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
    { key: 'weightG', title: 'Weight', color: 'var(--series-1)', fmt: v => u.weight === 'kg' ? `${v.toFixed(1)}kg` : `${v.toFixed(1)}lb`, conv: v => gramsTo(v, u.weight), label: v => weightLabel(v, u.weight) },
    { key: 'heightCm', title: 'Length', color: 'var(--series-2)', fmt: v => `${v.toFixed(0)}${u.length}`, conv: v => cmTo(v, u.length), label: v => lengthLabel(v, u.length) },
    { key: 'headCm', title: 'Head circumference', color: 'var(--series-3)', fmt: v => `${v.toFixed(0)}${u.length}`, conv: v => cmTo(v, u.length), label: v => lengthLabel(v, u.length) },
  ];

  let html = `<section class="card">
    <div class="card-head"><span class="card-title">Latest · ${esc(dateShort(latest.start))}</span>
      <span class="muted">${esc(ageFrom(ctx.state.profile?.birth, latest.start))}</span></div>
    <div class="grid2">
      <div class="stat"><b>${esc(weightLabel(latest.weightG, u.weight))}</b><span>weight</span></div>
      <div class="stat"><b>${esc(lengthLabel(latest.heightCm, u.length))}</b><span>length</span></div>
      <div class="stat"><b>${esc(lengthLabel(latest.headCm, u.length))}</b><span>head</span></div>
      <div class="stat"><b>${rows.length}</b><span>measurements</span></div>
    </div>
    ${gain ? `<p class="sub">${esc(gain)}</p>` : ''}
    <div class="row"><button class="btn primary wide" data-add="1">+ Add measurement</button></div>
  </section>`;

  for (const s of series) {
    const points = rows.filter(r => r[s.key] != null).map(r => ({
      x: r.start, y: s.conv(r[s.key]),
      tip: `${dateShort(r.start)} · ${s.label(r[s.key])}`,
    }));
    if (points.length < 1) continue;
    html += vizCard({
      title: s.title,
      sub: points.length === 1 ? 'one measurement so far' : `${points.length} measurements · ${dateShort(points[0].x)} → ${dateShort(points[points.length - 1].x)}`,
      build: w => lineChart({ points, width: w, color: s.color, fmt: s.fmt, xFmt: dateShort }),
    });
  }

  html += `<section class="viz"><h3>All measurements</h3>
    <table class="tbl"><thead><tr><th>Date</th><th>Weight</th><th>Length</th><th>Head</th></tr></thead><tbody>
    ${rows.slice().reverse().map(r => `<tr data-id="${esc(r.id)}" style="cursor:pointer">
      <td>${esc(dateShort(r.start))}</td>
      <td>${esc(r.weightG != null ? weightLabel(r.weightG, u.weight) : '—')}</td>
      <td>${esc(r.heightCm != null ? lengthLabel(r.heightCm, u.length) : '—')}</td>
      <td>${esc(r.headCm != null ? lengthLabel(r.headCm, u.length) : '—')}</td>
    </tr>`).join('')}
    </tbody></table>
    <p class="viz-sub" style="margin-top:10px">Tap a row to edit. Percentile curves aren't included — these are raw measurements.</p>
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
