const VERSION = 'ma-bibliotheque-v1.4.0';
const RUNTIME = `${VERSION}-runtime`;
const COVERS = 'ma-bibliotheque-covers-v1';

const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=1.4.0',
  './app.js?v=1.4.0',
  './db.js',
  './isbn.js',
  './backup.js',
  './api.js',
  './bnf.js',
  './enrichment.js',
  './scanner.js',
  './identity.js',
  './cover-search.js',
  './vendor/ocr/tesseract.min.js',
  './manifest.webmanifest',
  './vendor/zxing-browser.min.js?v=1.4.0',
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
      .filter((key) => key.startsWith('ma-bibliotheque-') && key !== VERSION && key !== RUNTIME && key !== COVERS)
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
          if (response.ok || response.type === 'opaque') {
            try {
              const cache = await caches.open(COVERS);
              await cache.put(request, response.clone());
            } catch { /* Le réseau reste utilisable si le stockage est plein. */ }
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
        try {
          const cache = await caches.open(RUNTIME);
          await cache.put(request, response.clone());
        } catch { /* Ne pas masquer une réponse réseau valide. */ }
      }
      if (!response.ok) {
        const cached = await caches.match(request);
        if (cached) return cached;
      }
      return response;
    } catch {
      return await caches.match(request) ||
        (request.mode === 'navigate' ? await caches.match('./index.html') : Response.error());
    }
  })());
});
