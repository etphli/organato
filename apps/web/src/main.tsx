import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AuthGate } from "./components/AuthGate";
import { OrganatoProvider } from "./state/OrganatoProvider";
import "./styles.css";
import "./polish.css";

declare global {
  interface Window {
    __organatoRecovery?: Promise<boolean>;
  }
}

function mount() {
  createRoot(document.getElementById("root")!).render(
    <BrowserRouter useTransitions={false}>
      <AuthGate>
        <OrganatoProvider>
          <App />
        </OrganatoProvider>
      </AuthGate>
    </BrowserRouter>,
  );
}

void (window.__organatoRecovery ?? Promise.resolve(true)).then(
  (shouldMount) => {
    if (shouldMount) mount();
  },
  mount,
);
