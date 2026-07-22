/* Service worker : affiche les notifications locales (Android interdit
   new Notification() aux pages web), reçoit les push du relais distant
   (appli fermée / écran éteint), et sert l'appli hors-ligne — ce dernier
   point est aussi un critère d'installabilité (WebAPK) sur Android. */
const CACHE = 'devenir-shell-v1';
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // laisse passer les appels au relais push, non interceptés
  e.respondWith((async () => {
    try {
      const fresh = await fetch(e.request);
      const cache = await caches.open(CACHE);
      cache.put(e.request, fresh.clone());
      return fresh;
    } catch (err) {
      return (await caches.match(e.request)) || (await caches.match('./index.html'));
    }
  })());
});
self.addEventListener('push', e => {
  let data = { title: 'Devenir', body: 'Cette dernière heure ?' };
  try { if (e.data) data = e.data.json(); } catch (err) {}
  e.waitUntil(self.registration.showNotification(data.title || 'Devenir', {
    body: data.body || '', tag: 'devenir', icon: 'icon-192.png', badge: 'icon-192.png'
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({type: 'window', includeUncontrolled: true}).then(list => {
    for (const c of list) {
      if ('focus' in c) { c.focus(); c.postMessage({open: 'checkin'}); return; }
    }
    return clients.openWindow('./');
  }));
});
