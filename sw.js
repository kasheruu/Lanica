// sw.js - Lanica Service Worker for Background Web Push & Notification Handling
const CACHE_NAME = "lanica-sw-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Handle user clicking on a desktop/mobile push notification banner
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || "/admin.html";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      // If a window is already open, focus it
      for (const client of windowClients) {
        if (client.url.includes(targetUrl) && "focus" in client) {
          return client.focus();
        }
      }
      // If any Lanica window is open, focus and navigate it
      for (const client of windowClients) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

// Optional standard push event handler
self.addEventListener("push", (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const title = data.title || "Lanica Notification";
    const options = {
      body: data.body || "",
      icon: data.icon || "/assets/logo.png",
      badge: data.badge || "/assets/logo.png",
      tag: data.tag || "lanica-general",
      data: {
        url: data.url || "/admin.html",
      },
    };

    event.waitUntil(self.registration.showNotification(title, options));
  } catch (e) {
    const text = event.data.text();
    event.waitUntil(
      self.registration.showNotification("Lanica Furniture", {
        body: text,
        icon: "/assets/logo.png",
      })
    );
  }
});
