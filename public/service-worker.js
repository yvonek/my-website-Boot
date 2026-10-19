self.addEventListener('push', (event) => {
  if (!event.data) return;
  event.waitUntil((async () => {
    let notification;
    try { notification = event.data.json(); }
    catch { notification = { title: 'TomatoHub', body: event.data.text() }; }

    const openClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (openClients.some((client) => client.visibilityState === 'visible')) return;

    await self.registration.showNotification(notification.title || 'TomatoHub', {
      body: notification.body || 'There is new activity in your account.',
      tag: notification.tag,
      data: { url: notification.url || '/' },
      renotify: true,
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const destination = new URL(event.notification.data?.url || '/', self.location.origin).href;
    const openClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of openClients) {
      if ('focus' in client) {
        await client.navigate(destination);
        return client.focus();
      }
    }
    return self.clients.openWindow(destination);
  })());
});
