import { act, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

const entry = vi.hoisted(() => ({ unmount: () => {} }));

vi.mock("react-dom/client", async (original) => {
  const client = await original<typeof import("react-dom/client")>();
  return {
    ...client,
    createRoot: (...args: Parameters<typeof client.createRoot>) => {
      const root = client.createRoot(...args);
      entry.unmount = () => root.unmount();
      return root;
    },
  };
});
vi.mock("../App", () => ({
  App: function Destination() {
    const location = useLocation();
    return (
      <main>
        {location.pathname}
        {location.search}
        {location.hash}
      </main>
    );
  },
}));
vi.mock("../state/OrganatoProvider", () => ({
  OrganatoProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../clientDiagnostics", () => ({ installClientDiagnostics: vi.fn() }));
vi.mock("../sw-register", () => ({ registerServiceWorker: vi.fn() }));
vi.mock("../lib/routeModules", () => ({ preloadRoute: vi.fn() }));

afterEach(() => {
  act(() => entry.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

it.each([
  "/api/auth/google/callback",
  "/auth/google/callback",
  "/api/integrations/google/callback",
])(
  "renders the original page after %s through the production entry point",
  async (callbackPath) => {
    vi.stubEnv("VITE_DEMO_MODE", "false");
    const destination = "/settings/canvas?tab=connection#account";
    window.history.replaceState(
      null,
      "",
      `${callbackPath}?code=google-code&state=oauth-state`,
    );
    document.body.innerHTML = '<div id="root"></div>';
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) =>
        Response.json(
          path.endsWith("/google/exchange")
            ? { authenticated: true, csrfToken: "csrf", returnTo: destination }
            : {
                authenticated: true,
                csrfToken: "csrf",
                owner: { email: "owner@example.com", displayName: "Owner" },
              },
        ),
      ),
    );

    await act(async () => {
      await import("../main");
    });

    expect(await screen.findByRole("main")).toHaveTextContent(destination);
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe(destination);
  },
);
