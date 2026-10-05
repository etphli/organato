import { prefetchAccountData } from "./navigationData";
import { prefetchablePage } from "./prefetchablePage";

export const routeModules = {
  home: prefetchablePage(() => import("../pages/HomePage")),
  work: prefetchablePage(() => import("../pages/WorkPage")),
  calendar: prefetchablePage(() => import("../pages/CalendarPage")),
  todo: prefetchablePage(() => import("../pages/TodoPage")),
  settings: prefetchablePage(() => import("../pages/SettingsPage")),
};

function loaderForPath(path: string): (() => Promise<unknown>) | undefined {
  if (path === "/") return routeModules.home.preload;
  if (path === "/assignments" || path === "/checkpoints")
    return routeModules.work.preload;
  if (path === "/calendar") return routeModules.calendar.preload;
  if (path === "/todo") return routeModules.todo.preload;
  if (path === "/settings" || path.startsWith("/settings/"))
    return routeModules.settings.preload;
  return undefined;
}

export function preloadRoute(path: string): void {
  if (!navigator.onLine) return;
  void loaderForPath(path)?.().catch(() => undefined);
}

export function prefetchRoute(path: string): void {
  if (!navigator.onLine) return;
  preloadRoute(path);
  if (path === "/settings" || path === "/settings/account")
    prefetchAccountData();
}

export function warmSidebarRoutes(): () => void {
  const timer = window.setTimeout(() => {
    if (
      "connection" in navigator &&
      typeof navigator.connection === "object" &&
      navigator.connection !== null &&
      "saveData" in navigator.connection &&
      navigator.connection.saveData === true
    )
      return;
    for (const path of ["/", "/assignments", "/calendar", "/todo"])
      preloadRoute(path);
  }, 500);
  return () => window.clearTimeout(timer);
}
