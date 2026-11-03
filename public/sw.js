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

// Notifications (Web Push) : le relais envoie un JSON {title, body, tag, url}.
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Ma BMVR', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Ma BMVR', { body: d.body || '', tag: d.tag || undefined, icon: 'icon-192.png', badge: 'icon-192.png', data: { url: d.url || '#accueil' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const hash = (e.notification.data && e.notification.data.url) || '#accueil';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { c.navigate(new URL(hash, self.registration.scope).href).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(new URL(hash, self.registration.scope).href);
  }));
});
