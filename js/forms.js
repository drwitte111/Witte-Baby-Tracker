// Add / edit sheets for the four tracked activities.
import { sheet, confirm, esc, toast } from './ui.js';
import { db } from './db.js';
import { T, makeEvent, DIAPER_COLORS, DIAPER_TEXTURES, TYPE_META } from './model.js';
import { toLocalInput, fromLocalInput, gramsTo, toGrams, cmTo, toCm } from './format.js';

const opt = (v, cur, label) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label ?? v)}</option>`;

function timeField(name, ms, label = 'Time') {
  return `<label class="field"><span>${label}</span>
    <input type="datetime-local" name="${name}" value="${toLocalInput(ms)}" step="60"></label>`;
}
function noteField(note) {
  return `<label class="field"><span>Note</span><textarea name="note" placeholder="optional">${esc(note || '')}</textarea></label>`;
}

function bodyFor(type, ev, units) {
  switch (type) {
    case T.FEED: {
      const l = Math.round((ev.leftSec || 0) / 60), r = Math.round((ev.rightSec || 0) / 60);
      return `${timeField('start', ev.start, 'Started')}
        <div class="field-row">
          <label class="field"><span>Left (min)</span><input type="number" name="left" min="0" step="1" inputmode="decimal" value="${l || ''}"></label>
          <label class="field"><span>Right (min)</span><input type="number" name="right" min="0" step="1" inputmode="decimal" value="${r || ''}"></label>
        </div>
        <label class="field"><span>Started on</span><select name="beginSide">
          ${opt('LEFT', ev.beginSide || 'LEFT', 'Left')}${opt('RIGHT', ev.beginSide || 'LEFT', 'Right')}
        </select></label>
        ${noteField(ev.note)}`;
    }
    case T.SLEEP:
      return `${timeField('start', ev.start, 'Fell asleep')}
        <label class="field"><span>Woke up <span class="muted">(leave blank if still asleep)</span></span>
          <input type="datetime-local" name="end" step="60" value="${ev.end ? toLocalInput(ev.end) : ''}"></label>
        ${noteField(ev.note)}`;
    case T.DIAPER: {
      const kind = ev.wet && ev.dirty ? 'both' : ev.dirty ? 'dirty' : ev.wet ? 'wet' : 'dry';
      return `<label class="field"><span>Contents</span><select name="kind">
          ${opt('wet', kind, 'Wet')}${opt('dirty', kind, 'Dirty')}${opt('both', kind, 'Wet + dirty')}${opt('dry', kind, 'Dry')}
        </select></label>
        <div class="field-row">
          <label class="field"><span>Color</span><select name="color">
            ${opt('', ev.color || '', '—')}${DIAPER_COLORS.map(c => opt(c, ev.color || '', c.toLowerCase())).join('')}
          </select></label>
          <label class="field"><span>Texture</span><select name="texture">
            ${opt('', ev.texture || '', '—')}${DIAPER_TEXTURES.map(c => opt(c, ev.texture || '', c.toLowerCase())).join('')}
          </select></label>
        </div>
        <label class="field"><span><input type="checkbox" name="blowout" style="width:auto;min-height:0;margin-right:8px"${ev.blowout ? ' checked' : ''}>Blowout</span></label>
        ${timeField('start', ev.start)}
        ${noteField(ev.note)}`;
    }
    case T.GROWTH: {
      const w = ev.weightG != null ? +gramsTo(ev.weightG, units.weight).toFixed(3) : '';
      const ht = ev.heightCm != null ? +cmTo(ev.heightCm, units.length).toFixed(2) : '';
      const hd = ev.headCm != null ? +cmTo(ev.headCm, units.length).toFixed(2) : '';
      return `${timeField('start', ev.start, 'Measured')}
        <label class="field"><span>Weight (${units.weight})</span><input type="number" name="weight" step="0.001" inputmode="decimal" value="${w}"></label>
        <label class="field"><span>Length (${units.length})</span><input type="number" name="height" step="0.01" inputmode="decimal" value="${ht}"></label>
        <label class="field"><span>Head (${units.length})</span><input type="number" name="head" step="0.01" inputmode="decimal" value="${hd}"></label>
        ${noteField(ev.note)}`;
    }
    default:
      return `<p class="muted">${esc(TYPE_META[type]?.label || type)} entries are imported from Nara and shown read-only.</p>
        ${timeField('start', ev.start)}${noteField(ev.note)}`;
  }
}

function collect(type, root, ev, units) {
  const f = name => root.querySelector(`[name="${name}"]`);
  const numOrNull = name => {
    const v = f(name)?.value;
    if (v === '' || v == null) return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  const start = fromLocalInput(f('start').value);
  if (!start) { toast('Enter a valid time'); return false; }
  const patch = { start, note: f('note') ? f('note').value.trim() : ev.note || '' };

  switch (type) {
    case T.FEED: {
      const left = Math.round((numOrNull('left') || 0) * 60);
      const right = Math.round((numOrNull('right') || 0) * 60);
      if (!left && !right) { toast('Enter a duration for at least one side'); return false; }
      const begin = f('beginSide').value;
      patch.leftSec = left; patch.rightSec = right;
      patch.beginSide = begin;
      // Ends on the other side only when both sides were nursed.
      patch.endSide = (left && right) ? (begin === 'LEFT' ? 'RIGHT' : 'LEFT') : (left ? 'LEFT' : 'RIGHT');
      patch.manual = true;
      break;
    }
    case T.SLEEP: {
      const end = f('end').value ? fromLocalInput(f('end').value) : null;
      if (end && end <= start) { toast('Wake time must be after the start'); return false; }
      patch.end = end;
      patch.durationSec = end ? Math.round((end - start) / 1000) : 0;
      break;
    }
    case T.DIAPER: {
      const kind = f('kind').value;
      patch.wet = kind === 'wet' || kind === 'both';
      patch.dirty = kind === 'dirty' || kind === 'both';
      patch.blowout = f('blowout').checked;
      patch.color = patch.dirty ? f('color').value : '';
      patch.texture = patch.dirty ? f('texture').value : '';
      break;
    }
    case T.GROWTH: {
      const w = numOrNull('weight'), ht = numOrNull('height'), hd = numOrNull('head');
      if (w == null && ht == null && hd == null) { toast('Enter at least one measurement'); return false; }
      patch.weightG = w == null ? null : toGrams(w, units.weight);
      patch.heightCm = ht == null ? null : toCm(ht, units.length);
      patch.headCm = hd == null ? null : toCm(hd, units.length);
      break;
    }
  }
  return patch;
}

/** Add sheet. Returns the saved event, or null. */
export async function addEntry(type, ctx, prefill = {}) {
  const draft = makeEvent(type, { caregiver: ctx.state.caregiver, ...prefill });
  const saved = await sheet({
    title: `Add ${TYPE_META[type].label.toLowerCase()}`,
    body: bodyFor(type, draft, ctx.state.units),
    actions: [{
      label: 'Save', cls: 'primary',
      onClick: root => {
        const patch = collect(type, root, draft, ctx.state.units);
        if (patch === false) return false;
        return { ...draft, ...patch, updated: Date.now() };
      },
    }],
  });
  if (saved) { await db.put(saved); ctx.refresh(); toast('Saved'); }
  return saved;
}

/** Edit sheet with delete. Returns 'saved' | 'deleted' | null. */
export async function editEntry(ev, ctx) {
  let deleted = false;
  const saved = await sheet({
    title: `Edit ${TYPE_META[ev.type]?.label.toLowerCase() || 'entry'}`,
    body: bodyFor(ev.type, ev, ctx.state.units),
    actions: [
      {
        label: 'Save', cls: 'primary',
        onClick: root => {
          const patch = collect(ev.type, root, ev, ctx.state.units);
          if (patch === false) return false;
          return { ...ev, ...patch, updated: Date.now() };
        },
      },
      {
        label: 'Delete', cls: 'danger',
        onClick: async (_root, close) => {
          if (!await confirm('Delete this entry?')) return false;
          await db.remove(ev.id);
          deleted = true;
          close('deleted');
          return false;
        },
      },
    ],
  });
  if (deleted) { ctx.refresh(); toast('Deleted'); return 'deleted'; }
  if (saved && typeof saved === 'object') { await db.put(saved); ctx.refresh(); toast('Saved'); return 'saved'; }
  return null;
}
