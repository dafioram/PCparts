// Offline support: precache the app shell on install, then serve same-origin
// GETs network-first with a cache fallback. Bump CACHE when the file list
// changes.
const CACHE = 'pcparts-v2';
const NETWORK_TIMEOUT_MS = 3000;
// After a failed attempt, skip the network for a while so a dead connection
// costs one timeout per load, not one per file in the module graph.
const NETWORK_RETRY_AFTER_MS = 30000;
let networkDownUntil = 0;

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

// Network first so a deploy shows up on the next load; if the site is
// unreachable, errors, or doesn't answer within NETWORK_TIMEOUT_MS, use the
// cached copy instead.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(request));
});

async function fromCache(cache, request) {
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  return request.mode === 'navigate' ? (await cache.match('index.html')) || Response.error() : Response.error();
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  if (Date.now() < networkDownUntil) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    const res = await fetch(request, { signal: controller.signal });
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    networkDownUntil = Date.now() + NETWORK_RETRY_AFTER_MS;
    return fromCache(cache, request);
  } finally {
    clearTimeout(timer);
  }
}
