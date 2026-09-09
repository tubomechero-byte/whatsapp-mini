self.addEventListener('push', (event) => {
    let data = {};

    try {
        data = event.data ? event.data.json() : {};
    } catch {
        data = {
            title: 'Mini WhatsApp',
            body: event.data ? event.data.text() : 'Tienes un mensaje nuevo.'
        };
    }

    event.waitUntil(
        self.registration.showNotification(
            data.title || 'Mini WhatsApp',
            {
                body: data.body || 'Tienes un mensaje nuevo.',
                tag: 'mini-whatsapp-message',
                renotify: true,
                data: {
                    url: data.url || '/'
                }
            }
        )
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const url = event.notification.data?.url || '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if ('focus' in client) {
                    return client.focus();
                }
            }

            if (clients.openWindow) {
                return clients.openWindow(url);
            }
        })
    );
});
