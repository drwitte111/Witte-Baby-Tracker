// Home: live timers, "time since last", one-tap logging, today at a glance.
import { db } from '../db.js';
import { T, makeEvent, feedSeconds, sleepSeconds, nextSide, feedLabel, diaperLabel, summarizeDay } from '../model.js';
import { ago, clock, dur, time, startOfDay, DAY, weightLabel } from '../format.js';
import { esc, toast, confirm } from '../ui.js';
import { addEntry } from '../forms.js';

/* ---- active-session helpers (persisted, so a refresh mid-feed loses nothing) ---- */

function accrue(s, now = Date.now()) {
  if (!s.running) return s;
  const add = Math.max(0, (now - s.sinceTick) / 1000);
  const key = s.side === 'LEFT' ? 'leftSec' : 'rightSec';
  return { ...s, [key]: (s[key] || 0) + add, sinceTick: now };
}

function liveSides(s, now = Date.now()) {
  const a = accrue(s, now);
  return { left: a.leftSec || 0, right: a.rightSec || 0, total: (a.leftSec || 0) + (a.rightSec || 0) };
}

export async function render(root, ctx) {
  const now = Date.now();
  const since = now - DAY * 1000 * 2;
  const [lastFeed, lastDiaper, lastSleep, lastGrowth, todayEvents] = await Promise.all([
    db.latest(T.FEED),
    db.latest(T.DIAPER),
    db.latest(T.SLEEP, ev => !!ev.end),          // newest *finished* sleep
    db.latest(T.GROWTH),
    db.range(startOfDay(now), now + 1),
  ]);
  const today = summarizeDay(todayEvents);
  const feed = ctx.state.activeFeed;
  const sleeping = ctx.state.activeSleep;

  const cards = [];

  /* running nursing session */
  if (feed) {
    const s = liveSides(feed);
    cards.push(`<section class="card" id="feed-timer">
      <div class="card-head"><span class="card-title">Nursing · ${feed.side === 'LEFT' ? 'left' : 'right'}</span>
        <span class="pill">${feed.running ? 'running' : 'paused'}</span></div>
      <div class="timer">
        <div class="big" data-live="total">${clock(s.total)}</div>
        <div class="side-tot">
          <span class="${feed.side === 'LEFT' ? 'side-active' : ''}">L <span data-live="left">${clock(s.left)}</span></span>
          <span class="${feed.side === 'RIGHT' ? 'side-active' : ''}">R <span data-live="right">${clock(s.right)}</span></span>
        </div>
      </div>
      <div class="row">
        <button class="btn" data-act="feed-switch">Switch to ${feed.side === 'LEFT' ? 'right' : 'left'}</button>
        <button class="btn" data-act="feed-pause">${feed.running ? 'Pause' : 'Resume'}</button>
      </div>
      <div class="row">
        <button class="btn primary" data-act="feed-save">Save feed</button>
        <button class="btn ghost" data-act="feed-discard">Discard</button>
      </div>
    </section>`);
  }

  /* running sleep */
  if (sleeping) {
    cards.push(`<section class="card">
      <div class="card-head"><span class="card-title">Asleep since ${time(sleeping.start)}</span></div>
      <div class="since live" data-live="sleep-elapsed">${dur((now - sleeping.start) / 1000)}</div>
      <div class="row">
        <button class="btn primary" data-act="sleep-wake">Woke up</button>
        <button class="btn ghost" data-act="sleep-discard">Discard</button>
      </div>
    </section>`);
  }

  /* feeds */
  if (!feed) {
    const suggestion = nextSide(lastFeed);
    cards.push(`<section class="card">
      <div class="card-head"><span class="card-title">Last feed</span>
        ${lastFeed ? `<span class="muted">${esc(time(lastFeed.start))}</span>` : ''}</div>
      <div class="since" data-live="feed-since" data-start="${lastFeed ? lastFeed.start : ''}">${lastFeed ? ago(lastFeed.start, now) : 'No feeds yet'}</div>
      ${lastFeed ? `<p class="sub">${esc(feedLabel(lastFeed))}</p>` : ''}
      <div class="row">
        <button class="btn ${suggestion === 'LEFT' ? 'primary' : ''}" data-act="feed-start" data-side="LEFT">Left${suggestion === 'LEFT' ? ' ·  next' : ''}</button>
        <button class="btn ${suggestion === 'RIGHT' ? 'primary' : ''}" data-act="feed-start" data-side="RIGHT">Right${suggestion === 'RIGHT' ? ' ·  next' : ''}</button>
      </div>
      <div class="row"><button class="btn ghost wide" data-act="feed-manual">Enter a past feed</button></div>
    </section>`);
  }

  /* sleep */
  if (!sleeping) {
    const finished = lastSleep;
    cards.push(`<section class="card">
      <div class="card-head"><span class="card-title">Awake for</span>
        ${finished ? `<span class="muted">up since ${esc(time(finished.end))}</span>` : ''}</div>
      <div class="since" data-live="wake-since" data-mode="elapsed" data-start="${finished ? finished.end : ''}">${finished ? dur((now - finished.end) / 1000) : 'No sleep logged'}</div>
      ${finished ? `<p class="sub">Last sleep ${dur(sleepSeconds(finished))}</p>` : ''}
      <div class="row">
        <button class="btn primary" data-act="sleep-start">Start sleep</button>
        <button class="btn ghost" data-act="sleep-manual">Past sleep</button>
      </div>
    </section>`);
  }

  /* diapers */
  cards.push(`<section class="card">
    <div class="card-head"><span class="card-title">Last diaper</span>
      ${lastDiaper ? `<span class="muted">${esc(time(lastDiaper.start))}</span>` : ''}</div>
    <div class="since" data-live="diaper-since" data-start="${lastDiaper ? lastDiaper.start : ''}">${lastDiaper ? ago(lastDiaper.start, now) : 'None logged'}</div>
    ${lastDiaper ? `<p class="sub">${esc(diaperLabel(lastDiaper))}${lastDiaper.blowout ? ' · blowout' : ''}</p>` : ''}
    <div class="row">
      <button class="btn" data-act="diaper" data-kind="wet">Wet</button>
      <button class="btn" data-act="diaper" data-kind="dirty">Dirty</button>
      <button class="btn" data-act="diaper" data-kind="both">Both</button>
    </div>
    <div class="row"><button class="btn ghost wide" data-act="diaper-detail">Add with details</button></div>
  </section>`);

  /* today */
  cards.push(`<section class="card">
    <div class="card-head"><span class="card-title">Today</span>
      <span class="muted">since midnight</span></div>
    <div class="grid2">
      <div class="stat"><b>${today.feeds}</b><span>feeds · ${dur(today.feedSec)}</span></div>
      <div class="stat"><b>${dur(today.sleepSec)}</b><span>sleep logged</span></div>
      <div class="stat"><b>${today.diapers}</b><span>diapers · ${today.wet + today.both}w / ${today.dirty + today.both}d</span></div>
      <div class="stat"><b>${lastGrowth ? esc(weightLabel(lastGrowth.weightG, ctx.state.units.weight)) : '—'}</b><span>latest weight</span></div>
    </div>
  </section>`);

  root.innerHTML = cards.join('');
  wire(root, ctx);
  ctx.onTick(() => tick(root, ctx));
}

