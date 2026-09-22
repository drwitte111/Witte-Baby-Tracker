// Log: reverse-chronological history, grouped by day, filterable, tap to edit.
import { db } from '../db.js';
import { T, TYPE_META, EDITABLE, feedSeconds, sleepSeconds, feedLabel, diaperLabel } from '../model.js';
import { dateLong, time, dur, dayKey, weightLabel, lengthLabel, volumeLabel } from '../format.js';
import { esc, icon } from '../ui.js';
import { addEntry, editEntry } from '../forms.js';

const PAGE = 120;
let filter = 'all';
let shown = PAGE;

function daySummary(events, filter) {
  const feeds = events.filter(e => e.type === T.FEED);
  const sleeps = events.filter(e => e.type === T.SLEEP && e.end);
  const diapers = events.filter(e => e.type === T.DIAPER);
  const parts = [];
  if (feeds.length && (filter === 'all' || filter === T.FEED)) parts.push(`${feeds.length} feed${feeds.length === 1 ? '' : 's'}`);
  if (sleeps.length && (filter === 'all' || filter === T.SLEEP)) parts.push(dur(sleeps.reduce((a, e) => a + sleepSeconds(e), 0)) + ' sleep');
  if (diapers.length && (filter === 'all' || filter === T.DIAPER)) parts.push(`${diapers.length} diaper${diapers.length === 1 ? '' : 's'}`);
  return parts.join(' · ') || `${events.length} entr${events.length === 1 ? 'y' : 'ies'}`;
}

export function summaryLine(ev, units) {
  switch (ev.type) {
    case T.FEED:   return feedLabel(ev, { compact: true });   // duration has its own slot
    case T.SLEEP:  return ev.end ? `${time(ev.start)} – ${time(ev.end)}` : 'in progress';
    case T.DIAPER: return `${diaperLabel(ev)}${ev.blowout ? ' · blowout' : ''}${ev.color ? ` · ${ev.color.toLowerCase()}` : ''}${ev.texture ? ` · ${ev.texture.toLowerCase()}` : ''}`;
    case T.GROWTH: return [
      ev.weightG != null ? weightLabel(ev.weightG, units.weight) : null,
      ev.heightCm != null ? lengthLabel(ev.heightCm, units.length) : null,
      ev.headCm != null ? `head ${lengthLabel(ev.headCm, units.length)}` : null,
    ].filter(Boolean).join(' · ');
    case T.BOTTLE: return `${ev.kind || 'Bottle'} · ${volumeLabel(ev.volumeMl, units.volume)}`;
    case T.PUMP:   return `${volumeLabel(ev.volumeMl, units.volume)}${ev.durationSec ? ` · ${dur(ev.durationSec)}` : ''}`;
    default:       return '';
  }
}

export async function render(root, ctx) {
  const all = await db.all();
  const events = filter === 'all' ? all : all.filter(e => e.type === filter);
  const page = events.slice(0, shown);

  const chips = [['all', 'All', null], ...Object.entries(TYPE_META).map(([k, m]) => [k, m.label, m])]
    .filter(([k]) => k === 'all' || all.some(e => e.type === k))
    .map(([k, label, m]) => `<button class="chip ${m ? m.tone : ''}" data-filter="${k}" aria-pressed="${filter === k}">
      ${m ? icon(m.icon) : ''}${esc(label)}</button>`)
    .join('');

  let html = `<div class="chips">${chips}</div>
    <div class="row" style="margin:0 0 6px">
      ${EDITABLE.map(t => `<button class="btn soft ${TYPE_META[t].tone}" data-add="${t}">${icon(TYPE_META[t].icon, 'sm')}${esc(TYPE_META[t].short)}</button>`).join('')}
    </div>`;

  if (!page.length) {
    html += `<div class="empty"><span class="chip-ico tone-neutral">${icon('i-log')}</span>
      Nothing logged yet.<br>Use the buttons above, or import your Nara export from More → Import.</div>`;
  } else {
    // group into days so each day can carry its own summary
    const days = [];
    for (const ev of page) {
      const k = dayKey(ev.start);
      if (!days.length || days[days.length - 1].key !== k) days.push({ key: k, start: ev.start, events: [] });
      days[days.length - 1].events.push(ev);
    }
    for (const day of days) {
      html += `<h2 class="day-head"><span>${esc(dateLong(day.start))}</span>
        <span class="muted">${esc(daySummary(day.events, filter))}</span></h2><div class="timeline">`;
      for (const ev of day.events) {
        const m = TYPE_META[ev.type] || { icon: 'i-log', tone: 'tone-neutral', label: ev.type };
        const secs = ev.type === T.FEED ? feedSeconds(ev) : ev.type === T.SLEEP && ev.end ? sleepSeconds(ev) : 0;
        html += `<button class="entry ${m.tone}" data-id="${esc(ev.id)}">
          <span class="chip-ico sm">${icon(m.icon)}</span>
          <span class="entry-main">
            <div class="entry-title"><b>${esc(m.label)}</b>
              ${secs ? `<span class="entry-dur">${dur(secs)}</span>` : ''}
              <span class="entry-time">${esc(time(ev.start))}</span></div>
            <div class="entry-sub">${esc(summaryLine(ev, ctx.state.units))}</div>
            ${ev.note ? `<div class="entry-note">${esc(ev.note)}</div>` : ''}
          </span>
        </button>`;
      }
      html += `</div>`;
    }
    if (events.length > shown) {
      html += `<div class="row"><button class="btn wide" data-more="1">Show ${Math.min(PAGE, events.length - shown)} more · ${events.length - shown} left</button></div>`;
    } else {
      html += `<p class="muted" style="text-align:center;padding:14px">${events.length} entr${events.length === 1 ? 'y' : 'ies'}</p>`;
    }
  }

  root.innerHTML = html;

  root.addEventListener('click', async e => {
    const chip = e.target.closest('[data-filter]');
    if (chip) { filter = chip.dataset.filter; shown = PAGE; return ctx.refresh(); }

    const more = e.target.closest('[data-more]');
    if (more) { shown += PAGE; return ctx.refresh(); }

    const add = e.target.closest('[data-add]');
    if (add) return void addEntry(add.dataset.add, ctx);

    const entry = e.target.closest('[data-id]');
    if (entry) {
      const ev = await db.get(entry.dataset.id);
      if (ev) await editEntry(ev, ctx);
    }
  });
}
