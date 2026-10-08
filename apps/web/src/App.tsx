import { Suspense, lazy, useEffect, useRef, useState } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { AiDemoBanner } from "./components/ai/AiDemoBanner";
import { RouteErrorBoundary } from "./components/AppErrorBoundary";
import { DeferredOverlays } from "./components/DeferredOverlays";
import { NetworkStatus } from "./components/NetworkStatus";
import { PwaUpdateNotice } from "./components/PwaUpdateNotice";
import { Toast } from "./components/Toast";
import {
  useOrganatoActions,
  useOrganatoItems,
  useOrganatoWorkspace,
} from "./state/OrganatoProvider";
import { routeModules } from "./lib/routeModules";
import { KEY_SEQUENCE_TIMEOUT_MS } from "./lib/timing";

// Route-split: each page (and the one-shot wizard) loads on demand instead
// of inflating the first paint for every route.
const CalendarPage = routeModules.calendar.Page;
const HomePage = routeModules.home.Page;
const SettingsPage = routeModules.settings.Page;
const TodoPage = routeModules.todo.Page;
const WorkPage = routeModules.work.Page;
const SetupWizard = lazy(() =>
  import("./components/setup/SetupWizard").then((module) => ({
    default: module.SetupWizard,
  })),
);

function RouteFallback() {
  return (
    <div className="route-loading" role="status" aria-label="Loading page">
      <span className="route-loading__spinner" aria-hidden="true" />
      <span>Loading…</span>
    </div>
  );
}

function AssignmentsRoute() {
  return <WorkPage />;
}

function CheckpointsRoute() {
  const { search, hash } = useLocation();
  return <Navigate to={`/assignments${search}${hash}`} replace />;
}

function ItemDeepLink() {
  const { id } = useParams();
  const { items } = useOrganatoItems();
  const { ready } = useOrganatoWorkspace();
  const { dispatch } = useOrganatoActions();
  const navigate = useNavigate();

  useEffect(() => {
    if (!ready) return;
    const item = items.find((entry) => entry.id === id);
    if (item) dispatch({ type: "select", id: item.id });
    else
      dispatch({ type: "toast", message: "That item is no longer available" });
    // Preserve shareable URLs and back-button history: step back when the
    // deep link was opened inside the app, replace only on direct loads.
    const historyIndex = (window.history.state as { idx?: number } | null)?.idx;
    if (typeof historyIndex === "number" && historyIndex > 0) navigate(-1);
    else navigate("/", { replace: true });
  }, [dispatch, id, items, navigate, ready]);

  if (!ready)
    return (
      <div className="route-loading" role="status" aria-label="Loading item">
        <span className="route-loading__spinner" aria-hidden="true" />
        <span>Loading item…</span>
      </div>
    );
  return null;
}

export function App() {
  const { ready, settings } = useOrganatoWorkspace();
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
        // Escape always dismisses global overlays — even while typing in
        // them — and only clears selection when focus is elsewhere.
        dispatch({ type: "command", open: false });
        dispatch({ type: "search", open: false });
        if (!typing) dispatch({ type: "select", id: null });
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
        gc: "/assignments",
        gt: "/todo",
        gl: "/calendar",
      };
      const path = paths[sequence.current];
      if (path) {
        dispatch({ type: "select", id: null });
        navigate(path);
        sequence.current = "";
      }
      if (sequenceTimeout.current !== null) {
        window.clearTimeout(sequenceTimeout.current);
      }
      sequenceTimeout.current = window.setTimeout(() => {
        sequence.current = "";
        sequenceTimeout.current = null;
      }, KEY_SEQUENCE_TIMEOUT_MS);
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
      <AppShell>
        <AiDemoBanner />
        {/* The wizard overlays instead of replacing routes so deep links
            and settings stay reachable until onboarding is dismissed. */}
        <RouteErrorBoundary>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/assignments" element={<AssignmentsRoute />} />
              <Route path="/checkpoints" element={<CheckpointsRoute />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/todo" element={<TodoPage />} />
              <Route path="/settings/*" element={<SettingsPage />} />
              <Route path="/items/:id" element={<ItemDeepLink />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </RouteErrorBoundary>
        {showSetup ? (
          <div
            className="setup-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Set up your workspace"
          >
            <Suspense fallback={<RouteFallback />}>
              <SetupWizard
                onDismiss={() => {
                  sessionStorage.setItem("organato_setup_dismissed", "true");
                  setSetupDismissed(true);
                }}
              />
            </Suspense>
          </div>
        ) : null}
      </AppShell>
      <DeferredOverlays />
      <Toast />
      <PwaUpdateNotice />
    </>
  );
}
