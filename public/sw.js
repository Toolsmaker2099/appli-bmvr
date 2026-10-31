// __VERSION__ est remplacé automatiquement par le numéro du commit à la publication (voir .github/workflows/pages.yml).
const CACHE = 'bmvr-__VERSION__';
const SHELL = ['./', 'app.js?v=__VERSION__', 'style.css?v=__VERSION__', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));

// Réseau d'abord pour la coquille de l'appli, cache en secours (hors ligne). Les appels au relais ne sont jamais mis en cache.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((r) => { caches.open(CACHE).then((c) => c.put(e.request, r.clone())); return r; }).catch(() => caches.match(e.request)));
});
