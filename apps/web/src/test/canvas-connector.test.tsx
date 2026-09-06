import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CanvasConnectorSection,
  type CanvasConnectorIdentity,
  type CanvasConnectorRequest,
  type CanvasConnectorStatus,
} from "../components/settings/CanvasConnectorSection";
import { IntegrationRequestError } from "../lib/integrationApi";

const identity: CanvasConnectorIdentity = {
  id: "canvas-owner",
  name: "Ethan Likht",
  hostname: "emanuel.instructure.com",
};

function futureIso(milliseconds: number): string {
  return new Date(Date.now() + milliseconds).toISOString();
}

function connectorStatus(
  state: CanvasConnectorStatus["state"],
  overrides: Partial<CanvasConnectorStatus> = {},
): CanvasConnectorStatus {
  return {
    enabled: true,
    paired: state !== "unpaired",
    erasurePending: false,
    deviceName: "Study Pi",
    lastSeenAt: "2026-09-06T01:00:00.000Z",
    state,
    identity: null,
    candidateIdentity: null,
    lastSyncAt: null,
    error: null,
    loginExpiresAt: null,
    ...overrides,
  };
}

function requestRecorder(handler: CanvasConnectorRequest) {
  return vi.fn(handler);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Canvas connector settings", () => {
  it("walks from a paired Pi through remote sign-in, identity confirmation, and sync", async () => {
    let currentStatus = connectorStatus("ready", {
      paired: true,
      deviceName: "Study Pi",
    });
    const loginExpiresAt = futureIso(600_000);
    const viewExpiresAt = futureIso(60_000);
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const disconnect = vi.fn();
    const focus = vi.fn();
    const sendKey = vi.fn();
    const rfbFactory = vi.fn(async () => ({ disconnect, focus, sendKey }));
    const refresh = vi.fn().mockResolvedValue(undefined);
    const request = requestRecorder(async (path, init) => {
      calls.push(init === undefined ? { path } : { path, init });
      if (path === "/api/session") return { recentAuthentication: true };
      if (path === "/api/integrations/canvas/connector") return currentStatus;
      if (path.endsWith("/login")) {
        currentStatus = connectorStatus("signing_in", {
          paired: true,
          loginExpiresAt,
        });
        return { ok: true };
      }
      if (path.endsWith("/view")) {
        return {
          url: "wss://organato.etphli.workers.dev/api/canvas-view?ticket=test",
          expiresAt: viewExpiresAt,
        };
      }
      if (path.endsWith("/verify")) {
        currentStatus = connectorStatus("awaiting_confirmation", {
          paired: true,
          candidateIdentity: identity,
          loginExpiresAt,
        });
        return { ok: true };
      }
      if (path.endsWith("/confirm")) {
        currentStatus = connectorStatus("syncing", {
          paired: true,
          identity,
          lastSyncAt: "2026-09-06T01:02:00.000Z",
        });
        return { ok: true };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <CanvasConnectorSection
        onWorkspaceRefresh={refresh}
        request={request}
        rfbFactory={rfbFactory}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Sign in to Canvas" }),
    ).toBeInTheDocument();
    expect(rfbFactory).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Sign in to Canvas" }));
    await waitFor(() => expect(rfbFactory).toHaveBeenCalledOnce());
    expect(
      screen.getByRole("button", { name: "I have signed in" }),
    ).toBeInTheDocument();
    fireEvent.click(
      await screen.findByRole("button", { name: "Show keyboard" }),
    );
    const keyboardInput = screen.getByLabelText(
      "Type in remote Canvas browser",
    );
    fireEvent.input(keyboardInput, { target: { value: "Canvas" } });
    expect(focus).toHaveBeenCalledOnce();
    expect(sendKey).toHaveBeenNthCalledWith(1, 67, "KeyC");
    expect(sendKey).toHaveBeenNthCalledWith(6, 115, "KeyS");
    expect(keyboardInput).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "I have signed in" }));
    expect(
      await screen.findByRole("button", { name: "Confirm this account" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Ethan Likht")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Confirm this account" }),
    );
    expect(
      await screen.findByRole("button", { name: "Sync now" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Connected as Ethan Likht/)).toBeInTheDocument();
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(disconnect).toHaveBeenCalledOnce();

    expect(
      calls.filter(({ path }) =>
        path.includes("/api/integrations/canvas/connector/"),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/api/integrations/canvas/connector/login",
        }),
        expect.objectContaining({
          path: "/api/integrations/canvas/connector/view",
        }),
        expect.objectContaining({
          path: "/api/integrations/canvas/connector/verify",
        }),
        expect.objectContaining({
          path: "/api/integrations/canvas/connector/confirm",
        }),
      ]),
    );
    const confirmCall = calls.find(({ path }) => path.endsWith("/confirm"));
    expect(confirmCall?.init).toEqual(
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ userId: identity.id }),
      }),
    );
  });

  it("keeps pairing code renewal available after a code expires", async () => {
    const request = requestRecorder(async (path) => {
      if (path === "/api/session") return { recentAuthentication: true };
      if (path === "/api/integrations/canvas/connector") {
        return connectorStatus("unpaired", {
          paired: false,
          deviceName: null,
          lastSeenAt: null,
        });
      }
      if (path.endsWith("/pair")) {
        return {
          code: "OLD-CODE",
          expiresAt: "2020-01-01T00:00:00.000Z",
        };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <CanvasConnectorSection
        initialStatus={connectorStatus("unpaired", {
          paired: false,
          deviceName: null,
          lastSeenAt: null,
        })}
        request={request}
      />,
    );

    const pairButton = await screen.findByRole("button", {
      name: "Create pairing code",
    });
    fireEvent.click(pairButton);
    expect(await screen.findByText("OLD-CODE")).toBeInTheDocument();
    expect(pairButton).toBeEnabled();
    expect(screen.getByText("Expired")).toBeInTheDocument();
  });

  it("offers retry viewing when the Pi socket is not ready", async () => {
    let currentStatus = connectorStatus("ready", { paired: true });
    let viewAttempts = 0;
    const loginExpiresAt = futureIso(600_000);
    const viewExpiresAt = futureIso(60_000);
    const rfbFactory = vi.fn(async () => ({ disconnect: vi.fn() }));
    const request = requestRecorder(async (path) => {
      if (path === "/api/session") return { recentAuthentication: true };
      if (path === "/api/integrations/canvas/connector") return currentStatus;
      if (path.endsWith("/login")) {
        currentStatus = connectorStatus("signing_in", {
          paired: true,
          loginExpiresAt,
        });
        return { ok: true };
      }
      if (path.endsWith("/view")) {
        viewAttempts += 1;
        if (viewAttempts === 1) {
          throw new IntegrationRequestError(
            "The Pi is opening the browser. Try viewing again in a few seconds.",
            "connector_not_ready",
          );
        }
        return {
          url: "wss://organato.etphli.workers.dev/api/canvas-view?ticket=retry",
          expiresAt: viewExpiresAt,
        };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <CanvasConnectorSection request={request} rfbFactory={rfbFactory} />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Sign in to Canvas" }),
    );
    expect(
      await screen.findByRole("button", { name: "Retry viewing" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/The Pi is opening the browser/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry viewing" }));
    await waitFor(() => expect(rfbFactory).toHaveBeenCalledOnce());
    expect(viewAttempts).toBe(2);
  });

  it("blocks connector actions until recent Google sign-in is confirmed", async () => {
    const request = requestRecorder(async (path) => {
      if (path === "/api/session") return { recentAuthentication: false };
      if (path === "/api/integrations/canvas/connector") {
        return connectorStatus("ready", { paired: true });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<CanvasConnectorSection request={request} rfbFactory={vi.fn()} />);

    expect(
      await screen.findByRole("button", { name: "Confirm sign-in" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign in to Canvas" }),
    ).toBeDisabled();
  });

  it("keeps cleanup and sync available after recent authentication expires", async () => {
    const connectedStatus = connectorStatus("connected", {
      paired: true,
      identity,
      erasurePending: true,
    });
    const calls: string[] = [];
    const request = requestRecorder(async (path) => {
      calls.push(path);
      if (path === "/api/session") return { recentAuthentication: false };
      if (path === "/api/integrations/canvas/connector") return connectedStatus;
      if (path.endsWith("/sync")) return { ok: true };
      if (path.endsWith("/close")) return { ok: true };
      throw new Error(`Unexpected request: ${path}`);
    });

    render(
      <CanvasConnectorSection
        initialStatus={connectedStatus}
        request={request}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Sync now" }),
    ).toBeEnabled();
    expect(
      screen.getByText(
        /A disconnected Pi has not yet confirmed local session removal/,
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    await waitFor(() =>
      expect(calls).toContain("/api/integrations/canvas/connector/sync"),
    );

    cleanup();
    const signingInStatus = connectorStatus("signing_in", {
      paired: true,
      loginExpiresAt: futureIso(600_000),
    });
    render(
      <CanvasConnectorSection
        initialStatus={signingInStatus}
        request={request}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Close browser" }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Close browser" }));
    await waitFor(() =>
      expect(calls).toContain("/api/integrations/canvas/connector/close"),
    );
  });
});
