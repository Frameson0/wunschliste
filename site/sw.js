// Minimaler Service Worker: macht Wichteln als App installierbar (Teilen-Menü unter Android)
// und hält die Seite selbst für schlechten Empfang bereit. API-Aufrufe gehen immer ins Netz.
const CACHE = 'wichteln-v2';
const SHELL = ['./', 'favicon.svg', 'icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // Die Testversion unter /test/ nie anfassen
  if (url.pathname.includes('/test/')) return;
  // Immer zuerst das Netz (damit Updates sofort ankommen), bei Funkloch der Zwischenspeicher
  e.respondWith(
    fetch(req, { cache: 'no-cache' }) // beim Server nachfragen, ob es eine neue Version gibt
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(url.pathname.endsWith('/') ? './' : req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./'))),
  );
});
