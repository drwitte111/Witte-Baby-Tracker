// Boot, shared state, hash router, one-second ticker.
import { db } from './db.js';
import { initTooltips, toast } from './ui.js';
import { ageFrom } from './format.js';

import * as home from './views/home.js';
import * as log from './views/log.js';
import * as stats from './views/stats.js';
import * as growth from './views/growth.js';
import * as settings from './views/settings.js';

const ROUTES = { home, log, stats, growth, settings };
const DEFAULT_UNITS = { weight: 'lb', length: 'in', volume: 'oz' };

const state = {
  profile: null,
  units: { ...DEFAULT_UNITS },
  caregiver: '',
  activeFeed: null,
  activeSleep: null,
};

let tickHandlers = [];
let rendering = false;

const ctx = {
  state,
  refresh: () => renderRoute(currentRoute()),
  go(route) { location.hash = `#/${route}`; },
  onTick(fn) { tickHandlers.push(fn); },

  async setActiveFeed(v) { state.activeFeed = v; await db.metaSet('activeFeed', v); syncWakeLock(); },
  async setActiveSleep(v) { state.activeSleep = v; await db.metaSet('activeSleep', v); },
  async setProfile(v) { state.profile = v; await db.metaSet('profile', v); paintHeader(); },
  async setUnits(v) { state.units = v; await db.metaSet('units', v); ctx.refresh(); },
  async setCaregiver(v) { state.caregiver = v; await db.metaSet('caregiver', v); },
};

// Keep the screen on while a feed timer runs (but never through a night's sleep).
let wakeLock = null;
async function syncWakeLock() {
  const want = !!state.activeFeed?.running;
  try {
    if (want && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!want && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* denied or unsupported: not worth telling anyone about */ }
}

function currentRoute() {
  const r = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
  return ROUTES[r] ? r : 'home';
}

function paintHeader() {
  document.getElementById('profile-name').textContent = state.profile?.name || 'Baby Tracker';
  document.getElementById('profile-age').textContent = ageFrom(state.profile?.birth);
}

async function renderRoute(route) {
  if (rendering) return;
  rendering = true;
  try {
    tickHandlers = [];
    const view = document.getElementById('view');
    // A fresh node drops every listener the previous view attached.
    const fresh = document.createElement('main');
    fresh.id = 'view'; fresh.className = 'view'; fresh.tabIndex = -1;
    view.replaceWith(fresh);
    document.querySelectorAll('.tab').forEach(t =>
      t.setAttribute('aria-selected', String(t.dataset.route === route)));
    await ROUTES[route].render(fresh, ctx);
  } catch (err) {
    console.error(err);
    toast('Something went wrong — see the console');
  } finally {
    rendering = false;
  }
}

function startTicker() {
  let last = 0;
  const loop = ts => {
    if (ts - last > 1000) {
      last = ts;
      if (document.visibilityState === 'visible') tickHandlers.forEach(fn => { try { fn(); } catch {} });
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved) document.documentElement.dataset.theme = saved;
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme
      || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
  });
}

async function boot() {
  initTheme();
  initTooltips();

  const [profile, units, caregiver, activeFeed, activeSleep] = await Promise.all([
    db.metaGet('profile', null),
    db.metaGet('units', DEFAULT_UNITS),
    db.metaGet('caregiver', ''),
    db.metaGet('activeFeed', null),
    db.metaGet('activeSleep', null),
  ]);
  state.profile = profile;
  state.units = { ...DEFAULT_UNITS, ...units };
  state.caregiver = caregiver;
  state.activeFeed = activeFeed;
  state.activeSleep = activeSleep;

  paintHeader();

  document.querySelectorAll('.tab').forEach(tab =>
    tab.addEventListener('click', () => ctx.go(tab.dataset.route)));
  addEventListener('hashchange', () => renderRoute(currentRoute()));
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { syncWakeLock(); renderRoute(currentRoute()); }
  });

  startTicker();
  syncWakeLock();
  await renderRoute(currentRoute());

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: './' })
      .catch(err => console.warn('Service worker not registered:', err));
  }
}

boot();
