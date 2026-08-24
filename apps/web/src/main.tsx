import { SpeedInsights } from "@vercel/speed-insights/react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { installClientDiagnostics } from "./clientDiagnostics";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { AuthGate } from "./components/AuthGate";
import { OrganatoProvider } from "./state/OrganatoProvider";
import "./styles.css";
import "./polish.css";

installClientDiagnostics();

createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>
    <BrowserRouter useTransitions={false}>
      <AuthGate>
        <OrganatoProvider>
          <App />
        </OrganatoProvider>
      </AuthGate>
    </BrowserRouter>
    <SpeedInsights />
  </AppErrorBoundary>,
);
