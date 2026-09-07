import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SetupWizard } from "../components/setup/SetupWizard";
import { seedSettings, seedSubjects } from "../data/seed";
import { OrganatoProvider } from "../state/OrganatoProvider";

const unpairedConnector = {
  enabled: true,
  paired: false,
  erasurePending: false,
  deviceName: null,
  lastSeenAt: null,
  state: "unpaired",
  identity: null,
  candidateIdentity: null,
  lastSyncAt: null,
  error: null,
  loginExpiresAt: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("first-run setup", () => {
  it("confirms a stale session before allowing Canvas connector changes", async () => {
    vi.stubEnv("VITE_DEMO_MODE", "false");
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
                : path === "/api/integrations/canvas/connector"
                  ? unpairedConnector
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
      await screen.findByRole("button", { name: "Confirm sign-in" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Reshet session cookie"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Connect and import" }),
    ).not.toBeInTheDocument();
  });
});
