// Reminders: imported into the generated service worker (vite.config.ts). Shows the notifications the
// server pushes ({ title, tag }) and brings the app to the front, or opens it, when one is tapped.

self.addEventListener("push", (event) => {
  let message = { title: "A note is due", tag: undefined };
  try {
    if (event.data) message = event.data.json();
  } catch {
    // Not JSON: show the general text.
  }
  event.waitUntil(
    self.registration.showNotification(message.title, {
      // A second reminder for the same note replaces the first, and still alerts.
      tag: message.tag,
      renotify: message.tag !== undefined,
      icon: "/icons/icon-192.png",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows[0];
      if (open) return open.focus();
      return self.clients.openWindow("/");
    })(),
  );
});
