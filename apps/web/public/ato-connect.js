(function () {
  const protocol = "ato.connection.v1";
  const storageKey = "ato.connection.pending.v1";
  const script = document.querySelector("script[data-ato-app]");
  const app = script?.dataset.atoApp;
  if (!app) return;

  function allowedOrigin(value) {
    try {
      const url = new URL(value);
      const local =
        url.protocol === "http:" &&
        (url.hostname === "localhost" || url.hostname === "127.0.0.1");
      const production =
        url.protocol === "https:" &&
        (url.hostname === "ato-centre.vercel.app" ||
          (url.hostname.startsWith("ato-centre-") &&
            url.hostname.endsWith(".vercel.app")));
      return local || production;
    } catch {
      return false;
    }
  }

  function readRequest() {
    const params = new URLSearchParams(window.location.search);
    const queryRequest = {
      requestId: params.get("atoRequest"),
      origin: params.get("atoOrigin"),
    };
    if (
      params.get("atoConnect") === "1" &&
      queryRequest.requestId &&
      queryRequest.origin &&
      allowedOrigin(queryRequest.origin)
    ) {
      sessionStorage.setItem(storageKey, JSON.stringify(queryRequest));
      return queryRequest;
    }
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      return saved?.requestId && allowedOrigin(saved.origin) ? saved : null;
    } catch {
      return null;
    }
  }

  const request = readRequest();
  if (!request) return;
  function send(state) {
    if (!window.opener) return false;
    window.opener.postMessage(
      { protocol, requestId: request.requestId, app, state },
      request.origin,
    );
    return true;
  }
  function returnToCentre() {
    const callback = new URL("/connect/callback", request.origin);
    callback.searchParams.set("atoRequest", request.requestId);
    callback.searchParams.set("atoApp", app);
    callback.searchParams.set("atoState", "connected");
    window.location.replace(callback);
  }
  async function check() {
    try {
      const response = await fetch("/api/session", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (response.status === 401) return "needs-auth";
      if (!response.ok) return "unavailable";
      const payload = await response.json();
      return payload?.authenticated === true ? "connected" : "needs-auth";
    } catch {
      return "unavailable";
    }
  }
  async function report() {
    const state = await check();
    if (state === "connected") {
      sessionStorage.removeItem(storageKey);
      clearInterval(timer);
      if (!send(state)) returnToCentre();
      return;
    }
    send(state);
  }
  const timer = window.setInterval(report, 1500);
  void report();
})();
