import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { installClientDiagnostics } from "./clientDiagnostics";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { AuthGate } from "./components/AuthGate";
import { OrganatoProvider } from "./state/OrganatoProvider";
import { preloadRoute } from "./lib/routeModules";
import { registerServiceWorker } from "./sw-register";
import "./styles.css";
import "./polish.css";

preloadRoute(window.location.pathname);
installClientDiagnostics();
registerServiceWorker();

createRoot(document.getElementById("root")!).render(
  <BrowserRouter useTransitions={false}>
    <AppErrorBoundary>
      <AuthGate>
        <OrganatoProvider>
          <App />
        </OrganatoProvider>
      </AuthGate>
    </AppErrorBoundary>
  </BrowserRouter>,
);
