import { prefetchAccountData } from "./navigationData";
import { prefetchablePage } from "./prefetchablePage";

export const routeModules = {
  home: prefetchablePage(() => import("../pages/HomePage")),
  work: prefetchablePage(() => import("../pages/WorkPage")),
  calendar: prefetchablePage(() => import("../pages/CalendarPage")),
  todo: prefetchablePage(() => import("../pages/TodoPage")),
  settings: prefetchablePage(() => import("../pages/SettingsPage")),
};

export function prefetchRoute(path: string): void {
  if (!navigator.onLine) return;
  let load: (() => Promise<unknown>) | undefined;
  if (path === "/") load = routeModules.home.preload;
  else if (path === "/assignments" || path === "/checkpoints")
    load = routeModules.work.preload;
  else if (path === "/calendar") load = routeModules.calendar.preload;
  else if (path === "/todo") load = routeModules.todo.preload;
  else if (path === "/settings" || path.startsWith("/settings/")) {
    load = routeModules.settings.preload;
    if (path === "/settings" || path === "/settings/account")
      prefetchAccountData();
  }
  void load?.().catch(() => undefined);
}
