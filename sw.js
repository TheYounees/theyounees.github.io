/* JARVIS service worker — yalnız tətbiq qabığını keşləyir.
   API sorğuları heç vaxt keşlənmir, şəxsi məlumat diskə yazılmır. */
const CACHE = 'jarvis-shell-v4';
const SHELL = [
  './',
  './index.html',
  './assets/styles.css',
  './assets/icon.svg',
  './manifest.webmanifest',
  './assets/js/app.js',
  './assets/js/config.js',
  './assets/js/store.js',
  './assets/js/llm.js',
  './assets/js/tools.js',
  './assets/js/voice.js',
  './assets/js/ui.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Şəbəkə-öncəlli: yeniləmələr dərhal görünür, internet yoxdursa keş işləyir.
  // `cache: 'no-cache'` brauzerin 10 dəqiqəlik HTTP keşini keçib serverlə yoxlayır (ETag → 304).
  event.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        const shell = await caches.match('./index.html');
        return shell || new Response('Oflayn rejimdə bu resurs mövcud deyil.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      })
  );
});
