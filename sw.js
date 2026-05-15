const CACHE = 'studypath-v3';
const SHELL = ['/', '/index.html', '/manifest.json', '/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  // Always fetch fresh: JS, CSS, API calls
  if (url.includes('.js') || url.includes('.css') ||
      url.includes('googleapis.com') || url.includes('groq.com') ||
      url.includes('wikipedia.org')) return;
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
