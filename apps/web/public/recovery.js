window.__organatoRecovery = (async () => {
  if (!("serviceWorker" in navigator)) return true;
  const hadController = navigator.serviceWorker.controller !== null;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations.map((registration) => registration.unregister()),
  );
  if ("caches" in window) {
    const cacheNames = await caches.keys();
    const localHostnames = new Set(["localhost", "127.0.0.1", "::1"]);
    const isLocal = localHostnames.has(window.location.hostname);
    await Promise.all(
      cacheNames
        .filter((name) => !isLocal || name.startsWith("organato-shell-"))
        .map((name) => caches.delete(name)),
    );
  }
  const reloadKey = "organato:standalone-recovery-v1";
  if (hadController && sessionStorage.getItem(reloadKey) !== "true") {
    sessionStorage.setItem(reloadKey, "true");
    window.location.reload();
    return false;
  }
  return true;
})().catch(() => true);
