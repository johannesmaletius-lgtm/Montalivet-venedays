/* Service Worker – macht den Campingplatz offline spielbar.
 * Strategie: Cache zuerst, im Hintergrund aktualisieren (stale-while-revalidate).
 * Bei Änderungen an den Dateien VERSION erhöhen, damit alte Caches gelöscht werden. */
const VERSION = 'camping-v1.3.0';
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'data.js',
  'game.js',
  'render.js',
  'art-late.js',
  'actions.js',
  'ui.js',
  'manifest.json',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  const network = fetch(req).then(res => {
    if (res && res.ok) {
      const copy = res.clone();
      caches.open(VERSION).then(cache => cache.put(req, copy));
    }
    return res;
  });
  event.waitUntil(network.then(() => {}, () => {}));

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => {
      if (hit) return hit;
      return network.catch(() => (req.mode === 'navigate' ? caches.match('index.html') : Response.error()));
    })
  );
});
