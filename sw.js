/* Service worker minimal : nécessaire pour afficher des notifications sur
   Android (le constructeur Notification() y est interdit aux pages web). */
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({type: 'window', includeUncontrolled: true}).then(list => {
    for (const c of list) {
      if ('focus' in c) { c.focus(); c.postMessage({open: 'checkin'}); return; }
    }
    return clients.openWindow('./');
  }));
});
