import type { ReactNode } from "react";
import {
  CalendarDays,
  CheckSquare2,
  ChevronRight,
  ClipboardList,
  Flag,
  Home,
  Settings,
} from "lucide-react";
import type { IntegrationHealth } from "@organato/domain";
import { useLocation } from "react-router-dom";
import { useOrganatoUi, useOrganatoWorkspace } from "../state/OrganatoProvider";
import { useAuthOwner } from "./AuthGate";
import { BrandMark } from "./BrandMark";

const navigation = [
  { to: "/", label: "Home", icon: Home },
  { to: "/assignments", label: "Assignments", icon: ClipboardList },
  { to: "/checkpoints", label: "Checkpoints", icon: Flag },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/todo", label: "Todo", icon: CheckSquare2 },
];
type ShellSyncTone = "neutral" | "healthy" | "busy" | "attention";

const integrationSettingsPath: Record<IntegrationHealth["provider"], string> = {
  canvas: "/settings/canvas",
  google_calendar: "/settings/calendar",
  gmail: "/settings/email",
};

export function getShellSyncStatus(
  integrations: IntegrationHealth[],
  syncing: boolean,
): {
  label: string;
  tone: ShellSyncTone;
  to?: string;
  targetLabel?: string;
} {
  if (syncing) return { label: "Syncing…", tone: "busy" };
  if (
    !integrations.length ||
    integrations.every(({ state }) => state === "disconnected")
  ) {
    return { label: "Not connected", tone: "neutral" };
  }
  const actionable = integrations.find(
    ({ state }) => state === "action_needed",
  );
  if (actionable) {
    return {
      label: "Action needed",
      tone: "attention",
      to: integrationSettingsPath[actionable.provider],
      targetLabel: actionable.label,
    };
  }
  const delayed = integrations.find(({ state }) =>
    ["delayed", "partial"].includes(state),
  );
  if (delayed) {
    return {
      label: "Sync delayed",
      tone: "attention",
      to: integrationSettingsPath[delayed.provider],
      targetLabel: delayed.label,
    };
  }
  if (integrations.every(({ state }) => state === "healthy")) {
    return { label: "Up to date", tone: "healthy" };
  }
  return { label: "Partly connected", tone: "neutral" };
}

export function AppShell({ children }: { children: ReactNode }) {
  const owner = useAuthOwner();
  const { pathname } = useLocation();
  const { integrations } = useOrganatoWorkspace();
  const { syncing } = useOrganatoUi();
  const displayName = owner?.displayName || owner?.email || "Owner";
  const syncStatus = getShellSyncStatus(integrations, syncing);
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const routeIsActive = (to: string) =>
    to === "/"
      ? pathname === "/"
      : pathname === to || pathname.startsWith(`${to}/`);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <a
        href="/settings"
        className="mobile-account-link"
        aria-label={`Open Settings for ${displayName}`}
      >
        <span className="avatar" aria-hidden="true">
          {initials}
        </span>
      </a>
      <aside className="sidebar" aria-label="Primary navigation">
        <a
          href="/"
          className="wordmark brand-lockup"
          aria-label="Organato Home"
        >
          <BrandMark size={22} />
          <span className="brand-lockup__name">Organato</span>
        </a>
        <nav className="sidebar-nav">
          {navigation.map(({ to, label, icon: Icon }) => (
            <a
              key={to}
              href={to}
              className={`nav-item${routeIsActive(to) ? " active" : ""}`}
              aria-current={routeIsActive(to) ? "page" : undefined}
            >
              <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
              <span>{label}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar-account">
          {syncStatus.to ? (
            <a
              href={syncStatus.to}
              className={`sync-quiet sync-state sync-state--${syncStatus.tone} sync-state--link`}
              aria-label={`${syncStatus.label}: open ${syncStatus.targetLabel} settings`}
              title={`Open ${syncStatus.targetLabel} settings`}
            >
              <span className="sync-state__indicator" aria-hidden="true" />
              <span>{syncStatus.label}</span>
              <span className="sync-state__arrow" aria-hidden="true">
                <ChevronRight size={14} strokeWidth={1.8} />
              </span>
            </a>
          ) : (
            <div
              className={`sync-quiet sync-state sync-state--${syncStatus.tone}`}
              role="status"
            >
              <span className="sync-state__indicator" aria-hidden="true" />
              <span>{syncStatus.label}</span>
            </div>
          )}
          <a href="/settings" className="account-link">
            <span className="avatar" aria-hidden="true">
              {initials}
            </span>
            <span>{displayName}</span>
            <Settings size={17} strokeWidth={1.7} aria-label="Settings" />
          </a>
        </div>
      </aside>
      <main className="main-content" id="main-content" tabIndex={-1}>
        {children}
      </main>
      <nav className="bottom-nav" aria-label="Primary navigation">
        {navigation.map(({ to, label, icon: Icon }) => (
          <a
            key={to}
            href={to}
            className={routeIsActive(to) ? "active" : ""}
            aria-current={routeIsActive(to) ? "page" : undefined}
          >
            <Icon size={21} strokeWidth={1.7} aria-hidden="true" />
            <span>{label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
