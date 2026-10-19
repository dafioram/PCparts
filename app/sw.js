// Offline support: precache the app shell on install, then serve same-origin
// GETs from cache while refreshing them in the background. Bump CACHE when
// the file list changes.
const CACHE = 'pcparts-v1';

const SHELL = [
  './',
  'index.html',
  'styles.css',
  'icons.svg',
  'js/main.js',
  'js/io.js',
  'js/model.js',
  'js/schema.js',
  'js/storage.js',
  'js/ui/actions.js',
  'js/ui/components.js',
  'js/ui/dom.js',
  'js/ui/forms.js',
  'js/ui/modal.js',
  'js/ui/nav.js',
  'js/ui/prefs.js',
  'js/ui/selection.js',
  'js/ui/store.js',
  'js/ui/toast.js',
  'js/ui/views/boxDetail.js',
  'js/ui/views/boxes.js',
  'js/ui/views/data.js',
  'js/ui/views/graveyard.js',
  'js/ui/views/machineDetail.js',
  'js/ui/views/machines.js',
  'js/ui/views/partDetail.js',
  'js/ui/views/parts.js',
  'js/ui/views/search.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      const refresh = fetch(request)
        .then((res) => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) {
        event.waitUntil(refresh);
        return cached;
      }
      return (await refresh) || (request.mode === 'navigate' ? cache.match('index.html') : Response.error());
    }),
  );
});
