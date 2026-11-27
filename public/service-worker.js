// SAYC service worker: keeps the app itself available offline. Data never goes through the cache,
// so sales, stock and sign-ins always reach the server (or the on-device database) as they are.

// Change the version to drop every cached file when a release needs a clean start.
const CACHE_PREFIX = 'sayc-';
const CACHE_NAME = `${CACHE_PREFIX}v1`;

// The app shell. The build gives scripts and styles hashed names, so those are cached as they load
// (and the router preloads every page right after start-up, so one visit caches them all).
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-192.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/assets/icon/favicon.png',
  '/assets/ensavoirplus.gif',
  '/assets/i18n/es.json',
  '/assets/i18n/en.json',
  '/assets/i18n/fr.json',
  // The on-device database engine, needed to work without a server.
  '/assets/sqljs/sql-wasm-browser.wasm',
];

// Install: store the app shell, and take over without waiting for old tabs to close.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// Activate: delete caches from earlier versions and control the open tabs.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

/** Requests that must always go to the network: the API, and anything the app asks another site for. */
function isData(url) {
  return url.origin !== self.location.origin || url.pathname.startsWith('/api/');
}

/** Saves a good same-origin response for later; errors and partial responses are not kept. */
function remember(request, response) {
  if (response && response.ok && response.type === 'basic' && response.status === 200) {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (isData(url)) return;

  // Pages: the network first, so a new release shows as soon as it is online. Offline, every route
  // gets index.html, and the app's router shows the page asked for.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => remember('/index.html', response))
        .catch(() => caches.match('/index.html').then((cached) => cached || Response.error()))
    );
    return;
  }

  // Scripts, styles, icons and translations: answer from the cache at once and refresh it behind the
  // scenes, so the next start has the latest copy.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => remember(request, response))
        .catch(() => cached || Response.error());
      if (cached) {
        event.waitUntil(network.catch(() => undefined));
        return cached;
      }
      return network;
    })
  );
});
