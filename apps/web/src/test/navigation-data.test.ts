import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  prefetchAccountData,
  requestNavigationData,
} from "../lib/navigationData";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(async () => {
  vi.stubEnv("VITE_DEMO_MODE", "false");
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers();
  fetchMock
    .mockReset()
    .mockImplementation(async () => Response.json({ ok: true }));
  sessionStorage.clear();
  await requestNavigationData("/api/identities");
  await requestNavigationData("/api/sessions");
  fetchMock.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("account navigation data", () => {
  it("starts reads before a click and reuses each response once", async () => {
    prefetchAccountData();
    prefetchAccountData();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      await (await requestNavigationData("/api/identities")).json(),
    ).toEqual({ ok: true });
    await requestNavigationData("/api/sessions");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await requestNavigationData("/api/sessions");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("shares an in-flight read with the page", async () => {
    let finish: ((response: Response) => void) | undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    prefetchAccountData();
    const response = requestNavigationData("/api/identities");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    finish?.(Response.json({ identities: [] }));
    expect(await (await response).json()).toEqual({ identities: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each(["network", "http"])(
    "retries a failed %s prefetch when the page opens",
    async (kind) => {
      if (kind === "network")
        fetchMock.mockRejectedValueOnce(new Error("offline"));
      else fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
      prefetchAccountData();
      expect((await requestNavigationData("/api/identities")).ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    },
  );
  it("expires abandoned prefetches instead of serving old account data", async () => {
    prefetchAccountData();
    vi.advanceTimersByTime(10_001);
    await requestNavigationData("/api/identities");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("discards prefetches from an earlier authenticated session", async () => {
    sessionStorage.setItem("organato_csrf", "session-a");
    prefetchAccountData();
    sessionStorage.setItem("organato_csrf", "session-b");
    await requestNavigationData("/api/identities");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("does not fetch private data in demo mode", () => {
    vi.stubEnv("VITE_DEMO_MODE", "true");
    prefetchAccountData();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