/* ---- live text, once a second, without re-rendering the view ---- */
function tick(root, ctx) {
  const now = Date.now();
  const feed = ctx.state.activeFeed;
  if (feed) {
    const s = liveSides(feed, now);
    const set = (k, v) => { const el = root.querySelector(`[data-live="${k}"]`); if (el) el.textContent = v; };
    set('total', clock(s.total)); set('left', clock(s.left)); set('right', clock(s.right));
  }
  if (ctx.state.activeSleep) {
    const el = root.querySelector('[data-live="sleep-elapsed"]');
    if (el) el.textContent = dur((now - ctx.state.activeSleep.start) / 1000);
  }
  for (const key of ['feed-since', 'wake-since', 'diaper-since']) {
    const el = root.querySelector(`[data-live="${key}"]`);
    const start = el && el.dataset.start;
    if (!start) continue;
    el.textContent = el.dataset.mode === 'elapsed'
      ? dur((now - Number(start)) / 1000)
      : ago(Number(start), now);
  }
}

function wire(root, ctx) {
  root.addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const now = Date.now();

    switch (act) {
      case 'feed-start':
        await ctx.setActiveFeed({ start: now, side: btn.dataset.side, leftSec: 0, rightSec: 0, running: true, sinceTick: now });
        ctx.refresh();
        break;

      case 'feed-switch': {
        const s = accrue(ctx.state.activeFeed, now);
        await ctx.setActiveFeed({ ...s, side: s.side === 'LEFT' ? 'RIGHT' : 'LEFT', running: true, sinceTick: now });
        ctx.refresh();
        break;
      }

      case 'feed-pause': {
        const s = accrue(ctx.state.activeFeed, now);
        await ctx.setActiveFeed({ ...s, running: !ctx.state.activeFeed.running, sinceTick: now });
        ctx.refresh();
        break;
      }

      case 'feed-save': {
        const s = accrue(ctx.state.activeFeed, now);
        const left = Math.round(s.leftSec || 0), right = Math.round(s.rightSec || 0);
        if (left + right < 5) { toast('Too short to save — discard instead?'); return; }
        await db.put(makeEvent(T.FEED, {
          start: s.start, leftSec: left, rightSec: right,
          beginSide: s.beginSide || (left && !right ? 'LEFT' : right && !left ? 'RIGHT' : s.side),
          endSide: s.side, caregiver: ctx.state.caregiver,
        }));
        await ctx.setActiveFeed(null);
        ctx.refresh();
        toast(`Feed saved · ${dur(left + right)}`);
        break;
      }

      case 'feed-discard':
        if (await confirm('Discard this nursing session?', { okLabel: 'Discard' })) {
          await ctx.setActiveFeed(null); ctx.refresh();
        }
        break;

      case 'sleep-start':
        await ctx.setActiveSleep({ start: now });
        ctx.refresh();
        break;

      case 'sleep-wake': {
        const s = ctx.state.activeSleep;
        await db.put(makeEvent(T.SLEEP, {
          start: s.start, end: now, durationSec: Math.round((now - s.start) / 1000),
          caregiver: ctx.state.caregiver,
        }));
        await ctx.setActiveSleep(null);
        ctx.refresh();
        toast(`Sleep saved · ${dur((now - s.start) / 1000)}`);
        break;
      }

      case 'sleep-discard':
        if (await confirm('Discard this sleep?', { okLabel: 'Discard' })) {
          await ctx.setActiveSleep(null); ctx.refresh();
        }
        break;

      case 'diaper': {
        const kind = btn.dataset.kind;
        await db.put(makeEvent(T.DIAPER, {
          wet: kind === 'wet' || kind === 'both',
          dirty: kind === 'dirty' || kind === 'both',
          caregiver: ctx.state.caregiver,
        }));
        ctx.refresh();
        toast('Diaper logged');
        break;
      }

      case 'diaper-detail': await addEntry(T.DIAPER, ctx); break;
      case 'feed-manual':  await addEntry(T.FEED, ctx); break;
      case 'sleep-manual': await addEntry(T.SLEEP, ctx, { start: Date.now() - 3600 * 1000, end: Date.now() }); break;
    }
  });
}
