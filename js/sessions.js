// Running-timer arithmetic for nursing and sleep sessions. Pure functions over
// the persisted session objects, so a reload mid-timer changes nothing and the
// same math can be checked without a browser.

/* ---- nursing: { start, side, beginSide, leftSec, rightSec, running, sinceTick } ---- */

/** Bank the current run into the active side's total; returns a new session. */
export function accrueFeed(s, now = Date.now()) {
  if (!s.running) return s;
  const add = Math.max(0, (now - s.sinceTick) / 1000);
  const key = s.side === 'LEFT' ? 'leftSec' : 'rightSec';
  return { ...s, [key]: (s[key] || 0) + add, sinceTick: now };
}

export function feedTotals(s, now = Date.now()) {
  const a = accrueFeed(s, now);
  return { left: a.leftSec || 0, right: a.rightSec || 0, total: (a.leftSec || 0) + (a.rightSec || 0) };
}

/* ---- sleep: { start, elapsedSec, running, sinceTick } ---- */

/** Older sessions were just { start }; give them the full shape. */
export function normSleep(s) {
  if (!s) return null;
  return { start: s.start, elapsedSec: s.elapsedSec || 0, running: s.running !== false,
           sinceTick: s.sinceTick || s.start };
}

export function sleepElapsed(s, now = Date.now()) {
  const n = normSleep(s);
  return n.elapsedSec + (n.running ? Math.max(0, (now - n.sinceTick) / 1000) : 0);
}

/** Bank the current run into elapsedSec; returns a new session. */
export function bankSleep(s, now = Date.now()) {
  const n = normSleep(s);
  return n.running ? { ...n, elapsedSec: n.elapsedSec + Math.max(0, (now - n.sinceTick) / 1000), sinceTick: now } : n;
}

/* ---- shared ---- */

/** "It actually started at T": move the start and credit the difference to `creditKey`. */
export function shiftStart(session, newStart, creditKey) {
  const delta = (session.start - newStart) / 1000;            // +ve when moved earlier
  const out = { ...session, start: newStart };
  out[creditKey] = Math.max(0, (session[creditKey] || 0) + delta);
  return out;
}

export const hhmm = ms => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** A wheel gives only a clock time: today at that time, or yesterday if that is in the future. */
export function todayAt(hhmmStr, now = Date.now()) {
  const [h, m] = String(hhmmStr).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const d = new Date(now); d.setHours(h, m, 0, 0);
  if (d.getTime() > now) d.setDate(d.getDate() - 1);
  return d.getTime();
}
