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
const serviceWorkerRetirementKey = "organato:service-worker-retired-v1";

async function retireServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const hadController = navigator.serviceWorker.controller !== null;
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
  if (
    hadController &&
    sessionStorage.getItem(serviceWorkerRetirementKey) !== "true"
  ) {
    sessionStorage.setItem(serviceWorkerRetirementKey, "true");
    window.location.reload();
  }
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
    void retireServiceWorker().catch(() => {
      // Cache cleanup is best effort and must never affect the app.
    });
  });
}

mount();
