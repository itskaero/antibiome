// Clean-up worker. The old NICU web app used to live at this address and installed a
// cache-first service worker here. Browsers fetch this file as its update: it removes the old
// caches, unregisters itself and reloads open pages so they show the current site.
// The old app itself now runs from /legacy/ with its own worker and cache.
const OLD_CACHES = ['antibiome-v1', 'antibiome-v2', 'antibiome-v3', 'antibiome-v4'];

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await Promise.all(OLD_CACHES.map(name => caches.delete(name)));
    await self.registration.unregister();
    const pages = await self.clients.matchAll({ type: 'window' });
    pages.forEach(page => page.navigate(page.url));
  })());
});
