import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installClientDiagnostics,
  interactionDiagnosticsEnabled,
} from "../clientDiagnostics";

describe("client diagnostics", () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response(null)));

  beforeEach(() => {
    sessionStorage.clear();
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("does not install click telemetry for a normal session", () => {
    sessionStorage.setItem("organato_csrf", "csrf-token");
    installClientDiagnostics();

    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(interactionDiagnosticsEnabled()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
