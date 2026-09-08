/**
 * Service-worker registration with a user-driven update flow: a waiting
 * worker never takes over until the user accepts via PwaUpdateNotice.
 */
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  if (
    window.location.hostname !== "localhost" &&
    window.location.hostname !== "127.0.0.1" &&
    window.location.protocol !== "https:"
  ) {
    return;
  }
  const announce = (registration: ServiceWorkerRegistration) => {
    window.dispatchEvent(
      new CustomEvent("organato-sw-update", { detail: registration }),
    );
  };
  void navigator.serviceWorker
    .register("/sw.js")
    .then((registration) => {
      if (registration.waiting) announce(registration);
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (
            worker.state === "installed" &&
            navigator.serviceWorker.controller
          ) {
            announce(registration);
          }
        });
      });
    })
    .catch(() => undefined);
}

export function applyServiceWorkerUpdate(
  registration: ServiceWorkerRegistration,
): void {
  registration.waiting?.postMessage("SKIP_WAITING");
}
