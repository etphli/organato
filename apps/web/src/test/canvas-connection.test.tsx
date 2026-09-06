import type {
  CanvasConnectResponse,
  CanvasConnectionStatus,
} from "@organato/domain";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasConnectionSection } from "../components/settings/CanvasConnectionSection";
import { IntegrationRequestError } from "../lib/integrationApi";

afterEach(cleanup);

const disconnected: CanvasConnectionStatus = {
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

const connected: CanvasConnectionStatus = {
  ...disconnected,
  state: "healthy",
  connection: {
    userId: "canvas-owner",
    userName: "Ethan Likht",
    connectedAt: "2026-07-26T10:00:00.000Z",
    lastValidatedAt: "2026-07-26T10:00:00.000Z",
    lastSuccessfulSyncAt: "2026-07-26T10:01:00.000Z",
    nextExpectedSyncAt: "2026-07-26T11:00:00.000Z",
  },
  counts: { activeCourses: 6, upcomingItems: 14 },
  latestSync: {
    startedAt: "2026-07-26T10:00:00.000Z",
    finishedAt: "2026-07-26T10:01:00.000Z",
    result: "success",
    fetched: 14,
    created: 14,
    updated: 0,
    archived: 0,
  },
};

describe("Canvas connection settings", () => {
  it("keeps the school pinned server-side and refreshes after connecting", async () => {
    let isConnected = false;
    const connectResponse: CanvasConnectResponse = {
      connection: connected.connection!,
      initialSync: {
        status: "success",
        runId: "sync-1",
        courses: 6,
        fetched: 14,
        created: 14,
        updated: 0,
      },
    };
    const request = vi.fn(
      async (path: string, init?: RequestInit): Promise<unknown> => {
        if (path === "/api/session") {
          return { recentAuthentication: true };
        }
        if (path === "/api/integrations/canvas/connector") {
          return {
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
        }
        if (path.endsWith("/status")) {
          return isConnected ? connected : disconnected;
        }
        if (path.endsWith("/connect") && init?.method === "POST") {
          isConnected = true;
          return connectResponse;
        }
        throw new Error(`Unexpected request: ${path}`);
      },
    );
    const refresh = vi.fn().mockResolvedValue(undefined);

    render(
      <CanvasConnectionSection
        request={request}
        onWorkspaceRefresh={refresh}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "Connect Reshet" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Sync now" }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByText("Use a session cookie instead", { selector: "summary" }),
    );
    fireEvent.change(await screen.findByLabelText("Reshet session cookie"), {
      target: { value: "canvas_session=private-session" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect Reshet" }));

    expect(
      await screen.findByRole("button", { name: "Sync now" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Ethan Likht")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Reshet session cookie"),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());

    const connectCall = request.mock.calls.find(([path]) =>
      String(path).endsWith("/connect"),
    );
    expect(connectCall?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ cookie: "canvas_session=private-session" }),
      }),
    );
    expect(connectCall?.[1]?.body).not.toContain("baseUrl");
  });

  it("asks for recent Google confirmation before accepting a session cookie", async () => {
    const request = vi.fn(async (path: string): Promise<unknown> => {
      if (path === "/api/session") {
        return { recentAuthentication: false };
      }
      if (path === "/api/integrations/canvas/connector") {
        return {
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
      }
      if (path.endsWith("/status")) return disconnected;
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<CanvasConnectionSection request={request} />);

    expect(
      await screen.findByRole("button", { name: "Confirm sign-in" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Reshet session cookie"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Connect Reshet" }),
    ).not.toBeInTheDocument();
  });

  it("requires a different session after Canvas rejects the submitted cookie", async () => {
    const request = vi.fn(
      async (path: string, init?: RequestInit): Promise<unknown> => {
        if (path === "/api/session") {
          return { recentAuthentication: true };
        }
        if (path === "/api/integrations/canvas/connector") {
          return {
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
        }
        if (path.endsWith("/status")) return disconnected;
        if (path.endsWith("/connect") && init?.method === "POST") {
          throw new IntegrationRequestError(
            "Reshet ended this browser session. Copy the fresh Cookie value and reconnect.",
            "session_rejected",
          );
        }
        throw new Error(`Unexpected request: ${path}`);
      },
    );

    render(<CanvasConnectionSection request={request} />);
    fireEvent.click(
      await screen.findByText("Use a session cookie instead", {
        selector: "summary",
      }),
    );
    const input = await screen.findByLabelText("Reshet session cookie");
    const button = screen.getByRole("button", { name: "Connect Reshet" });

    fireEvent.change(input, {
      target: { value: "canvas_session=rejected-session" },
    });
    fireEvent.click(button);

    expect(
      await screen.findByText(/Reshet ended this browser session/i),
    ).toBeInTheDocument();
    expect(button).toBeDisabled();

    fireEvent.change(input, {
      target: { value: "canvas_session=new-session" },
    });
    expect(button).toBeEnabled();
    expect(
      screen.queryByText(/Reshet ended this browser session/i),
    ).not.toBeInTheDocument();
  });
});
