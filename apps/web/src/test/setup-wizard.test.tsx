import type { CanvasConnectionStatus } from "@organato/domain";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SetupWizard } from "../components/setup/SetupWizard";
import { seedSettings, seedSubjects } from "../data/seed";
import { OrganatoProvider } from "../state/OrganatoProvider";

const disconnectedCanvas: CanvasConnectionStatus = {
  installation: {
    name: "Emanuel School Canvas",
    hostname: "emanuel.instructure.com",
    readOnly: true,
  },
  state: "disconnected",
  connection: null,
  counts: { activeCourses: 0, upcomingItems: 0 },
  latestSync: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("first-run setup", () => {
  it("confirms a stale session before showing the Reshet cookie field", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      const body = path.startsWith("/api/items")
        ? { items: [] }
        : path === "/api/subjects"
          ? { subjects: seedSubjects }
          : path === "/api/settings"
            ? { settings: seedSettings }
            : path === "/api/integrations"
              ? { integrations: [] }
              : path === "/api/views"
                ? { views: [] }
                : path === "/api/integrations/canvas/status"
                  ? disconnectedCanvas
                  : path === "/api/integrations/google/settings"
                    ? {
                        connected: true,
                        sender: "owner@example.com",
                        recipients: ["owner@example.com"],
                        status: "healthy",
                        reconnectNeeded: false,
                        lastSuccessAt: null,
                        lastAttemptAt: null,
                        lastErrorCategory: null,
                      }
                    : path === "/api/session"
                      ? { recentAuthentication: false }
                      : {};
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <OrganatoProvider>
        <SetupWizard onDismiss={vi.fn()} />
      </OrganatoProvider>,
    );

    expect(
      await screen.findByRole("button", {
        name: /Confirm your Google sign-in/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Reshet session cookie"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Connect and import" }),
    ).not.toBeInTheDocument();
  });
});
