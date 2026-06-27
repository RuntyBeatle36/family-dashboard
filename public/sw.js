const CACHE = 'dashboard-v3';

// On install, skip waiting immediately — no pre-caching stale files
self.addEventListener('install', e => {
  e.waitUntil(self.skipWaiting());
});

// On activate, delete ALL old caches and claim clients right away
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for everything on this host; cache is offline-only fallback
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Pass external requests (weather API) straight through — never cache
  if (url.hostname !== location.hostname) {
    e.respondWith(fetch(e.request));
    return;
  }

  // API calls: network only, no cache
  if (url.pathname.startsWith('/api')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Shell assets: network-first, cache as offline fallback only
  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Stash a fresh copy so offline still works
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
