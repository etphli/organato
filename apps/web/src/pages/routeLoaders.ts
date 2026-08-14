export const loadHomePage = () => import("./HomePage");
export const loadWorkPage = () => import("./WorkPage");
export const loadTodoPage = () => import("./TodoPage");
export const loadSettingsPage = () => import("./SettingsPage");

export function preloadRoute(path: string): void {
  const pathname = path.split("?")[0] ?? path;
  if (pathname === "/") void loadHomePage();
  else if (["/assignments", "/checkpoints"].includes(pathname))
    void loadWorkPage();
  else if (pathname === "/calendar") return;
  else if (pathname === "/todo") void loadTodoPage();
  else if (pathname.startsWith("/settings")) void loadSettingsPage();
}
