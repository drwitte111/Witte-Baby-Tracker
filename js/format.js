// Time / unit formatting shared by every view.

export const MIN = 60, HOUR = 3600, DAY = 86400;

export function pad(n) { return String(n).padStart(2, '0'); }

// 1h 04m  ·  4m 12s  ·  38s
export function dur(sec, { seconds = false } = {}) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / HOUR), m = Math.floor((sec % HOUR) / MIN), s = sec % MIN;
  if (h) return `${h}h ${pad(m)}m`;
  if (m) return seconds ? `${m}m ${pad(s)}s` : `${m}m`;
  return `${s}s`;
}

// Stopwatch face: 12:04 or 1:02:17
export function clock(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / HOUR), m = Math.floor((sec % HOUR) / MIN), s = sec % MIN;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// "3h 12m ago" / "just now"
export function ago(ms, now = Date.now()) {
  const sec = (now - ms) / 1000;
  if (sec < 45) return 'just now';
  if (sec < 48 * HOUR) return `${dur(sec)} ago`;
  const days = Math.round(sec / DAY);
  if (days < 60) return `${days} days ago`;
  const months = Math.round(days / 30.44);
  return `${months} months ago`;
}

export function time(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function dateLong(ms) {
  const d = new Date(ms), today = new Date();
  const same = (a, b) => a.toDateString() === b.toDateString();
  const yest = new Date(today.getTime() - DAY * 1000);
  if (same(d, today)) return 'Today';
  if (same(d, yest)) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

export function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfDay(ms) {
  const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime();
}

// <input type="datetime-local"> round-trip, in local time.
export function toLocalInput(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromLocalInput(str) {
  const t = new Date(str).getTime();
  return Number.isNaN(t) ? null : t;
}
export function toDateInput(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Age: "8 mo 3 wk" / "5 wk 2 d" / "6 d"
export function ageFrom(birthMs, now = Date.now()) {
  if (!birthMs) return '';
  const days = Math.floor((now - birthMs) / (DAY * 1000));
  if (days < 0) return '';
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} old`;
  if (days < 70) {
    const w = Math.floor(days / 7), d = days % 7;
    return d ? `${w} wk ${d} d old` : `${w} weeks old`;
  }
  const b = new Date(birthMs), n = new Date(now);
  let mo = (n.getFullYear() - b.getFullYear()) * 12 + (n.getMonth() - b.getMonth());
  if (n.getDate() < b.getDate()) mo--;
  const anchor = new Date(b); anchor.setMonth(b.getMonth() + mo);
  const rem = Math.floor((n - anchor) / (DAY * 1000));
  const wk = Math.floor(rem / 7);
  return wk ? `${mo} mo ${wk} wk old` : `${mo} months old`;
}

/* ---- units: canonical storage is grams and centimetres ---- */
export const LB_PER_KG = 2.2046226218, CM_PER_IN = 2.54, ML_PER_OZ = 29.5735;

export function gramsTo(g, unit) { return unit === 'kg' ? g / 1000 : (g / 1000) * LB_PER_KG; }
export function toGrams(v, unit) { return unit === 'kg' ? v * 1000 : (v / LB_PER_KG) * 1000; }
export function cmTo(cm, unit) { return unit === 'cm' ? cm : cm / CM_PER_IN; }
export function toCm(v, unit) { return unit === 'cm' ? v : v * CM_PER_IN; }

// 17 lb 3.4 oz  /  7.81 kg
export function weightLabel(g, unit) {
  if (g == null) return '—';
  if (unit === 'kg') return `${(g / 1000).toFixed(2)} kg`;
  const totalLb = (g / 1000) * LB_PER_KG;
  let lb = Math.floor(totalLb);
  let oz = Math.round((totalLb - lb) * 16 * 10) / 10;
  if (oz >= 16) { lb += 1; oz = 0; }          // 16.0 oz is a pound, not a pound-plus
  return `${lb} lb ${oz.toFixed(1)} oz`;
}
export function lengthLabel(cm, unit) {
  if (cm == null) return '—';
  return unit === 'cm' ? `${cm.toFixed(1)} cm` : `${(cm / CM_PER_IN).toFixed(2)} in`;
}
export function volumeLabel(ml, unit) {
  if (ml == null) return '—';
  return unit === 'ml' ? `${Math.round(ml)} ml` : `${(ml / ML_PER_OZ).toFixed(1)} oz`;
}
