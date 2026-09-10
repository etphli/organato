import { afterEach, describe, expect, it, vi } from "vitest";
import { exchangeGoogleCallbackIfPresent } from "../components/AuthGate";

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("Google authentication callback", () => {
  it("exchanges the callback code before loading the session", async () => {
    window.history.replaceState(
      null,
      "",
      "/api/auth/google/callback?code=google-code&state=oauth-state",
    );
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          authenticated: true,
          csrfToken: "callback-csrf",
          returnTo: "/",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await exchangeGoogleCallbackIfPresent()).toBe(true);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/auth/google/exchange",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
      }),
    );
    expect(window.location.pathname).toBe("/");
    expect(window.location.search).toBe("");
    expect(sessionStorage.getItem("organato_csrf")).toBe("callback-csrf");
  });

  it("recovers an integration callback served through the app shell", async () => {
    window.history.replaceState(
      null,
      "",
      "/api/integrations/google/callback?code=integration-code&state=integration-oauth-state",
    );
    sessionStorage.setItem("organato_csrf", "existing-csrf");
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          connected: true,
          returnTo: "/settings/calendar?connected=1",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await exchangeGoogleCallbackIfPresent()).toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/integrations/google/exchange",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        headers: expect.objectContaining({
          "X-CSRF-Token": "existing-csrf",
        }),
      }),
    );
    expect(window.location.pathname).toBe("/settings/calendar");
    expect(window.location.search).toBe("?connected=1");
  });

  it("preserves the server's safe explanation when an account is not approved", async () => {
    window.history.replaceState(
      null,
      "",
      "/api/auth/google/callback?code=google-code&state=oauth-state",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: "This Google account has not been approved for Organato.",
          }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(exchangeGoogleCallbackIfPresent()).rejects.toThrow(
      "This Google account has not been approved for Organato.",
    );
  });

  it("strips the one-time params even when the exchange fails", async () => {
    window.history.replaceState(
      null,
      "",
      "/api/auth/google/callback?code=google-code&state=oauth-state",
    );
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ error: "Google sign-in expired. Start again." }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          ),
        ),
    );

    await expect(exchangeGoogleCallbackIfPresent()).rejects.toThrow(
      "Google sign-in expired. Start again.",
    );
    // A refresh or back navigation must not replay the consumed state.
    expect(window.location.pathname).toBe("/api/auth/google/callback");
    expect(window.location.search).toBe("");
  });

  it("retries once when a twin submission is still completing", async () => {
    window.history.replaceState(
      null,
      "",
      "/api/auth/google/callback?code=google-code&state=oauth-state",
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: "Sign-in is already completing." }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            authenticated: true,
            csrfToken: "csrf-2",
            returnTo: "/",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(exchangeGoogleCallbackIfPresent()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sessionStorage.getItem("organato_csrf")).toBe("csrf-2");
  }, 15000);

  it("retries once after a network failure", async () => {
    window.history.replaceState(
      null,
      "",
      "/api/auth/google/callback?code=google-code&state=oauth-state",
    );
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            authenticated: true,
            csrfToken: "csrf-3",
            returnTo: "/",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(exchangeGoogleCallbackIfPresent()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 15000);
});
