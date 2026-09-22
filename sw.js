// Cache-first shell so the app opens offline; the network refreshes it in the background.
const CACHE = 'witte-baby-v1';
const SHELL = [
  './', './index.html', './assets/styles.css', './assets/icon.svg',
  './manifest.webmanifest',
  './js/app.js', './js/db.js', './js/ui.js', './js/model.js', './js/format.js',
  './js/csv.js', './js/charts.js', './js/forms.js',
  './js/views/home.js', './js/views/log.js', './js/views/stats.js',
  './js/views/growth.js', './js/views/settings.js',
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
    caches.match(request).then(hit => {
      const net = fetch(request).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(request, res.clone()));
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
