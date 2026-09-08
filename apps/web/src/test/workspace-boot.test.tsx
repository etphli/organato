import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { seedSettings, seedSubjects } from "../data/seed";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("workspace boot", () => {
  it("hydrates partially when one boot request fails", async () => {
    vi.stubEnv("VITE_DEMO_MODE", "false");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/settings") {
        return new Response(JSON.stringify({ error: "Settings unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }
      const body = path.startsWith("/api/items")
        ? { items: [] }
        : path === "/api/subjects"
          ? { subjects: seedSubjects }
          : path === "/api/integrations"
            ? { integrations: [] }
            : { views: [] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { OrganatoProvider, useOrganatoUi } =
      await import("../state/OrganatoProvider");

    function ToastProbe() {
      const { toast } = useOrganatoUi();
      return <p>{toast ?? "no toast"}</p>;
    }

    render(
      <OrganatoProvider>
        <p>Workspace ready</p>
        <ToastProbe />
      </OrganatoProvider>,
    );

    // Core workspace still boots; the failed slice is reported, not fatal.
    expect(await screen.findByText("Workspace ready")).toBeInTheDocument();
    expect(
      await screen.findByText(/settings.*could not load/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Workspace couldn’t open" }),
    ).toBeNull();
  });

  it("renders a recoverable error when the items request fails", async () => {
    vi.stubEnv("VITE_DEMO_MODE", "false");
    const itemsRequestFails = true;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith("/api/items") && itemsRequestFails) {
        return new Response(JSON.stringify({ error: "Items unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }
      const body = path.startsWith("/api/items")
        ? { items: [] }
        : path === "/api/subjects"
          ? { subjects: seedSubjects }
          : path === "/api/settings"
            ? { settings: seedSettings }
            : path === "/api/integrations"
              ? { integrations: [] }
              : { views: [] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { OrganatoProvider } = await import("../state/OrganatoProvider");

    render(
      <OrganatoProvider>
        <p>Workspace ready</p>
      </OrganatoProvider>,
    );

    expect(
      await screen.findByRole("heading", {
        name: "Workspace couldn’t open",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Workspace ready")).toBeNull();
  });
});
