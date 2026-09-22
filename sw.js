// Network-first for everything the app is made of, cache as the offline fallback.
// Cache-first looked faster but meant every deploy left phones on a mix of old
// and new files until the second launch — with a module app that is a broken app.
const CACHE = 'witte-baby-v5';
const SHELL = [
  './', './index.html', './assets/styles.css', './assets/icon.svg',
  './assets/icon-180.png', './assets/icon-192.png', './assets/firebase-config.js',
  './manifest.webmanifest',
  './js/app.js', './js/db.js', './js/ui.js', './js/model.js', './js/format.js',
  './js/csv.js', './js/charts.js', './js/forms.js', './js/sync.js',
  './js/views/home.js', './js/views/log.js', './js/views/stats.js',
  './js/views/growth.js', './js/views/settings.js', './js/views/sync-ui.js',
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
