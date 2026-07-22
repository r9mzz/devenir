/* Service worker : affiche les notifications locales (Android interdit
   new Notification() aux pages web) ET reçoit les push envoyés par le
   relais distant, y compris appli fermée / écran éteint. */
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
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
