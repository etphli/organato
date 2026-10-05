import { afterEach, describe, expect, it, vi } from "vitest";
import { preloadRoute, routeModules } from "../lib/routeModules";

afterEach(() => vi.restoreAllMocks());
describe("startup route preloading", () => {
  it.each([
    ["/", "home"],
    ["/assignments", "work"],
    ["/checkpoints", "work"],
    ["/calendar", "calendar"],
    ["/todo", "todo"],
    ["/settings/canvas", "settings"],
  ] satisfies Array<[string, keyof typeof routeModules]>)(
    "loads %s without making private API requests",
    (path, key) => {
      const load = vi
        .spyOn(routeModules[key], "preload")
        .mockResolvedValue({ default: () => null });
      const fetchMock = vi.spyOn(globalThis, "fetch");
      preloadRoute(path);
      expect(load).toHaveBeenCalledOnce();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it("does not preload a page for unknown routes or while offline", () => {
    const load = vi.spyOn(routeModules.home, "preload");
    preloadRoute("/items/shared-id");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    preloadRoute("/");
    expect(load).not.toHaveBeenCalled();
  });
});
