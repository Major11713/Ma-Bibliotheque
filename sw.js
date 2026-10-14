const VERSION = 'ma-bibliotheque-v1.2.0';
const RUNTIME = `${VERSION}-runtime`;

const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=1.2.0',
  './app.js?v=1.2.0',
  './db.js',
  './api.js',
  './bnf.js',
  './enrichment.js',
  './catalog-local.js',
  './scanner.js',
  './manifest.webmanifest',
  './vendor/zxing-browser.min.js?v=1.2.0',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    for (const file of APP_SHELL) {
      const response = await fetch(file, { cache: 'reload' });
      if (!response.ok) throw new Error(`Fichier absent : ${file}`);
      await cache.put(file, response);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith('ma-bibliotheque-') && key !== VERSION && key !== RUNTIME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    if (request.destination === 'image') {
      event.respondWith((async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(RUNTIME);
            await cache.put(request, response.clone());
          }
          return response;
        } catch {
          return new Response('', { status: 503 });
        }
      })());
    }
    return;
  }

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(RUNTIME);
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      return await caches.match(request) ||
        (request.mode === 'navigate' ? await caches.match('./index.html') : Response.error());
    }
  })());
});
