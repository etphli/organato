import type { ReactNode } from "react";
import {
  CalendarDays,
  CheckSquare2,
  ClipboardList,
  Flag,
  Home,
  Settings,
} from "lucide-react";
import type { IntegrationHealth } from "@organato/domain";
import { NavLink, type NavLinkRenderProps } from "react-router-dom";
import { useOrganato } from "../state/OrganatoProvider";
import { useAuthOwner } from "./AuthGate";
import { BrandMark } from "./BrandMark";

const navigation = [
  { to: "/", label: "Home", icon: Home },
  { to: "/assignments", label: "Assignments", icon: ClipboardList },
  { to: "/checkpoints", label: "Checkpoints", icon: Flag },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/todo", label: "Todo", icon: CheckSquare2 },
];
const mobileNavigation = [
  ...navigation,
  { to: "/settings", label: "Settings", icon: Settings },
];

type ShellSyncTone = "neutral" | "healthy" | "busy" | "attention";

export function getShellSyncStatus(
  integrations: IntegrationHealth[],
  syncing: boolean,
): { label: string; tone: ShellSyncTone } {
  if (syncing) return { label: "Syncing…", tone: "busy" };
  if (
    !integrations.length ||
    integrations.every(({ state }) => state === "disconnected")
  ) {
    return { label: "Not connected", tone: "neutral" };
  }
  if (integrations.some(({ state }) => state === "action_needed")) {
    return { label: "Action needed", tone: "attention" };
  }
  if (
    integrations.some(({ state }) => ["delayed", "partial"].includes(state))
  ) {
    return { label: "Sync delayed", tone: "attention" };
  }
  if (integrations.every(({ state }) => state === "healthy")) {
    return { label: "Up to date", tone: "healthy" };
  }
  return { label: "Partly connected", tone: "neutral" };
}

export function AppShell({ children }: { children: ReactNode }) {
  const owner = useAuthOwner();
  const { integrations, syncing } = useOrganato();
  const displayName = owner?.displayName || owner?.email || "Owner";
  const syncStatus = getShellSyncStatus(integrations, syncing);
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <aside className="sidebar" aria-label="Primary navigation">
        <NavLink
          to="/"
          className="wordmark brand-lockup"
          aria-label="Organato Home"
        >
          <BrandMark size={22} />
          <span className="brand-lockup__name">Organato</span>
        </NavLink>
        <nav className="sidebar-nav">
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }: NavLinkRenderProps) =>
                `nav-item${isActive ? " active" : ""}`
              }
            >
              <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-account">
          <div
            className={`sync-quiet sync-state sync-state--${syncStatus.tone}`}
            role="status"
          >
            <span className="sync-state__indicator" aria-hidden="true" />
            <span>{syncStatus.label}</span>
          </div>
          <NavLink to="/settings" className="account-link">
            <span className="avatar" aria-hidden="true">
              {initials}
            </span>
            <span>{displayName}</span>
            <Settings size={17} strokeWidth={1.7} aria-label="Settings" />
          </NavLink>
        </div>
      </aside>
      <main className="main-content" id="main-content" tabIndex={-1}>
        {children}
      </main>
      <nav className="bottom-nav" aria-label="Primary navigation">
        {mobileNavigation.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }: NavLinkRenderProps) =>
              isActive ? "active" : ""
            }
          >
            <Icon size={21} strokeWidth={1.7} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
