import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AuthGate } from "./components/AuthGate";
import { OrganatoProvider } from "./state/OrganatoProvider";
import "./styles.css";
import "./polish.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});
let serviceWorkerRefreshStarted = false;
const serviceWorkerReloadKey = "organato:last-service-worker-reload";

async function prepareServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (import.meta.env.DEV) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations.map((registration) => registration.unregister()),
    );
    return;
  }
  const hadController = navigator.serviceWorker.controller !== null;
  navigator.serviceWorker.addEventListener(
    "controllerchange",
    () => {
      if (hadController) {
        const now = Date.now();
        const lastReload = Number(
          sessionStorage.getItem(serviceWorkerReloadKey) ?? "0",
        );
        if (now - lastReload > 30_000) {
          sessionStorage.setItem(serviceWorkerReloadKey, String(now));
          window.location.reload();
          return;
        }
        window.dispatchEvent(new Event("organato:pwa-update"));
      }
    },
    { once: true },
  );
  const registration = await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
  await registration.update();
  if (serviceWorkerRefreshStarted) return;
  serviceWorkerRefreshStarted = true;
  const checkForUpdate = () => {
    if (document.visibilityState === "visible") {
      void registration.update().catch(() => undefined);
    }
  };
  document.addEventListener("visibilitychange", checkForUpdate, {
    passive: true,
  });
  window.setInterval(checkForUpdate, 15 * 60_000);
}

function mount() {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthGate>
            <OrganatoProvider>
              <App />
            </OrganatoProvider>
          </AuthGate>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
  window.addEventListener("load", () => {
    void prepareServiceWorker().catch(() => {
      // Offline support is optional; a registration failure must not affect the app.
    });
  });
}

mount();
