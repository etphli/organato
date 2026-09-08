import { useEffect, useState } from "react";
import { applyServiceWorkerUpdate } from "../sw-register";

/**
 * "Reload latest" notice shown when a new service worker is waiting.
 * Wires the existing .pwa-update-notice styles that previously had no owner.
 */
export function PwaUpdateNotice() {
  const [registration, setRegistration] =
    useState<ServiceWorkerRegistration | null>(null);
  useEffect(() => {
    const onUpdate = (event: Event) => {
      setRegistration(
        (event as CustomEvent<ServiceWorkerRegistration>).detail ?? null,
      );
    };
    window.addEventListener("organato-sw-update", onUpdate);
    return () => window.removeEventListener("organato-sw-update", onUpdate);
  }, []);
  if (!registration) return null;
  return (
    <div className="pwa-update-notice" role="status">
      <span>A newer Organato is ready.</span>
      <button
        type="button"
        onClick={() => {
          applyServiceWorkerUpdate(registration);
          window.location.reload();
        }}
      >
        Reload latest
      </button>
      <button type="button" onClick={() => setRegistration(null)}>
        Later
      </button>
    </div>
  );
}
