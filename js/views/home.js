// Home: today at a glance, then one card per activity in a fixed order.
// A running feed or sleep changes its own card in place — nothing reorders.
import { db } from '../db.js';
import { T, makeEvent, feedSeconds, sleepSeconds, nextSide, feedLabel, diaperLabel, summarizeDay, sleepSecondsPerDay } from '../model.js';
import { ago, clock, dur, time, startOfDay, weightLabel, lengthLabel, DAY } from '../format.js';
import { esc, icon, toast, confirm } from '../ui.js';
import { accrueFeed as accrue, feedTotals as liveSides, normSleep, sleepElapsed, bankSleep, shiftStart, hhmm, todayAt } from '../sessions.js';
import { addEntry } from '../forms.js';

// "Set time" is a real <input type="time"> laid invisibly over the chip, so the
// tap goes straight to the phone's time wheel — no sheet, no date field.
const earlierRow = (act, label, startMs) => `<div class="row adjust">
  <span class="adjust-label">${label}</span>
  <button class="chip" data-act="${act}" data-min="1">−1m</button>
  <button class="chip" data-act="${act}" data-min="2">−2m</button>
  <button class="chip" data-act="${act}" data-min="5">−5m</button>
  <label class="chip set-time">${icon('i-clock')}Set time
    <input type="time" step="60" value="${hhmm(startMs)}" data-set="${act}" aria-label="${label} Set the exact time">
  </label>
</div>`;

const head = (tone, ico, title, meta = '') => `
  <div class="card-head">
    <span class="chip-ico">${icon(ico)}</span>
    <span class="card-title">${title}</span>
    ${meta ? `<span class="meta">${meta}</span>` : ''}
  </div>`;

export async function render(root, ctx) {
  const now = Date.now();
  const dayStart = startOfDay(now);
  const [lastFeed, lastDiaper, lastSleep, lastGrowth, todayEvents, recentSleeps] = await Promise.all([
    db.latest(T.FEED),
    db.latest(T.DIAPER),
    db.latest(T.SLEEP, ev => !!ev.end),          // newest *finished* sleep
    db.latest(T.GROWTH),
    db.range(dayStart, now + 1),
    db.ofType(T.SLEEP, dayStart - 2 * DAY * 1000, now + 1),
  ]);
  const today = summarizeDay(todayEvents);
  // Sleep "today" is the hours that fall inside today, so last night's 8pm–7am
  // counts its morning half. Only finished sleeps count; an open record that was
  // never closed (Nara exports one) would otherwise run until now.
  const sleptToday = sleepSecondsPerDay(recentSleeps.filter(e => e.end), 1, now).get(dayStart) || { day: 0, night: 0 };
  const feed = ctx.state.activeFeed;
  const sleeping = ctx.state.activeSleep;
  const u = ctx.state.units;

  /* ---- today ribbon ---- */
  const sleepToday = sleptToday.day + sleptToday.night + (sleeping ? sleepElapsed(sleeping, now) : 0);
  const ribbon = `<section class="ribbon" aria-label="Today so far">
    <div class="tone-feed">${icon('i-feed', 'sm')}<b>${today.feeds}</b><span>feeds · ${dur(today.feedSec)}</span></div>
    <div class="tone-sleep">${icon('i-sleep', 'sm')}<b>${sleepToday < 60 ? '0m' : dur(sleepToday)}</b><span>sleep today</span></div>
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
      ${earlierRow('feed-earlier', `Latched before ${esc(time(feed.start))}?`, feed.start)}
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
    const ss = normSleep(sleeping);
    sleepCard = `<section class="card active tone-sleep" id="sleep-card">
      ${head('sleep', 'i-sleep', `<span class="pulse"${ss.running ? '' : ' style="animation:none;opacity:.4"'}></span>${ss.running ? 'Sleeping' : 'Sleep paused'}`,
             `<span class="pill">${ss.running ? 'since ' + esc(time(ss.start)) : 'paused'}</span>`)}
      <div class="since live" data-live="sleep-elapsed">${dur(sleepElapsed(ss, now))}</div>
      <p class="sub">Fell asleep ${esc(time(ss.start))}${ss.running ? '' : ' · timer stopped while awake'}</p>
      <div class="row">
        <button class="btn tone" data-act="sleep-wake">${icon('i-check')}Woke up</button>
        <button class="btn soft" data-act="sleep-pause">${icon(ss.running ? 'i-pause' : 'i-play')}${ss.running ? 'Pause' : 'Resume'}</button>
      </div>
      ${earlierRow('sleep-earlier', 'Fell asleep earlier?', ss.start)}
      <div class="row"><button class="btn ghost wide" data-act="sleep-discard">Discard</button></div>
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
    if (el) el.textContent = dur(sleepElapsed(ctx.state.activeSleep, now));
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
  root.addEventListener('change', async e => {
    const input = e.target.closest('input[data-set]');
    if (!input) return;
    const now = Date.now();
    const t = todayAt(input.value, now);
    if (t == null) return;
    if (input.dataset.set === 'sleep-earlier' && ctx.state.activeSleep) {
      const s = bankSleep(ctx.state.activeSleep, now);
      await ctx.setActiveSleep(shiftStart(s, t, 'elapsedSec'));
      toast(`Fell asleep ${time(t)} · ${dur((now - t) / 1000)} ago`);
    } else if (input.dataset.set === 'feed-earlier' && ctx.state.activeFeed) {
      const s = accrue(ctx.state.activeFeed, now);
      const key = (s.beginSide || s.side) === 'LEFT' ? 'leftSec' : 'rightSec';
      await ctx.setActiveFeed(shiftStart(s, t, key));
      toast(`Started ${time(t)} · ${dur((now - t) / 1000)} ago`);
    }
    ctx.refresh();
  });

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
        await ctx.setActiveSleep({ start: now, elapsedSec: 0, running: true, sinceTick: now });
        ctx.refresh();
        break;

      case 'sleep-pause': {
        const s = bankSleep(ctx.state.activeSleep, now);
        await ctx.setActiveSleep({ ...s, running: !normSleep(ctx.state.activeSleep).running, sinceTick: now });
        ctx.refresh();
        break;
      }

      case 'sleep-earlier': {
        const s = bankSleep(ctx.state.activeSleep, now);
        await ctx.setActiveSleep(shiftStart(s, s.start - Number(btn.dataset.min) * 60000, 'elapsedSec'));
        ctx.refresh();
        toast(`Fell asleep ${time(ctx.state.activeSleep.start)} · ${dur((now - ctx.state.activeSleep.start) / 1000)} ago`);
        break;
      }

      case 'feed-earlier': {
        const s = accrue(ctx.state.activeFeed, now);
        const key = (s.beginSide || s.side) === 'LEFT' ? 'leftSec' : 'rightSec';
        await ctx.setActiveFeed(shiftStart(s, s.start - Number(btn.dataset.min) * 60000, key));
        ctx.refresh();
        toast(`Started ${time(ctx.state.activeFeed.start)} · ${dur((now - ctx.state.activeFeed.start) / 1000)} ago`);
        break;
      }

      case 'sleep-wake': {
        const s = bankSleep(ctx.state.activeSleep, now);
        const durationSec = Math.round(s.elapsedSec);
        await db.put(makeEvent(T.SLEEP, {
          start: s.start, end: now, durationSec,
          caregiver: ctx.state.caregiver,
        }));
        await ctx.setActiveSleep(null);
        ctx.refresh();
        toast(`Sleep saved · ${dur(durationSec)}`);
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
