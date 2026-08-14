self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        const localHostnames = new Set(["localhost", "127.0.0.1", "::1"]);
        const isLocal = localHostnames.has(self.location.hostname);
        return Promise.all(
          keys
            .filter((key) => !isLocal || key.startsWith("organato-shell-"))
            .map((key) => caches.delete(key)),
        );
      })
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll({ type: "window" }))
      .then((clients) =>
        Promise.all(clients.map((client) => client.navigate(client.url))),
      ),
  );
});
