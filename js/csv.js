// Nara Baby CSV: parser and writer. Column order below is the export's own, so a
// file written here opens anywhere the original did.
import { T, makeEvent } from './model.js';
import { toGrams, toCm, ML_PER_OZ } from './format.js';

export const HEADER = [
  'Type', 'Profile Name', 'Start Date/time', 'Start Date/time (Epoch)',
  'Created By Caregiver', 'Last Updated By Caregiver', 'Note', 'Time Zone',
  '[Breastfeed] Begin Side', '[Breastfeed] End Side',
  '[Breastfeed] Left Duration (Seconds)', '[Breastfeed] Right Duration (Seconds)',
  '[Sleep] Duration (Seconds)', '[Sleep] End Date/time', '[Sleep] End Date/time (Epoch)',
  '[Growth] Head Size', '[Growth] Head Size Unit', '[Growth] Height', '[Growth] Height Unit',
  '[Growth] Weight', '[Growth] Weight Unit',
  '[Bottle Feed] Type', '[Bottle Feed] Breast Milk Volume', '[Bottle Feed] Breast Milk Volume Unit',
  '[Bottle Feed] Formula Name', '[Bottle Feed] Formula Volume', '[Bottle Feed] Formula Volume Unit',
  '[Bottle Feed] Volume', '[Bottle Feed] Volume Unit',
  '[Diaper] Type', '[Diaper] Detail', '[Diaper] Dirty Color', '[Diaper] Dirty Texture',
  '[Pump] Duration (Seconds)', '[Pump] End Date/time', '[Pump] End Date/time (Epoch)',
  '[Pump] Left Volume', '[Pump] Left Volume Unit', '[Pump] Right Volume', '[Pump] Right Volume Unit',
  '[Pump] Total Volume', '[Pump] Total Volume Unit',
  '[Profile] Birth Date', '[Profile] Birth Date (Adjusted)', '[Profile] Sex', '[Profile] Type',
  '_familyKey', '_profileKey', '_activityKey',
];

/* ---------- reading ---------- */

// RFC4180 with embedded newlines and "" escapes.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false, i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1;             // strip BOM
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { quoted = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r[0] || '').trim() !== '');
}

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const int = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };

function epochOr(local, epoch) {
  const e = int(epoch);
  if (e) return e;
  if (!local) return null;
  const t = new Date(local.replace(' ', 'T')).getTime();
  return Number.isNaN(t) ? null : t;
}

const ozToMl = (v, unit) => v == null ? null : (unit === 'ML' ? v : v * ML_PER_OZ);

