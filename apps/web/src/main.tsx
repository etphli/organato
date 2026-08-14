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
        <BrowserRouter useTransitions={false}>
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
