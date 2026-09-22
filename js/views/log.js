// Log: reverse-chronological history, grouped by day, filterable, tap to edit.
import { db } from '../db.js';
import { T, TYPE_META, EDITABLE, feedSeconds, sleepSeconds, feedLabel, diaperLabel } from '../model.js';
import { dateLong, time, dur, dayKey, weightLabel, lengthLabel, volumeLabel } from '../format.js';
import { esc } from '../ui.js';
import { addEntry, editEntry } from '../forms.js';

const PAGE = 120;
let filter = 'all';
let shown = PAGE;

export function summaryLine(ev, units) {
  switch (ev.type) {
    case T.FEED:   return feedLabel(ev);
    case T.SLEEP:  return ev.end ? `${dur(sleepSeconds(ev))} · woke ${time(ev.end)}` : 'in progress';
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

  const chips = [['all', 'All'], ...Object.entries(TYPE_META).map(([k, m]) => [k, m.label])]
    .filter(([k]) => k === 'all' || all.some(e => e.type === k))
    .map(([k, label]) => `<button class="chip" data-filter="${k}" aria-pressed="${filter === k}">${esc(label)}</button>`)
    .join('');

  let html = `<div class="chips">${chips}</div>
    <div class="row" style="margin:0 0 12px">
      ${EDITABLE.map(t => `<button class="btn" data-add="${t}">+ ${esc(TYPE_META[t].short)}</button>`).join('')}
    </div>`;

  if (!page.length) {
    html += `<p class="empty">Nothing logged yet.<br>Use the buttons above, or import your Nara export from More → Import.</p>`;
  } else {
    let currentDay = null;
    for (const ev of page) {
      const k = dayKey(ev.start);
      if (k !== currentDay) {
        currentDay = k;
        html += `<h2 class="day-head">${esc(dateLong(ev.start))}</h2>`;
      }
      const m = TYPE_META[ev.type] || { icon: '•', label: ev.type };
      html += `<button class="entry" data-id="${esc(ev.id)}">
        <span class="entry-ico" aria-hidden="true">${m.icon}</span>
        <span class="entry-main">
          <b>${esc(m.label)}</b> <span class="entry-time">${esc(time(ev.start))}</span>
          <div class="muted">${esc(summaryLine(ev, ctx.state.units))}</div>
          ${ev.note ? `<div class="entry-note">${esc(ev.note)}</div>` : ''}
        </span>
      </button>`;
    }
    if (events.length > shown) {
      html += `<div class="row"><button class="btn wide" data-more="1">Show ${Math.min(PAGE, events.length - shown)} more (${events.length - shown} left)</button></div>`;
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