// -> { events, profile, skipped }
export function fromNaraCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { events: [], profile: null, skipped: 0 };
  const head = rows[0].map(h => h.trim());
  const idx = Object.fromEntries(head.map((h, i) => [h, i]));
  const get = (r, name) => (idx[name] === undefined ? '' : (r[idx[name]] ?? '').trim());

  const events = [];
  let profile = null, skipped = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const type = get(row, 'Type');
    if (!type) { skipped++; continue; }

    if (type === 'Profile') {
      profile = {
        name: get(row, 'Profile Name'),
        birth: epochOr(get(row, '[Profile] Birth Date') + ' 00:00:00', ''),
        sex: get(row, '[Profile] Sex'),
        familyKey: get(row, '_familyKey'),
        profileKey: get(row, '_profileKey'),
      };
      continue;
    }

    const start = epochOr(get(row, 'Start Date/time'), get(row, 'Start Date/time (Epoch)'));
    if (!start) { skipped++; continue; }

    const base = {
      id: get(row, '_activityKey') || undefined,
      start,
      note: get(row, 'Note'),
      caregiver: get(row, 'Created By Caregiver'),
      tz: get(row, 'Time Zone') || undefined,
      familyKey: get(row, '_familyKey') || undefined,
      profileKey: get(row, '_profileKey') || undefined,
      profileId: get(row, '_profileKey') || undefined,
    };

    switch (type) {
      case 'Breastfeed': {
        // "RIGHT.nonTimer" marks an entry typed in rather than timed.
        const rawEnd = get(row, '[Breastfeed] End Side');
        const manual = rawEnd.includes('.nonTimer');
        events.push(makeEvent(T.FEED, {
          ...base,
          beginSide: (get(row, '[Breastfeed] Begin Side') || 'LEFT').split('.')[0],
          endSide: (rawEnd || get(row, '[Breastfeed] Begin Side') || 'LEFT').split('.')[0],
          leftSec: int(get(row, '[Breastfeed] Left Duration (Seconds)')) || 0,
          rightSec: int(get(row, '[Breastfeed] Right Duration (Seconds)')) || 0,
          manual,
        }));
        break;
      }
      case 'Sleep': {
        const end = epochOr(get(row, '[Sleep] End Date/time'), get(row, '[Sleep] End Date/time (Epoch)'));
        events.push(makeEvent(T.SLEEP, {
          ...base,
          end,
          durationSec: int(get(row, '[Sleep] Duration (Seconds)')) || (end ? Math.round((end - start) / 1000) : 0),
        }));
        break;
      }
      case 'Diaper': {
        const d = get(row, '[Diaper] Type').toUpperCase();
        events.push(makeEvent(T.DIAPER, {
          ...base,
          wet: d.includes('WET'),
          dirty: d.includes('DIRTY'),
          blowout: get(row, '[Diaper] Detail').toUpperCase().includes('BLOWOUT'),
          color: get(row, '[Diaper] Dirty Color'),
          texture: get(row, '[Diaper] Dirty Texture'),
        }));
        break;
      }
      case 'Growth': {
        const w = num(get(row, '[Growth] Weight')), h = num(get(row, '[Growth] Height')), hd = num(get(row, '[Growth] Head Size'));
        events.push(makeEvent(T.GROWTH, {
          ...base,
          weightG: w == null ? null : toGrams(w, get(row, '[Growth] Weight Unit') === 'KG' ? 'kg' : 'lb'),
          heightCm: h == null ? null : toCm(h, get(row, '[Growth] Height Unit') === 'CM' ? 'cm' : 'in'),
          headCm: hd == null ? null : toCm(hd, get(row, '[Growth] Head Size Unit') === 'CM' ? 'cm' : 'in'),
        }));
        break;
      }
      case 'Bottle Feed': {
        const bm = ozToMl(num(get(row, '[Bottle Feed] Breast Milk Volume')), get(row, '[Bottle Feed] Breast Milk Volume Unit'));
        const fm = ozToMl(num(get(row, '[Bottle Feed] Formula Volume')), get(row, '[Bottle Feed] Formula Volume Unit'));
        const gen = ozToMl(num(get(row, '[Bottle Feed] Volume')), get(row, '[Bottle Feed] Volume Unit'));
        events.push(makeEvent(T.BOTTLE, {
          ...base,
          kind: get(row, '[Bottle Feed] Type') || 'Breast Milk',
          formulaName: get(row, '[Bottle Feed] Formula Name'),
          breastMilkMl: bm, formulaMl: fm, genericMl: gen,
          volUnit: get(row, '[Bottle Feed] Breast Milk Volume Unit')
                || get(row, '[Bottle Feed] Formula Volume Unit')
                || get(row, '[Bottle Feed] Volume Unit') || 'FLOZ',
          volumeMl: (bm || 0) + (fm || 0) || gen,
        }));
        break;
      }
      case 'Pump': {
        const end = epochOr(get(row, '[Pump] End Date/time'), get(row, '[Pump] End Date/time (Epoch)'));
        const l = ozToMl(num(get(row, '[Pump] Left Volume')), get(row, '[Pump] Left Volume Unit'));
        const rr = ozToMl(num(get(row, '[Pump] Right Volume')), get(row, '[Pump] Right Volume Unit'));
        const tot = ozToMl(num(get(row, '[Pump] Total Volume')), get(row, '[Pump] Total Volume Unit'));
        events.push(makeEvent(T.PUMP, {
          ...base, end,
          durationSec: int(get(row, '[Pump] Duration (Seconds)')) || 0,
          leftMl: l, rightMl: rr, totalMl: tot,
          volUnit: get(row, '[Pump] Left Volume Unit') || get(row, '[Pump] Right Volume Unit')
                || get(row, '[Pump] Total Volume Unit') || 'FLOZ',
          volumeMl: (l || 0) + (rr || 0) || tot,
        }));
        break;
      }
      default:
        skipped++;
    }
  }
  return { events, profile, skipped };
}

/* ---------- writing ---------- */

const tzCache = new Map();
function tzFormatter(tz) {
  if (!tzCache.has(tz)) {
    tzCache.set(tz, new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return tzCache.get(tz);
}

// "2026-09-22 07:13:06" in the event's own time zone.
export function localStamp(ms, tz) {
  if (ms == null) return '';
  const parts = Object.fromEntries(tzFormatter(tz || 'UTC').formatToParts(ms)
    .filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day} ${hour}:${parts.minute}:${parts.second}`;
}

function q(v) {
  if (v === null || v === undefined || v === '') return '';
  return `"${String(v).replace(/"/g, '""')}"`;
}

// Emit in whatever unit the row arrived in, so re-export is byte-stable.
const mlIn = (ml, unit) => ml == null ? '' : (unit === 'ML' ? +ml.toFixed(3) : +(ml / ML_PER_OZ).toFixed(4));

