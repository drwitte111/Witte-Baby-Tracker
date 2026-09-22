// Home: today at a glance, then one card per activity in a fixed order.
// A running feed or sleep changes its own card in place — nothing reorders.
import { db } from '../db.js';
import { T, makeEvent, feedSeconds, sleepSeconds, nextSide, feedLabel, diaperLabel, summarizeDay } from '../model.js';
import { ago, clock, dur, time, startOfDay, weightLabel, lengthLabel } from '../format.js';
import { esc, icon, toast, confirm } from '../ui.js';
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

const head = (tone, ico, title, meta = '') => `
  <div class="card-head">
    <span class="chip-ico">${icon(ico)}</span>
    <span class="card-title">${title}</span>
    ${meta ? `<span class="meta">${meta}</span>` : ''}
  </div>`;

export async function render(root, ctx) {
  const now = Date.now();
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
  const u = ctx.state.units;

  /* ---- today ribbon ---- */
  const sleepToday = today.sleepSec + (sleeping ? (now - sleeping.start) / 1000 : 0);
  const ribbon = `<section class="ribbon" aria-label="Today so far">
    <div class="tone-feed">${icon('i-feed', 'sm')}<b>${today.feeds}</b><span>feeds · ${dur(today.feedSec)}</span></div>
    <div class="tone-sleep">${icon('i-sleep', 'sm')}<b>${dur(sleepToday)}</b><span>sleep today</span></div>
    <div class="tone-diaper">${icon('i-diaper', 'sm')}<b>${today.diapers}</b><span>${today.wet + today.both} wet · ${today.dirty + today.both} dirty</span></div>
  </section>`;

  /* ---- feed card: idle or nursing, same slot ---- */
  let feedCard;
  if (feed) {
    const s = liveSides(feed);
    feedCard = `<section class="card active tone-feed" id="feed-card">
      ${head('feed', 'i-feed', `<span class="pulse"></span>Nursing · ${feed.side === 'LEFT' ? 'left' : 'right'}`,
             `<span class="pill">${feed.running ? 'running' : 'paused'}</span>`)}
      <div class="timer">
        <div class="big" data-live="total">${clock(s.total)}</div>
        <div class="side-tot">
          <span class="${feed.side === 'LEFT' ? 'side-active' : ''}">Left <span data-live="left">${clock(s.left)}</span></span>
          <span class="${feed.side === 'RIGHT' ? 'side-active' : ''}">Right <span data-live="right">${clock(s.right)}</span></span>
        </div>
      </div>
      <div class="row">
        <button class="btn soft" data-act="feed-switch">${icon('i-switch')}Switch to ${feed.side === 'LEFT' ? 'right' : 'left'}</button>
        <button class="btn soft" data-act="feed-pause">${icon(feed.running ? 'i-pause' : 'i-play')}${feed.running ? 'Pause' : 'Resume'}</button>
      </div>
      <div class="row">
        <button class="btn tone" data-act="feed-save">${icon('i-check')}Save feed</button>
        <button class="btn ghost" data-act="feed-discard">Discard</button>
      </div>
    </section>`;
  } else {
    const suggestion = nextSide(lastFeed);
    const sideBtn = side => `<button class="btn ${suggestion === side ? 'tone' : 'soft'}" data-act="feed-start" data-side="${side}">
      ${side === 'LEFT' ? 'Left' : 'Right'}${suggestion === side ? '<span class="badge">next</span>' : ''}</button>`;
    feedCard = `<section class="card tone-feed" id="feed-card">
      ${head('feed', 'i-feed', 'Feeding', lastFeed ? `last ${esc(time(lastFeed.start))}` : '')}
      <div class="since" data-live="feed-since" data-start="${lastFeed ? lastFeed.start : ''}">${lastFeed ? ago(lastFeed.start, now) : 'No feeds yet'}</div>
      ${lastFeed ? `<p class="sub">${esc(feedLabel(lastFeed))}</p>` : '<p class="sub">Tap a side to start the timer</p>'}
      <div class="row">${sideBtn('LEFT')}${sideBtn('RIGHT')}</div>
      <div class="row"><button class="btn ghost wide" data-act="feed-manual">${icon('i-plus', 'sm')}Log a past feed</button></div>
    </section>`;
  }

  /* ---- sleep card: awake or sleeping, same slot ---- */
  let sleepCard;
  if (sleeping) {
    sleepCard = `<section class="card active tone-sleep" id="sleep-card">
      ${head('sleep', 'i-sleep', '<span class="pulse"></span>Sleeping', `since ${esc(time(sleeping.start))}`)}
      <div class="since live" data-live="sleep-elapsed">${dur((now - sleeping.start) / 1000)}</div>
      <p class="sub">Tap when ${esc(ctx.state.profile?.name || 'baby')} wakes</p>
      <div class="row">
        <button class="btn tone" data-act="sleep-wake">${icon('i-check')}Woke up</button>
        <button class="btn ghost" data-act="sleep-discard">Discard</button>
      </div>
    </section>`;
  } else {
    const finished = lastSleep;
    sleepCard = `<section class="card tone-sleep" id="sleep-card">
      ${head('sleep', 'i-sleep', 'Sleep', finished ? `up since ${esc(time(finished.end))}` : '')}
      <div class="since" data-live="wake-since" data-mode="elapsed" data-start="${finished ? finished.end : ''}">${finished ? dur((now - finished.end) / 1000) : 'No sleep logged'}</div>
      <p class="sub">${finished ? `awake · last sleep ${dur(sleepSeconds(finished))}` : 'Start the timer when baby goes down'}</p>
      <div class="row">
        <button class="btn tone" data-act="sleep-start">${icon('i-sleep')}Start sleep</button>
        <button class="btn ghost" data-act="sleep-manual">${icon('i-plus', 'sm')}Past sleep</button>
      </div>
    </section>`;
  }

  /* ---- diaper card ---- */
  const diaperCard = `<section class="card tone-diaper" id="diaper-card">
    ${head('diaper', 'i-diaper', 'Diapers', lastDiaper ? `last ${esc(time(lastDiaper.start))}` : '')}
    <div class="since" data-live="diaper-since" data-start="${lastDiaper ? lastDiaper.start : ''}">${lastDiaper ? ago(lastDiaper.start, now) : 'None logged'}</div>
    <p class="sub">${lastDiaper ? `${esc(diaperLabel(lastDiaper))}${lastDiaper.blowout ? ' · blowout' : ''}` : 'One tap logs it now'}</p>
    <div class="row">
      <button class="btn soft" data-act="diaper" data-kind="wet">Wet</button>
      <button class="btn soft" data-act="diaper" data-kind="dirty">Dirty</button>
      <button class="btn soft" data-act="diaper" data-kind="both">Both</button>
    </div>
    <div class="row"><button class="btn ghost wide" data-act="diaper-detail">${icon('i-plus', 'sm')}With details</button></div>
  </section>`;

  /* ---- growth card ---- */
  const growthCard = `<section class="card tone-growth" id="growth-card">
    ${head('growth', 'i-ruler', 'Growth', lastGrowth ? esc(new Date(lastGrowth.start).toLocaleDateString([], { month: 'short', day: 'numeric' })) : '')}
    ${lastGrowth ? `<div class="grid2">
      <div class="stat"><b>${esc(weightLabel(lastGrowth.weightG, u.weight))}</b><span>weight</span></div>
      <div class="stat"><b>${esc(lengthLabel(lastGrowth.heightCm, u.length))}</b><span>length</span></div>
    </div>` : '<p class="sub">No measurements yet</p>'}
    <div class="row">
      <button class="btn soft" data-act="growth-add">${icon('i-plus', 'sm')}Add measurement</button>
      <button class="btn ghost" data-act="go-growth">${icon('i-growth', 'sm')}Curves</button>
    </div>
  </section>`;

  root.innerHTML = ribbon + feedCard + sleepCard + diaperCard + growthCard;
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
        await ctx.setActiveFeed({ start: now, side: btn.dataset.side, beginSide: btn.dataset.side,
                                  leftSec: 0, rightSec: 0, running: true, sinceTick: now });
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
      case 'growth-add':   await addEntry(T.GROWTH, ctx); break;
      case 'go-growth':    ctx.go('growth'); break;
    }
  });
}
