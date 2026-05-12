// ∴ The Hermetic Path — Service Worker ∴
//
// Strategy: app-shell precache + network-first for dynamic API.
// The shell is just "/" — everything else is fetched live so content
// stays fresh and users on different devices see the same data.

const CACHE_VERSION = "hp-v1";
const SHELL_URLS = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_URLS)).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Never cache API calls — always go to network.
  if (url.pathname.startsWith("/api/")) return;

  // Network-first for the shell so updates appear instantly.
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/manifest.webmanifest")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req)),
    );
  }
});

// ----- Notifications -------------------------------------------------------
// The Web Notifications API requires user permission. The app schedules
// local notifications client-side via setTimeout; the SW just renders them.

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
    }),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "show-notification") {
    const { title, body, tag } = event.data;
    self.registration.showNotification(title || "Hermetic Path", {
      body: body || "",
      tag: tag || "hermetic",
      icon: "/manifest.webmanifest",
      badge: "/manifest.webmanifest",
      silent: false,
    });
  }
});
