import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { seedSettings, seedSubjects } from "../data/seed";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("workspace boot", () => {
  it("renders a recoverable error when one boot request fails", async () => {
    vi.stubEnv("VITE_DEMO_MODE", "false");
    let settingsRequestFails = true;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/settings" && settingsRequestFails) {
        return new Response(JSON.stringify({ error: "Settings unavailable" }), {
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

    settingsRequestFails = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Workspace ready")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });
});
