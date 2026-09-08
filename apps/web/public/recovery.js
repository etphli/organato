/* global console, HTMLLinkElement, HTMLScriptElement, sessionStorage, window */

(function () {
  "use strict";

  var RETRY_KEY = "organato_asset_retry";
  var RETRY_WINDOW_MS = 30000;
  var MAX_RELOADS_PER_SESSION = 3;

  function reloadBudgetExhausted() {
    try {
      var count = Number(sessionStorage.getItem(RETRY_KEY + ":count") || "0");
      return count >= MAX_RELOADS_PER_SESSION;
    } catch {
      return true;
    }
  }

  function spendReloadBudget() {
    try {
      var count = Number(sessionStorage.getItem(RETRY_KEY + ":count") || "0");
      sessionStorage.setItem(RETRY_KEY + ":count", String(count + 1));
    } catch {
      /* Best effort only. */
    }
  }

  function shouldRetry(path) {
    if (reloadBudgetExhausted()) return false;
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
    spendReloadBudget();
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

  // NOTE: this script used to unregister every service worker and delete
  // the app-shell caches on each load. That permanently defeated offline
  // support, so it now only keeps the stale-asset reload budget above.
  window.__organatoRecovery = Promise.resolve().catch(function () {
    /* Recovery must never block the app. */
  });
})();
