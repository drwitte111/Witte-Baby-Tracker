// Witte Baby — Lock Screen & Home Screen widget for Scriptable (free, App Store).
//
// Reads one small document the app keeps in your Firestore and shows the
// current baby's sleep / feed state. Timers tick live; the data itself
// refreshes on iOS's widget schedule (roughly every 15 minutes).
//
// Setup (once per phone):
//   1. Install "Scriptable" from the App Store.
//   2. In Scriptable: + → paste this whole file → name it "Witte Baby".
//   3. Home Screen: long-press → + → Scriptable → pick a size → "Edit Widget"
//      → Script: Witte Baby.
//   4. Lock Screen: long-press the lock screen → Customize → tap the widget
//      area → Scriptable → pick a shape → choose the script.
//
// Only these two lines ever need changing:
const PROJECT = 'witte-baby-tracker';
const SPACE = 'witte';

const URL = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/families/${SPACE}/meta/status`;

// ---- Firestore's REST shape → plain values -----------------------------------
function decode(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return new Date(v.timestampValue).getTime();
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  return null;
}
function decodeFields(fields) {
  const out = {};
  for (const k in fields) out[k] = decode(fields[k]);
  return out;
}

// ---- data -----------------------------------------------------------------------
async function load() {
  const req = new Request(URL);
  const json = await req.loadJSON();
  if (!json.fields) throw new Error(json.error?.message || 'No status yet — open the app once');
  return decodeFields(json.fields);
}

const MIN = 60000;
const fmtDur = ms => {
  const m = Math.max(0, Math.round(ms / MIN)), h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
};
const fmtTime = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// A running sleep: banked seconds + time since the current run started (unless paused)
function sleepSince(a) {
  if (!a) return null;
  const banked = (a.elapsedSec || 0) * 1000;
  const running = a.running !== false;
  const since = running ? (a.sinceTick || a.start) : null;
  return { running, anchor: since ? since - banked : null, elapsedMs: banked + (since ? Date.now() - since : 0), start: a.start };
}
function feedSince(a) {
  if (!a) return null;
  const banked = ((a.leftSec || 0) + (a.rightSec || 0)) * 1000;
  const running = a.running !== false;
  const since = running ? a.sinceTick : null;
  return { running, side: a.side, anchor: since ? since - banked : null, elapsedMs: banked + (since ? Date.now() - since : 0) };
}

// ---- colours ---------------------------------------------------------------------
const C = {
  sleep: new Color('#3987e5'), feed: new Color('#eb6834'), diaper: new Color('#1baf7a'),
  text: Color.dynamic(new Color('#121210'), new Color('#f4f4f1')),
  muted: Color.dynamic(new Color('#6b6a64'), new Color('#a5a49c')),
  bg: Color.dynamic(new Color('#ffffff'), new Color('#1b1b1a')),
};

// ---- building blocks -------------------------------------------------------------
function line(stack, text, size, color, weight = 'regular') {
  const t = stack.addText(text);
  t.font = weight === 'bold' ? Font.boldSystemFont(size) : weight === 'semibold' ? Font.semiboldSystemFont(size) : Font.systemFont(size);
  t.textColor = color; t.lineLimit = 1; t.minimumScaleFactor = 0.7;
  return t;
}
// Live text: a timer that ticks, or "x min ago" that updates, without a refresh.
function live(stack, anchorMs, size, color, style = 'timer') {
  const d = stack.addDate(new Date(anchorMs));
  if (style === 'timer') d.applyTimerStyle(); else d.applyRelativeStyle();
  d.font = Font.boldMonospacedSystemFont(size); d.textColor = color; d.lineLimit = 1; d.minimumScaleFactor = 0.6;
  return d;
}

function primary(s) {
  // What matters most right now, in priority order.
  const sl = sleepSince(s.activeSleep), fd = feedSince(s.activeFeed);
  if (fd) return { kind: 'feed', label: fd.running ? `Nursing · ${fd.side === 'LEFT' ? 'left' : 'right'}` : 'Feed paused', anchor: fd.anchor, elapsedMs: fd.elapsedMs, color: C.feed, icon: '🍼' };
  if (sl) return { kind: 'sleep', label: sl.running ? `Asleep since ${fmtTime(sl.start)}` : 'Sleep paused', anchor: sl.anchor, elapsedMs: sl.elapsedMs, color: C.sleep, icon: '🌙' };
  if (s.lastSleep?.end) return { kind: 'awake', label: `Awake since ${fmtTime(s.lastSleep.end)}`, anchor: s.lastSleep.end, elapsedMs: Date.now() - s.lastSleep.end, color: C.sleep, icon: '☀️' };
  return { kind: 'none', label: 'No sleep logged', anchor: null, elapsedMs: 0, color: C.muted, icon: '🌙' };
}
function feedLine(s) {
  if (!s.lastFeed) return 'No feeds yet';
  const side = s.lastFeed.endSide === 'LEFT' ? 'L' : s.lastFeed.endSide === 'RIGHT' ? 'R' : '';
  const next = side === 'L' ? 'R' : side === 'R' ? 'L' : '';
  return `Fed ${fmtTime(s.lastFeed.start)}${side ? ` (${side})` : ''}${next ? ` · next ${next}` : ''}`;
}

// ---- layouts -------------------------------------------------------------------------
function homeWidget(s, size) {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(14, 14, 14, 14);
  const p = primary(s);

  const head = w.addStack(); head.centerAlignContent();
  line(head, s.baby?.name || 'Baby', 13, C.muted, 'semibold');
  head.addSpacer();
  line(head, `${s.today?.feeds ?? 0} feeds · ${s.today?.diapers ?? 0} diapers`, 11, C.muted);
  w.addSpacer(6);

  line(w, `${p.icon} ${p.label}`, 13, p.color, 'semibold');
  if (p.anchor) live(w, p.anchor, size === 'small' ? 30 : 34, C.text, p.kind === 'awake' ? 'relative' : 'timer');
  else line(w, '—', 30, C.muted, 'bold');
  w.addSpacer(6);

  line(w, feedLine(s), 12, C.text);
  if (s.lastFeed) {
    const ago = w.addStack(); ago.centerAlignContent();
    line(ago, 'last feed ', 11, C.muted);
    live(ago, s.lastFeed.start, 11, C.muted, 'relative');
    line(ago, ' ago', 11, C.muted);
  }
  if (size !== 'small' && s.lastDiaper) {
    w.addSpacer(2);
    line(w, `Diaper ${fmtTime(s.lastDiaper.start)} · ${s.lastDiaper.wet && s.lastDiaper.dirty ? 'wet + dirty' : s.lastDiaper.dirty ? 'dirty' : 'wet'}`, 12, C.text);
  }
  return w;
}

function lockRectangular(s) {
  const w = new ListWidget();
  const p = primary(s);
  line(w, `${p.icon} ${p.label}`, 12, Color.white(), 'semibold');
  if (p.anchor) live(w, p.anchor, 22, Color.white(), p.kind === 'awake' ? 'relative' : 'timer');
  line(w, feedLine(s), 11, Color.white());
  return w;
}

function lockInline(s) {
  const w = new ListWidget();
  const p = primary(s);
  const st = w.addStack();
  line(st, `${p.icon} `, 12, Color.white());
  if (p.anchor) live(st, p.anchor, 12, Color.white(), p.kind === 'awake' ? 'relative' : 'timer');
  if (s.lastFeed) {
    line(st, ' · 🍼 ', 12, Color.white());
    live(st, s.lastFeed.start, 12, Color.white(), 'relative');
  }
  return w;
}

function lockCircular(s) {
  const w = new ListWidget();
  const p = primary(s);
  w.addSpacer();
  const st = w.addStack(); st.layoutVertically(); st.centerAlignContent();
  line(st, p.icon, 14, Color.white());
  if (p.anchor) live(st, p.anchor, 13, Color.white(), 'relative');
  w.addSpacer();
  return w;
}

function errorWidget(msg) {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  line(w, 'Witte Baby', 13, C.muted, 'semibold');
  w.addSpacer(4);
  const t = w.addText(msg); t.font = Font.systemFont(12); t.textColor = C.text;
  return w;
}

// ---- main ----------------------------------------------------------------------------
let widget;
try {
  const status = await load();
  const fam = config.widgetFamily || 'small';
  widget = fam === 'accessoryRectangular' ? lockRectangular(status)
         : fam === 'accessoryInline' ? lockInline(status)
         : fam === 'accessoryCircular' ? lockCircular(status)
         : homeWidget(status, fam);
} catch (e) {
  widget = errorWidget(String(e.message || e));
}
widget.refreshAfterDate = new Date(Date.now() + 15 * MIN);  // timers tick on their own; data every ~15 min keeps reads tiny
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentMedium();
Script.complete();
