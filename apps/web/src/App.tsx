import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { CommandPalette } from "./components/CommandPalette";
import { Inspector } from "./components/Inspector";
import { NetworkStatus } from "./components/NetworkStatus";
import { PwaUpdateNotice } from "./components/PwaUpdateNotice";
import { SearchOverlay } from "./components/SearchOverlay";
import { SetupWizard } from "./components/setup/SetupWizard";
import { Toast } from "./components/Toast";
import { useOrganatoActions, useOrganatoData } from "./state/OrganatoProvider";

const HomePage = lazy(() => import("./pages/HomePage"));
const WorkPage = lazy(() => import("./pages/WorkPage"));
const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const TodoPage = lazy(() => import("./pages/TodoPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));

function ItemDeepLink() {
  const { id } = useParams();
  const { items } = useOrganatoData();
  const { dispatch } = useOrganatoActions();
  const navigate = useNavigate();

  useEffect(() => {
    const item = items.find((entry) => entry.id === id);
    if (item) dispatch({ type: "select", id: item.id });
    else
      dispatch({ type: "toast", message: "That item is no longer available" });
    navigate("/", { replace: true });
  }, [dispatch, id, items, navigate]);

  return null;
}

function PageFallback() {
  return (
    <div
      className="page page-fallback"
      aria-label="Loading page"
      aria-busy="true"
    >
      <div className="page-fallback-heading">
        <span />
        <span />
      </div>
      <div className="page-fallback-rule" />
      <div className="page-fallback-row">
        <span />
        <span />
        <span />
      </div>
      <div className="page-fallback-row">
        <span />
        <span />
        <span />
      </div>
      <div className="page-fallback-row">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

export function App() {
  const { ready, settings } = useOrganatoData();
  const { dispatch } = useOrganatoActions();
  const navigate = useNavigate();
  const sequence = useRef("");
  const sequenceTimeout = useRef<number | null>(null);
  const [setupDismissed, setSetupDismissed] = useState(
    () => sessionStorage.getItem("organato_setup_dismissed") === "true",
  );
  const showSetup =
    import.meta.env.VITE_DEMO_MODE !== "true" &&
    ready &&
    !settings.onboardingCompleted &&
    !setupDismissed;

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.density = settings.density;
    document.documentElement.dataset.reduceMotion = String(
      settings.reduceMotion,
    );
    document.documentElement.dataset.highContrast = String(
      settings.highContrast,
    );
    document.documentElement.dataset.underlineLinks = String(
      settings.underlineExternalLinks,
    );
    document.documentElement.dataset.alwaysIconText = String(
      settings.alwaysShowIconText,
    );
    document.documentElement.style.setProperty(
      "--font-scale",
      String(settings.fontScale),
    );
  }, [settings]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing =
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
        target.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        dispatch({ type: "command", open: true });
        return;
      }
      if (!typing && event.key === "/") {
        event.preventDefault();
        dispatch({ type: "search", open: true });
        return;
      }
      if (event.key === "Escape") {
        dispatch({ type: "select", id: null });
        dispatch({ type: "command", open: false });
        dispatch({ type: "search", open: false });
        return;
      }
      if (typing) return;
      if (!settings.multiKeyNavigation) return;
      sequence.current = `${sequence.current}${event.key.toLowerCase()}`.slice(
        -2,
      );
      const paths: Record<string, string> = {
        gh: "/",
        ga: "/assignments",
        gc: "/checkpoints",
        gt: "/todo",
        gl: "/calendar",
      };
      const path = paths[sequence.current];
      if (path) {
        navigate(path);
        sequence.current = "";
      }
      if (sequenceTimeout.current !== null) {
        window.clearTimeout(sequenceTimeout.current);
      }
      sequenceTimeout.current = window.setTimeout(() => {
        sequence.current = "";
        sequenceTimeout.current = null;
      }, 800);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (sequenceTimeout.current !== null) {
        window.clearTimeout(sequenceTimeout.current);
      }
    };
  }, [dispatch, navigate, settings.multiKeyNavigation]);

  return (
    <>
      <NetworkStatus />
      <PwaUpdateNotice />
      <AppShell>
        {showSetup ? (
          <SetupWizard
            onDismiss={() => {
              sessionStorage.setItem("organato_setup_dismissed", "true");
              setSetupDismissed(true);
            }}
          />
        ) : (
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route
                path="/assignments"
                element={<WorkPage page="assignments" />}
              />
              <Route
                path="/checkpoints"
                element={<WorkPage page="checkpoints" />}
              />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/todo" element={<TodoPage />} />
              <Route path="/settings/*" element={<SettingsPage />} />
              <Route path="/items/:id" element={<ItemDeepLink />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        )}
      </AppShell>
      <Inspector />
      <CommandPalette />
      <SearchOverlay />
      <Toast />
    </>
  );
}
