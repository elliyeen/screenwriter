// Offline support: keeps the app itself on the device so it opens with no internet.
// Scripts are not handled here. They live in the browser's storage and sync when online.
const CACHE = 'screenwriter-0.6.0';
const SHELL = ['/', '/style.css', '/manifest.webmanifest', '/icons/icon-192.png',
  '/js/app.js', '/js/fountain.js', '/js/layout.js', '/js/pdf.js', '/js/sample.js', '/js/cloud.js', '/js/live.js', '/js/ot.js',
  '/js/importer.js', '/js/feedback.js', '/js/folder.js', '/js/zip.js',
  '/fonts/courier-prime-latin-400-normal.woff2', '/fonts/courier-prime-latin-700-normal.woff2',
  '/fonts/courier-prime-latin-400-italic.woff2', '/fonts/courier-prime-latin-700-italic.woff2',
  '/fonts/inter-latin-400-normal.woff2', '/fonts/inter-latin-500-normal.woff2', '/fonts/inter-latin-600-normal.woff2'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Network first so a new version shows up right away; fall back to the saved copy when offline.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    } catch {
      return (await cache.match(e.request)) || (e.request.mode === 'navigate' ? await cache.match('/') : null) || Response.error();
    }
  })());
});
