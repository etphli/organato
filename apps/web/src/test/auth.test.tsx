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
});
