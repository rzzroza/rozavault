const CACHE_NAME = 'roza-vault-v3';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/encrypt.js',
  './js/vault.js',
  './lib/argon2-browser.min.js',
  './lib/qrcode.min.js',
  './lib/jsQR.js'
];
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});