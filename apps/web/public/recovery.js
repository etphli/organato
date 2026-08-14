/* global caches, navigator, window */

window.__organatoRecovery = (async () => {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations.map((registration) => registration.unregister()),
  );
  if ("caches" in window) {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((name) => name.startsWith("organato-shell-"))
        .map((name) => caches.delete(name)),
    );
  }
})().catch(() => undefined);
