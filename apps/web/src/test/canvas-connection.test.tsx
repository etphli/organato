import type {
  CanvasConnectResponse,
  CanvasConnectionStatus,
} from "@organato/domain";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CanvasConnectionSection } from "../components/settings/CanvasConnectionSection";

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

    fireEvent.change(screen.getByLabelText("Personal access token"), {
      target: { value: "private-canvas-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect Reshet" }));

    expect(
      await screen.findByRole("button", { name: "Sync now" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Ethan Likht")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Personal access token"),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());

    const connectCall = request.mock.calls.find(([path]) =>
      String(path).endsWith("/connect"),
    );
    expect(connectCall?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ token: "private-canvas-token" }),
      }),
    );
    expect(connectCall?.[1]?.body).not.toContain("baseUrl");
  });
});
