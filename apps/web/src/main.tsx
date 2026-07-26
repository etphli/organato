import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AuthGate } from "./components/AuthGate";
import { OrganatoProvider } from "./state/OrganatoProvider";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});

async function removeLegacyServiceWorker(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return true;
  const wasControlled = navigator.serviceWorker.controller !== null;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations.map((registration) => registration.unregister()),
  );
  const isGoogleCallback =
    window.location.pathname === "/auth/google/callback" ||
    window.location.pathname === "/api/auth/google/callback";
  if (
    wasControlled &&
    !isGoogleCallback &&
    sessionStorage.getItem("organato_service_worker_reset") !== "complete"
  ) {
    sessionStorage.setItem("organato_service_worker_reset", "complete");
    window.location.replace(`/?service-worker-reset=${Date.now()}`);
    return false;
  }
  sessionStorage.removeItem("organato_service_worker_reset");
  return true;
}

async function mount() {
  if (!(await removeLegacyServiceWorker())) return;
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
}

void mount();
