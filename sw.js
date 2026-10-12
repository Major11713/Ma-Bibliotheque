
const VERSION = 'ma-bibliotheque-v1.0.2-b9';
const RUNTIME = VERSION + '-runtime';

const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=1.0.0-b7',
  './app.js?v=1.0.0-b7',
  './db.js',
  './api.js',
  './scanner.js',
  './manifest.webmanifest',
  './vendor/zxing-browser.min.js?v=1.0.0-b7',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);

    for (const file of APP_SHELL) {
      const response = await fetch(file, {
        cache: 'reload'
      });

      if (!response.ok) {
        throw new Error('Fichier absent : ' + file);
      }

      await cache.put(file, response);
    }

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();

    await Promise.all(keys
      .filter(key =>
        key.startsWith('ma-bibliotheque-') &&
        key !== VERSION &&
        key !== RUNTIME
      )
      .map(key => caches.delete(key))
    );

    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;

  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Les API externes gèrent leurs propres erreurs.
  if (url.origin !== self.location.origin) {
    if (req.destination === 'image') {
      event.respondWith((async () => {
        const cached = await caches.match(req);
        if (cached) return cached;

        const response = await fetch(req);

        if (response.ok) {
          const cache = await caches.open(RUNTIME);
          await cache.put(req, response.clone());
        }

        return response;
      })());
    }
    return;
  }

  // Navigation et scripts : priorité à la version récente.
  event.respondWith((async () => {
    try {
      const response = await fetch(req);

      if (response.ok) {
        const cache = await caches.open(RUNTIME);
        await cache.put(req, response.clone());
      }

      return response;
    } catch {
      return (
        await caches.match(req) ||
        (req.mode === 'navigate'
          ? await caches.match('./index.html')
          : Response.error())
      );
    }
  })());
});