export function toNaraCsv(events, profile, units = { weight: 'lb', length: 'in' }) {
  const lines = [HEADER.map(q).join(',')];
  const name = profile?.name || '';
  const fam = profile?.familyKey || '', pk = profile?.profileKey || '';

  if (profile) {
    const p = Object.fromEntries(HEADER.map(h => [h, '']));
    p['Type'] = 'Profile';
    p['Profile Name'] = name;
    p['[Profile] Birth Date'] = profile.birth ? localStamp(profile.birth, profile.tz || 'UTC').slice(0, 10) : '';
    p['[Profile] Sex'] = profile.sex || '';
    p['[Profile] Type'] = 'CHILD';
    p['_familyKey'] = fam; p['_profileKey'] = pk;
    lines.push(HEADER.map(h => q(p[h])).join(','));
  }

  // Nara exports newest first.
  for (const ev of [...events].sort((a, b) => b.start - a.start)) {
    const r = Object.fromEntries(HEADER.map(h => [h, '']));
    const tz = ev.tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
    r['Profile Name'] = ev.type === T.PUMP ? '' : name;
    r['Start Date/time'] = localStamp(ev.start, tz);
    r['Start Date/time (Epoch)'] = ev.start;
    r['Created By Caregiver'] = ev.caregiver || '';
    r['Last Updated By Caregiver'] = ev.caregiver || '';
    r['Note'] = ev.note || '';
    r['Time Zone'] = tz;
    r['_familyKey'] = ev.familyKey || fam;
    r['_profileKey'] = ev.type === T.PUMP ? '' : (ev.profileKey || pk);
    r['_activityKey'] = ev.id;

    switch (ev.type) {
      case T.FEED:
        r['Type'] = 'Breastfeed';
        r['[Breastfeed] Begin Side'] = ev.beginSide || '';
        r['[Breastfeed] End Side'] = (ev.endSide || '') + (ev.manual ? '.nonTimer' : '');
        r['[Breastfeed] Left Duration (Seconds)'] = ev.leftSec || '';
        r['[Breastfeed] Right Duration (Seconds)'] = ev.rightSec || '';
        break;
      case T.SLEEP:
        r['Type'] = 'Sleep';
        r['[Sleep] Duration (Seconds)'] = ev.end ? (ev.durationSec || Math.round((ev.end - ev.start) / 1000)) : '';
        r['[Sleep] End Date/time'] = ev.end ? localStamp(ev.end, tz) : '';
        r['[Sleep] End Date/time (Epoch)'] = ev.end || '';
        break;
      case T.DIAPER:
        r['Type'] = 'Diaper';
        r['[Diaper] Type'] = ev.dirty && ev.wet ? 'Dirty Wet' : ev.dirty ? 'Dirty' : ev.wet ? 'Wet' : 'Dry';
        r['[Diaper] Detail'] = ev.blowout ? 'Blowout' : '';
        r['[Diaper] Dirty Color'] = ev.color || '';
        r['[Diaper] Dirty Texture'] = ev.texture || '';
        break;
      case T.GROWTH: {
        r['Type'] = 'Growth';
        if (ev.weightG != null) {
          r['[Growth] Weight'] = +(units.weight === 'kg' ? ev.weightG / 1000 : (ev.weightG / 1000) * 2.2046226218).toFixed(4);
          r['[Growth] Weight Unit'] = units.weight === 'kg' ? 'KG' : 'LB';
        }
        if (ev.heightCm != null) {
          r['[Growth] Height'] = +(units.length === 'cm' ? ev.heightCm : ev.heightCm / 2.54).toFixed(2);
          r['[Growth] Height Unit'] = units.length === 'cm' ? 'CM' : 'IN';
        }
        if (ev.headCm != null) {
          r['[Growth] Head Size'] = +(units.length === 'cm' ? ev.headCm : ev.headCm / 2.54).toFixed(2);
          r['[Growth] Head Size Unit'] = units.length === 'cm' ? 'CM' : 'IN';
        }
        break;
      }
      case T.BOTTLE: {
        const u = ev.volUnit || 'FLOZ';
        r['Type'] = 'Bottle Feed';
        r['[Bottle Feed] Type'] = ev.kind || '';
        if (ev.breastMilkMl != null) { r['[Bottle Feed] Breast Milk Volume'] = mlIn(ev.breastMilkMl, u); r['[Bottle Feed] Breast Milk Volume Unit'] = u; }
        if (ev.formulaMl != null) { r['[Bottle Feed] Formula Volume'] = mlIn(ev.formulaMl, u); r['[Bottle Feed] Formula Volume Unit'] = u; }
        r['[Bottle Feed] Formula Name'] = ev.formulaName || '';
        const generic = ev.genericMl ?? (ev.breastMilkMl == null && ev.formulaMl == null ? ev.volumeMl : null);
        if (generic != null) { r['[Bottle Feed] Volume'] = mlIn(generic, u); r['[Bottle Feed] Volume Unit'] = u; }
        break;
      }
      case T.PUMP: {
        const u = ev.volUnit || 'FLOZ';
        r['Type'] = 'Pump';
        r['[Pump] Duration (Seconds)'] = ev.durationSec || '';
        r['[Pump] End Date/time'] = ev.end ? localStamp(ev.end, tz) : '';
        r['[Pump] End Date/time (Epoch)'] = ev.end || '';
        if (ev.leftMl != null) { r['[Pump] Left Volume'] = mlIn(ev.leftMl, u); r['[Pump] Left Volume Unit'] = u; }
        if (ev.rightMl != null) { r['[Pump] Right Volume'] = mlIn(ev.rightMl, u); r['[Pump] Right Volume Unit'] = u; }
        if (ev.totalMl != null) { r['[Pump] Total Volume'] = mlIn(ev.totalMl, u); r['[Pump] Total Volume Unit'] = u; }
        break;
      }
    }
    lines.push(HEADER.map(h => q(r[h])).join(','));
  }
  return lines.join('\n') + '\n';
}
