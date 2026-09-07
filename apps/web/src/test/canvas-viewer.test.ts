import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultRfbFactory } from "../components/settings/CanvasConnectorViewer";

const mocks = vi.hoisted(() => ({
  sessions: new Array<EventTarget>(),
  disconnect: vi.fn(),
}));
vi.mock("@novnc/novnc", () => ({
  default: class extends EventTarget {
    constructor() {
      super();
      mocks.sessions.push(this);
    }
    disconnect = mocks.disconnect;
    focus() {}
    sendKey() {}
  },
}));
vi.mock("../clientDiagnostics", () => ({ reportClientDiagnostic: vi.fn() }));

describe("Canvas viewer handshake", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.sessions.length = 0;
    mocks.disconnect.mockClear();
  });
  afterEach(() => vi.useRealTimers());
  it("waits for the display handshake instead of treating construction as connection", async () => {
    let ready = false;
    const pending = defaultRfbFactory(
      document.createElement("div"),
      "wss://example.test",
    ).then((session) => {
      ready = true;
      return session;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(ready).toBe(false);
    mocks.sessions[0]?.dispatchEvent(new Event("connect"));
    const session = await pending;
    expect(ready).toBe(true);
    session.disconnect();
  });
  it("rejects a stalled handshake so the settings page can retry", async () => {
    const pending = defaultRfbFactory(
      document.createElement("div"),
      "wss://example.test",
    );
    const rejected = expect(pending).rejects.toThrow("connection failed");
    await vi.advanceTimersByTimeAsync(20_000);
    await rejected;
    expect(mocks.disconnect).toHaveBeenCalled();
  });
  it("reports a disconnect after connection and cancels a pending viewer on unmount", async () => {
    const controller = new AbortController();
    const onDisconnect = vi.fn();
    const pending = defaultRfbFactory(
      document.createElement("div"),
      "wss://example.test",
      { signal: controller.signal, onDisconnect },
    );
    await vi.advanceTimersByTimeAsync(0);
    mocks.sessions[0]?.dispatchEvent(new Event("connect"));
    await pending;
    mocks.sessions[0]?.dispatchEvent(new Event("disconnect"));
    expect(onDisconnect).toHaveBeenCalledOnce();
    const next = defaultRfbFactory(
      document.createElement("div"),
      "wss://example.test",
      { signal: controller.signal, onDisconnect },
    );
    const rejected = expect(next).rejects.toThrow("Viewer closed");
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejected;
  });
});
