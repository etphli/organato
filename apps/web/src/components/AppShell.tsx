import type { ReactNode } from "react";
import {
  CalendarDays,
  CheckSquare2,
  ClipboardList,
  Flag,
  Home,
  Settings,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { useAuthOwner } from "./AuthGate";

const navigation = [
  { to: "/", label: "Home", icon: Home },
  { to: "/assignments", label: "Assignments", icon: ClipboardList },
  { to: "/checkpoints", label: "Checkpoints", icon: Flag },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/todo", label: "Todo", icon: CheckSquare2 },
];

export function AppShell({ children }: { children: ReactNode }) {
  const owner = useAuthOwner();
  const displayName = owner?.displayName || owner?.email || "Owner";
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <NavLink to="/" className="wordmark" aria-label="Organato Home">
          Organato
        </NavLink>
        <nav className="sidebar-nav">
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `nav-item${isActive ? " active" : ""}`
              }
            >
              <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-account">
          <div className="sync-quiet">
            <span className="health-dot" aria-hidden="true" />
            <span>Up to date</span>
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
      <main className="main-content" id="main-content">
        {children}
      </main>
      <nav className="bottom-nav" aria-label="Primary navigation">
        {navigation.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            <Icon size={21} strokeWidth={1.7} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
