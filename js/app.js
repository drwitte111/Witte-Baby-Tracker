// Boot, shared state, hash router, one-second ticker.
import { db } from './db.js';
import { initTooltips, toast } from './ui.js';
import { ageFrom } from './format.js';
import { init as initSync, attachLocalPusher, markMetaDirty } from './sync.js';

import * as home from './views/home.js';
import * as log from './views/log.js';
import * as stats from './views/stats.js';
import * as growth from './views/growth.js';
import * as settings from './views/settings.js';

const ROUTES = { home, log, stats, growth, settings };
const DEFAULT_UNITS = { weight: 'lb', length: 'in', volume: 'oz' };

const state = {
  profiles: [],          // every baby this family tracks
  current: null,         // id of the one every screen shows
  profile: null,         // the current baby's record (derived)
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

  async setActiveFeed(v) { state.activeFeed = v; await db.metaSet('activeFeed', v); await markMetaDirty('activeFeed'); syncWakeLock(); },
  async setActiveSleep(v) { state.activeSleep = v; await db.metaSet('activeSleep', v); await markMetaDirty('activeSleep'); },
  /** Update (or add) one baby's record. */
  async saveProfile(p) {
    const list = state.profiles.slice();
    const i = list.findIndex(x => x.id === p.id);
    if (i >= 0) list[i] = { ...list[i], ...p }; else list.push(p);
    await setProfiles(list);
    if (!state.current) await ctx.selectProfile(p.id);
    else applyScope();
  },
  /** Switch every screen (on every phone) to this baby. */
  async selectProfile(id) {
    if (!state.profiles.some(p => p.id === id)) return;
    state.current = id;
    await db.metaSet('current', id);
    await markMetaDirty('current');
    applyScope();
    ctx.refresh();
  },
  async addProfile(p) {
    const rec = { id: p.id || newProfileId(), name: p.name || 'Baby', birth: p.birth || null, sex: p.sex || '' };
    await ctx.saveProfile(rec);
    return rec;
  },
  async setUnits(v) { state.units = v; await db.metaSet('units', v); await markMetaDirty('units'); ctx.refresh(); },
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

function newProfileId() {
  return 'p-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

async function setProfiles(list) {
  state.profiles = list;
  await db.metaSet('profiles', list);
  await markMetaDirty('profiles');
}

// Point the data layer at the current baby and refresh the derived record.
function applyScope() {
  const primary = state.profiles[0]?.id || null;
  if (!state.current || !state.profiles.some(p => p.id === state.current)) state.current = primary;
  state.profile = state.profiles.find(p => p.id === state.current) || null;
  db.setScope(state.current, primary);
  paintHeader();
}

// One-time move from the single `profile` record to the roster.
async function migrateProfiles(profiles, legacy) {
  if (profiles && profiles.length) return profiles;
  if (!legacy) return [];
  const rec = { id: legacy.profileKey || newProfileId(), name: legacy.name || 'Baby', birth: legacy.birth || null, sex: legacy.sex || '' };
  await db.metaSet('profiles', [rec]);
  await markMetaDirty('profiles');
  return [rec];
}

function paintHeader() {
  const name = state.profile?.name || '';
  document.getElementById('profile-name').textContent = name || 'Baby Tracker';
  document.getElementById('profile-age').textContent = ageFrom(state.profile?.birth);
  document.getElementById('profile-avatar').textContent = (name.trim()[0] || '•').toUpperCase();
}

async function paintRoute(route) {
  tickHandlers = [];
  const view = document.getElementById('view');
  // A fresh node drops every listener the previous view attached.
  const fresh = document.createElement('main');
  fresh.id = 'view'; fresh.className = 'view'; fresh.tabIndex = -1;
  view.replaceWith(fresh);
  document.querySelectorAll('.tab').forEach(t =>
    t.setAttribute('aria-selected', String(t.dataset.route === route)));
  await ROUTES[route].render(fresh, ctx);
  maybeShowInstallHint(fresh, route);
}

async function renderRoute(route) {
  if (rendering) return;
  rendering = true;
  try {
    const smooth = document.startViewTransition
      && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (smooth) await document.startViewTransition(() => paintRoute(route)).finished;
    else await paintRoute(route);
  } catch (err) {
    console.error(err);
    toast('Something went wrong — see the console');
  } finally {
    rendering = false;
  }
}

// iOS has no install prompt, so say it once, on the Home screen, dismissibly.
function maybeShowInstallHint(root, route) {
  if (route !== 'home') return;
  const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = navigator.standalone === true
    || matchMedia('(display-mode: standalone)').matches;
  if (!iOS || standalone || localStorage.getItem('installHintDismissed')) return;
  const hint = document.createElement('div');
  hint.className = 'install-hint';
  hint.innerHTML = `<span class="chip-ico sm tone-accent"><svg class="ico"><use href="#i-share"/></svg></span>
    <span><b>Add to Home Screen</b> — tap Share, then “Add to Home Screen”. It runs full screen,
    works offline, and keeps its data safely.</span>
    <button type="button" aria-label="Dismiss"><svg class="ico sm"><use href="#i-close"/></svg></button>`;
  hint.querySelector('button').addEventListener('click', () => {
    localStorage.setItem('installHintDismissed', '1');
    hint.remove();
  });
  root.prepend(hint);
}

// Keep the chrome clear of the on-screen keyboard (iOS resizes the visual viewport).
function initKeyboardAware() {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    const overlap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb', `${Math.round(overlap)}px`);
    document.body.classList.toggle('kb-open', overlap > 120);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
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

// Profile and units can change on the other device too.
async function reloadSharedState() {
  const [profiles, current, units, activeFeed, activeSleep] = await Promise.all([
    db.metaGet('profiles', state.profiles),
    db.metaGet('current', state.current),
    db.metaGet('units', state.units),
    db.metaGet('activeFeed', state.activeFeed),
    db.metaGet('activeSleep', state.activeSleep),
  ]);
  state.profiles = profiles || [];
  state.current = current;
  state.units = { ...DEFAULT_UNITS, ...units };
  state.activeFeed = activeFeed;
  state.activeSleep = activeSleep;
  syncWakeLock();
  applyScope();
}

async function boot() {
  initTheme();
  initTooltips();
  initKeyboardAware();

  const [profiles, current, legacyProfile, units, caregiver, activeFeed, activeSleep] = await Promise.all([
    db.metaGet('profiles', []),
    db.metaGet('current', null),
    db.metaGet('profile', null),
    db.metaGet('units', DEFAULT_UNITS),
    db.metaGet('caregiver', ''),
    db.metaGet('activeFeed', null),
    db.metaGet('activeSleep', null),
  ]);
  state.profiles = await migrateProfiles(profiles, legacyProfile);
  state.current = current;
  state.units = { ...DEFAULT_UNITS, ...units };
  state.caregiver = caregiver;
  state.activeFeed = activeFeed;
  state.activeSleep = activeSleep;

  applyScope();

  document.querySelectorAll('.tab').forEach(tab =>
    tab.addEventListener('click', () => ctx.go(tab.dataset.route)));
  addEventListener('hashchange', () => renderRoute(currentRoute()));
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { syncWakeLock(); renderRoute(currentRoute()); }
  });

  startTicker();
  syncWakeLock();
  await renderRoute(currentRoute());

  // Rows arriving from the other caregiver's phone repaint the current screen.
  let remoteRepaint;
  db.onChange(reason => {
    if (reason !== 'remote') return;
    clearTimeout(remoteRepaint);
    remoteRepaint = setTimeout(async () => {
      await reloadSharedState();
      renderRoute(currentRoute());
    }, 250);
  });
  attachLocalPusher();
  initSync();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // A new worker taking over means new files are live; reload once to match them
    // (never mid-timer: running sessions are persisted, so nothing is lost).
    let hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) location.reload();
      hadController = true;
    });
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: './' })
      .catch(err => console.warn('Service worker not registered:', err));
  }
}

boot();
