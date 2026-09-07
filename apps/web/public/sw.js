const cacheName = "organato-shell-__ORGANATO_BUILD_ID__";
const shell = ["__ORGANATO_PRECACHE__"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(shell)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        const olderOrganatoCaches = keys.filter(
          (key) => key.startsWith("organato-shell-") && key !== cacheName,
        );
        return Promise.all(
          olderOrganatoCaches
            .slice(0, Math.max(0, olderOrganatoCaches.length - 2))
            .map((key) => caches.delete(key)),
        );
      })
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  )
    return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(
              caches.open(cacheName).then((cache) => cache.put("/", copy)),
            );
          }
          return response;
        })
        .catch(() => caches.open(cacheName).then((cache) => cache.match("/"))),
    );
    return;
  }

  const isAppCode =
    event.request.destination === "script" ||
    event.request.destination === "style";
  if (isAppCode) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(
              caches
                .open(cacheName)
                .then((cache) => cache.put(event.request, copy)),
            );
          }
          return response;
        })
        .catch(() => caches.match(event.request)),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ??
        fetch(event.request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(
              caches
                .open(cacheName)
                .then((cache) => cache.put(event.request, copy)),
            );
          }
          return response;
        }),
    ),
  );
});
