import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { AuthGate } from "./components/AuthGate";
import { OrganatoProvider } from "./state/OrganatoProvider";
import "./styles.css";
import "./polish.css";

createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>
    <BrowserRouter useTransitions={false}>
      <AuthGate>
        <OrganatoProvider>
          <App />
        </OrganatoProvider>
      </AuthGate>
    </BrowserRouter>
  </AppErrorBoundary>,
);
