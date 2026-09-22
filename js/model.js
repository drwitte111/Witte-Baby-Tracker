// Activity model. One flat record shape per event, canonical units (g, cm, ml, seconds).
import { DAY, startOfDay } from './format.js';

export const T = {
  FEED:   'breastfeed',
  SLEEP:  'sleep',
  DIAPER: 'diaper',
  GROWTH: 'growth',
  BOTTLE: 'bottle',
  PUMP:   'pump',
};

export const TYPE_META = {
  [T.FEED]:   { icon: '🤱', label: 'Breastfeed', short: 'Feed',   color: 'var(--series-2)' },
  [T.SLEEP]:  { icon: '😴', label: 'Sleep',      short: 'Sleep',  color: 'var(--series-1)' },
  [T.DIAPER]: { icon: '🧷', label: 'Diaper',     short: 'Diaper', color: 'var(--series-3)' },
  [T.GROWTH]: { icon: '📏', label: 'Growth',     short: 'Growth', color: 'var(--text-secondary)' },
  [T.BOTTLE]: { icon: '🍼', label: 'Bottle',     short: 'Bottle', color: 'var(--text-secondary)' },
  [T.PUMP]:   { icon: '🫙', label: 'Pump',       short: 'Pump',   color: 'var(--text-secondary)' },
};

// Types the app can create/edit. Bottle and pump are imported read-only so a
// Nara export round-trips without losing rows.
export const EDITABLE = [T.FEED, T.SLEEP, T.DIAPER, T.GROWTH];

export const DIAPER_COLORS   = ['YELLOW', 'GREEN', 'GREEN YELLOW', 'BROWN', 'BLACK', 'RED'];
export const DIAPER_TEXTURES = ['MUSH', 'MUSH RUN', 'RUN', 'MUCOUS', 'HARD', 'SEEDY'];

export function newId(prefix = 'l') {
  const rnd = crypto.getRandomValues(new Uint8Array(9));
  return `${prefix}-${Date.now().toString(36)}${btoa(String.fromCharCode(...rnd)).replace(/[^a-zA-Z0-9]/g, '')}`;
}

export function makeEvent(type, fields = {}) {
  return {
    id: fields.id || newId(),
    type,
    start: fields.start ?? Date.now(),
    end: fields.end ?? null,
    note: fields.note || '',
    caregiver: fields.caregiver || '',
    tz: fields.tz || Intl.DateTimeFormat().resolvedOptions().timeZone,
    updated: Date.now(),
    ...fields,
  };
}

/* ---- derived ---- */

// Nursing duration is the sum of the two sides, not wall-clock (switch pauses count out).
export function feedSeconds(ev) { return (ev.leftSec || 0) + (ev.rightSec || 0); }

export function sleepSeconds(ev) {
  if (ev.durationSec) return ev.durationSec;
  if (ev.end) return Math.max(0, (ev.end - ev.start) / 1000);
  return 0;
}

export function isOngoingSleep(ev) { return ev.type === T.SLEEP && !ev.end; }

export function eventSeconds(ev) {
  if (ev.type === T.FEED) return feedSeconds(ev);
  if (ev.type === T.SLEEP) return sleepSeconds(ev);
  if (ev.type === T.PUMP) return ev.durationSec || 0;
  return 0;
}

export function diaperLabel(ev) {
  if (ev.wet && ev.dirty) return 'Wet + dirty';
  if (ev.wet) return 'Wet';
  if (ev.dirty) return 'Dirty';
  return 'Dry';
}

// "Left 12m" for one side, "L 8m · R 6m · 14m" when both were nursed.
export function feedLabel(ev) {
  const l = ev.leftSec || 0, r = ev.rightSec || 0;
  const m = sec => `${Math.max(1, Math.round(sec / 60))}m`;
  if (l && r) return `L ${m(l)} · R ${m(r)} · ${m(l + r)} total`;
  if (l) return `Left ${m(l)}`;
  if (r) return `Right ${m(r)}`;
  return 'no duration';
}

// Which side to offer next: the opposite of the side nursing ended on.
export function nextSide(lastFeed) {
  if (!lastFeed) return 'LEFT';
  const last = lastFeed.endSide || lastFeed.beginSide;
  return last === 'LEFT' ? 'RIGHT' : 'LEFT';
}

/* ---- aggregation ---- */

// Bucket events into local calendar days: [{key, dayStart, events[]}] oldest-first.
export function byDay(events, days, endMs = Date.now()) {
  const buckets = [];
  const index = new Map();
  const last = startOfDay(endMs);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(last); d.setDate(d.getDate() - i);
    const dayStart = d.getTime();
    const b = { key: dayStart, dayStart, events: [] };
    buckets.push(b); index.set(dayStart, b);
  }
  for (const ev of events) {
    const b = index.get(startOfDay(ev.start));
    if (b) b.events.push(ev);
  }
  return buckets;
}

// Sleep seconds attributed to the calendar day(s) the sleep actually covers,
// so a 8pm–7am night is split across both days instead of landing all on one.
export function sleepSecondsPerDay(sleeps, days, endMs = Date.now()) {
  const out = new Map();
  const last = startOfDay(endMs);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(last); d.setDate(d.getDate() - i);
    out.set(d.getTime(), { day: 0, night: 0 });
  }
  for (const ev of sleeps) {
    const end = ev.end || (isOngoingSleep(ev) ? Date.now() : ev.start);
    let cursor = ev.start;
    while (cursor < end) {
      const dayStart = startOfDay(cursor);
      const dayEnd = dayStart + DAY * 1000;
      const sliceEnd = Math.min(end, dayEnd);
      const bucket = out.get(dayStart);
      if (bucket) {
        // Night = the 7pm–7am window; split the slice at those boundaries.
        let t = cursor;
        while (t < sliceEnd) {
          const h = new Date(t).getHours();
          const nextHour = new Date(t); nextHour.setMinutes(0, 0, 0); nextHour.setHours(h + 1);
          const stop = Math.min(sliceEnd, nextHour.getTime());
          const sec = (stop - t) / 1000;
          if (h >= 19 || h < 7) bucket.night += sec; else bucket.day += sec;
          t = stop;
        }
      }
      cursor = sliceEnd;
    }
  }
  return out;
}

export function summarizeDay(events) {
  const s = { feeds: 0, feedSec: 0, sleepSec: 0, wet: 0, dirty: 0, both: 0, diapers: 0, bottleMl: 0 };
  for (const ev of events) {
    switch (ev.type) {
      case T.FEED:   s.feeds++; s.feedSec += feedSeconds(ev); break;
      case T.SLEEP:  s.sleepSec += sleepSeconds(ev); break;
      case T.DIAPER:
        s.diapers++;
        if (ev.wet && ev.dirty) s.both++;
        else if (ev.wet) s.wet++;
        else if (ev.dirty) s.dirty++;
        break;
      case T.BOTTLE: s.bottleMl += ev.volumeMl || 0; break;
    }
  }
  return s;
}
