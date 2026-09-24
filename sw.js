// Network-first for everything the app is made of, cache as the offline fallback.
// Cache-first looked faster but meant every deploy left phones on a mix of old
// and new files until the second launch — with a module app that is a broken app.
const CACHE = 'witte-baby-v7';
const SHELL = [
  './', './index.html', './assets/styles.css', './assets/icon.svg',
  './assets/icon-180.png', './assets/icon-192.png', './assets/firebase-config.js',
  './manifest.webmanifest',
  './js/app.js', './js/db.js', './js/ui.js', './js/model.js', './js/format.js',
  './js/csv.js', './js/charts.js', './js/forms.js', './js/sync.js',
  './js/views/home.js', './js/views/log.js', './js/views/stats.js',
  './js/views/growth.js', './js/views/settings.js', './js/views/sync-ui.js',
  './js/sessions.js', './js/avatar.js', './js/push.js', './js/badge.js', './js/growth-fit.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  e.respondWith(
    // GitHub Pages marks files cacheable for 10 minutes; revalidate instead so a
    // deploy is visible on the next launch, not the one after the cache expires.
    fetch(request, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(request, res.clone()));
        return res;
      })
      .catch(() => caches.match(request).then(hit => hit || caches.match('./index.html')))
  );
});

// ---- push notifications (sent by the notify workflow for the other phone) ----
// The icon badge follows the other phone's sleep updates too. The switch in
// More → Notifications is read straight from the app's IndexedDB meta store.
function badgeWanted() {
  return new Promise(res => {
    try {
      const req = indexedDB.open('witte-baby');
      req.onerror = () => res(true);
      req.onsuccess = () => {
        const dbh = req.result;
        if (!dbh.objectStoreNames.contains('meta')) { dbh.close(); return res(true); }
        const q = dbh.transaction('meta').objectStore('meta').get('badgeSleep');
        q.onsuccess = () => { dbh.close(); res(!q.result || q.result.value !== false); };
        q.onerror = () => { dbh.close(); res(true); };
      };
    } catch { res(true); }
  });
}
async function badgeFor(kind) {
  if (!('setAppBadge' in self.navigator)) return;
  try {
    if (kind === 'sleep-end') await self.navigator.clearAppBadge();
    else if (/^sleep-(start|resume|pause)$/.test(kind) && await badgeWanted()) await self.navigator.setAppBadge(1);
  } catch {}
}

self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: 'Witte Baby', body: e.data?.text() || '' }; }
  e.waitUntil(badgeFor(data.kind));
  e.waitUntil(self.registration.showNotification(data.title || 'Witte Baby', {
    body: data.body || '',
    tag: data.kind || 'witte-baby',          // a newer sleep update replaces the older one
    renotify: true,
    icon: './assets/icon-192.png',
    badge: './assets/icon-192.png',
    data: { url: './' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => 'focus' in c);
    return open ? open.focus() : self.clients.openWindow('./');
  }));
});
