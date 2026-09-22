// Stats: daily rhythm, sleep, feeds and diapers over a chosen window.
import { db } from '../db.js';
import { T, byDay, sleepSecondsPerDay, summarizeDay, feedSeconds, sleepSeconds } from '../model.js';
import { DAY, startOfDay, dur, time, dateLong } from '../format.js';
import { esc } from '../ui.js';
import { barChart, stackedBarChart, rhythmChart, vizCard } from '../charts.js';

let days = 7;
const RANGES = [7, 14, 30];

const dayLabel = ms => new Date(ms).toLocaleDateString([], { weekday: 'narrow' });
const dateLabel = ms => new Date(ms).toLocaleDateString([], { month: 'numeric', day: 'numeric' });

export async function render(root, ctx) {
  const now = Date.now();
  const from = startOfDay(now) - (days - 1) * DAY * 1000;
  const events = await db.range(from, now + 1);
  // Sleeps that began before the window can still cover its first night.
  const earlier = await db.range(from - DAY * 1000, from);
  const liveSleep = ctx.state.activeSleep
    ? [{ type: T.SLEEP, id: 'live', start: ctx.state.activeSleep.start, end: null }]
    : [];
  const sleeps = [...events, ...earlier].filter(e => e.type === T.SLEEP).concat(liveSleep);

  const buckets = byDay(events, days, now);
  const sleepPerDay = sleepSecondsPerDay(sleeps, days, now);

  const chips = RANGES.map(d =>
    `<button class="chip" data-range="${d}" aria-pressed="${days === d}">${d} days</button>`).join('');

  if (!events.length) {
    root.innerHTML = `<div class="chips">${chips}</div><p class="empty">Nothing logged in this window.</p>`;
    root.addEventListener('click', e => {
      const c = e.target.closest('[data-range]');
      if (c) { days = Number(c.dataset.range); ctx.refresh(); }
    });
    return;
  }

  /* ---- rhythm: sleep blocks + feed ticks per day ---- */
  const rhythmDays = buckets.map(b => {
    const dayStart = b.dayStart, dayEnd = dayStart + DAY * 1000;
    const blocks = [];
    for (const s of sleeps) {
      const sEnd = s.end || now;                       // an unfinished sleep runs to "now"
      if (s.start >= dayEnd || sEnd <= dayStart) continue;
      const from0 = Math.max(s.start, dayStart), to0 = Math.min(sEnd, dayEnd);
      blocks.push({
        from: (from0 - dayStart) / (DAY * 1000) * 24,
        to: (to0 - dayStart) / (DAY * 1000) * 24,
        tip: `${dateLong(dayStart)} · asleep ${time(s.start)}–${s.end ? time(s.end) : 'now'} (${dur(sleepSeconds(s) || (sEnd - s.start) / 1000)})`,
      });
    }
    const ticks = b.events.filter(e => e.type === T.FEED).map(e => ({
      at: (e.start - dayStart) / (DAY * 1000) * 24,
      tip: `Feed ${time(e.start)} · ${dur(feedSeconds(e))}`,
    }));
    return { label: dateLabel(dayStart), blocks, ticks };
  });

  /* ---- per-day series ---- */
  const sleepData = buckets.map(b => {
    const s = sleepPerDay.get(b.dayStart) || { day: 0, night: 0 };
    return {
      label: dayLabel(b.dayStart),
      parts: { night: s.night / 3600, day: s.day / 3600 },
      tip: `${dateLong(b.dayStart)} · ${dur(s.night + s.day)} total (night ${dur(s.night)}, day ${dur(s.day)})`,
    };
  });

  const feedData = buckets.map(b => {
    const feeds = b.events.filter(e => e.type === T.FEED);
    const sec = feeds.reduce((a, e) => a + feedSeconds(e), 0);
    return {
      label: dayLabel(b.dayStart), value: feeds.length,
      tip: `${dateLong(b.dayStart)} · ${feeds.length} feeds · ${dur(sec)} at the breast`,
    };
  });

  const diaperData = buckets.map(b => {
    const s = summarizeDay(b.events);
    return {
      label: dayLabel(b.dayStart),
      parts: { wet: s.wet, dirty: s.dirty, both: s.both },
      tip: `${dateLong(b.dayStart)} · ${s.diapers} diapers (${s.wet} wet, ${s.dirty} dirty, ${s.both} both)`,
    };
  });

  /* ---- headline averages ---- */
  const totalSleep = sleepData.reduce((a, d) => a + d.parts.night + d.parts.day, 0);
  const totalFeeds = feedData.reduce((a, d) => a + d.value, 0);
  const totalFeedSec = buckets.reduce((a, b) => a + b.events.filter(e => e.type === T.FEED).reduce((x, e) => x + feedSeconds(e), 0), 0);
  const totalDiapers = diaperData.reduce((a, d) => a + d.parts.wet + d.parts.dirty + d.parts.both, 0);
  const longest = sleeps.reduce((best, s) => sleepSeconds(s) > (best ? sleepSeconds(best) : 0) && s.start >= from ? s : best, null);

  let html = `<div class="chips">${chips}</div>
  <section class="card">
    <div class="card-head"><span class="card-title">Daily average</span><span class="muted">last ${days} days</span></div>
    <div class="grid2">
      <div class="stat"><b>${(totalSleep / days).toFixed(1)}h</b><span>sleep per day</span></div>
      <div class="stat"><b>${(totalFeeds / days).toFixed(1)}</b><span>feeds per day</span></div>
      <div class="stat"><b>${dur(totalFeedSec / Math.max(1, totalFeeds))}</b><span>per feed</span></div>
      <div class="stat"><b>${(totalDiapers / days).toFixed(1)}</b><span>diapers per day</span></div>
    </div>
    ${longest ? `<p class="sub">Longest stretch ${dur(sleepSeconds(longest))} starting ${time(longest.start)} on ${esc(dateLong(longest.start))}</p>` : ''}
  </section>`;

  html += vizCard({
    title: 'Daily rhythm',
    sub: 'Blue blocks are sleep; orange ticks are feeds. Midnight to midnight.',
    build: w => rhythmChart({ days: rhythmDays, width: w }),
    legendItems: [
      { label: 'Sleep', color: 'var(--series-1)' },
      { label: 'Feed', color: 'var(--series-2)' },
    ],
  });

  html += vizCard({
    title: 'Sleep per day',
    sub: 'Night counts 7pm–7am. A night split over midnight lands on both days.',
    build: w => stackedBarChart({
      data: sleepData, width: w, fmt: v => `${v.toFixed(0)}h`,
      series: [
        { key: 'night', label: 'Night', color: 'var(--series-1)' },
        { key: 'day', label: 'Day', color: 'var(--series-2)' },
      ],
    }),
    legendItems: [
      { label: 'Night 7pm–7am', color: 'var(--series-1)' },
      { label: 'Daytime naps', color: 'var(--series-2)' },
    ],
  });

  html += vizCard({
    title: 'Feeds per day',
    build: w => barChart({ data: feedData, width: w, color: 'var(--series-2)', fmt: v => v.toFixed(0) }),
  });

  const diaperTotal = diaperData.reduce((a, d) => a + d.parts.wet + d.parts.dirty + d.parts.both, 0);
  html += diaperTotal === 0 ? `<section class="viz"><h3>Diapers per day</h3>
    <p class="viz-sub">Nothing logged in this window.</p></section>` : vizCard({
    title: 'Diapers per day',
    build: w => stackedBarChart({
      data: diaperData, width: w, fmt: v => v.toFixed(0),
      series: [
        { key: 'wet', label: 'Wet', color: 'var(--series-1)' },
        { key: 'dirty', label: 'Dirty', color: 'var(--series-2)' },
        { key: 'both', label: 'Both', color: 'var(--series-3)' },
      ],
    }),
    legendItems: [
      { label: 'Wet', color: 'var(--series-1)' },
      { label: 'Dirty', color: 'var(--series-2)' },
      { label: 'Wet + dirty', color: 'var(--series-3)' },
    ],
  });

  /* Table view: the same numbers, readable without color. */
  html += `<section class="viz"><h3>Day by day</h3>
    <table class="tbl"><thead><tr><th>Day</th><th>Sleep</th><th>Feeds</th><th>At breast</th><th>Diapers</th></tr></thead><tbody>
    ${buckets.slice().reverse().map((b, i) => {
      const idx = buckets.length - 1 - i;
      const s = sleepPerDay.get(b.dayStart) || { day: 0, night: 0 };
      const f = feedData[idx], d = diaperData[idx];
      const sec = b.events.filter(e => e.type === T.FEED).reduce((a, e) => a + feedSeconds(e), 0);
      return `<tr><td>${esc(dateLong(b.dayStart))}</td><td>${dur(s.night + s.day)}</td><td>${f.value}</td><td>${dur(sec)}</td><td>${d.parts.wet + d.parts.dirty + d.parts.both}</td></tr>`;
    }).join('')}
    </tbody></table></section>`;

  root.innerHTML = html;
  root.addEventListener('click', e => {
    const c = e.target.closest('[data-range]');
    if (c) { days = Number(c.dataset.range); ctx.refresh(); }
  });
}
