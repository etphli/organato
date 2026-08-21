/* global caches, console, HTMLLinkElement, HTMLScriptElement, navigator, sessionStorage, window */

(function () {
  "use strict";

  var RETRY_KEY = "organato_asset_retry";
  var RETRY_WINDOW_MS = 30_000;

  function shouldRetry(path) {
    try {
      var previous = JSON.parse(sessionStorage.getItem(RETRY_KEY) || "null");
      var now = Date.now();
      if (
        previous &&
        previous.path === path &&
        now - previous.at < RETRY_WINDOW_MS
      ) {
        return false;
      }
      sessionStorage.setItem(
        RETRY_KEY,
        JSON.stringify({ path: path, at: now }),
      );
      return true;
    } catch {
      return false;
    }
  }

  function recoverFromBrokenAsset(message) {
    var path =
      window.location.pathname + window.location.search + window.location.hash;
    if (!shouldRetry(path)) return false;
    console.warn("Organato recovered from a stale asset (" + message + ").");
    window.location.reload();
    return true;
  }

  var MODULE_LOAD_PATTERN =
    /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module/i;

  window.addEventListener(
    "error",
    function (event) {
      var target = event.target;
      if (
        target instanceof HTMLScriptElement ||
        target instanceof HTMLLinkElement
      ) {
        recoverFromBrokenAsset("script or stylesheet request failed");
      }
    },
    true,
  );

  window.addEventListener("unhandledrejection", function (event) {
    var reason = event.reason;
    var message =
      reason instanceof Error ? reason.message : String(reason ?? "");
    if (MODULE_LOAD_PATTERN.test(message)) {
      recoverFromBrokenAsset(message.slice(0, 120));
    }
  });

  window.__organatoRecovery = (async function () {
    if (!("serviceWorker" in navigator)) return;
    var registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations.map(function (registration) {
        return registration.unregister();
      }),
    );
    if ("caches" in window) {
      var cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter(function (name) {
            return name.startsWith("organato-shell-");
          })
          .map(function (name) {
            return caches.delete(name);
          }),
      );
    }
  })().catch(function () {
    /* Recovery must never block the app. */
  });
})();
