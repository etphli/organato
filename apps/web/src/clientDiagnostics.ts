type DiagnosticKind = "interaction" | "runtime_error" | "react_error";

const sessionKey = "organato_diagnostic_session";
const verboseDiagnosticsKey = "organato_verbose_diagnostics";
let installed = false;
let clickIndex = 0;

export function interactionDiagnosticsEnabled(): boolean {
  return sessionStorage.getItem(verboseDiagnosticsKey) === "true";
}

function diagnosticSessionId(): string {
  const existing = sessionStorage.getItem(sessionKey);
  if (existing) return existing;
  const created = crypto.randomUUID();
  sessionStorage.setItem(sessionKey, created);
  return created;
}

function currentBuild(): string {
  const entry = document.querySelector<HTMLScriptElement>(
    'script[type="module"][src*="/assets/index-"]',
  );
  return entry?.src.split("/").at(-1) ?? "unknown";
}

function memoryMegabytes(): number | null {
  const memory = (
    performance as Performance & {
      memory?: { usedJSHeapSize?: number };
    }
  ).memory;
  return typeof memory?.usedJSHeapSize === "number"
    ? Math.round((memory.usedJSHeapSize / 1_048_576) * 10) / 10
    : null;
}

export function reportClientDiagnostic(
  kind: DiagnosticKind,
  details: Record<string, unknown>,
) {
  const csrf = sessionStorage.getItem("organato_csrf");
  if (!csrf) return;
  const body = JSON.stringify({
    kind,
    sessionId: diagnosticSessionId(),
    build: currentBuild(),
    route: window.location.pathname,
    visibility: document.visibilityState,
    memoryMb: memoryMegabytes(),
    ...details,
  });
  void fetch("/api/client-diagnostics", {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
    },
    body,
  }).catch(() => undefined);
}

export function installClientDiagnostics() {
  if (installed) return;
  installed = true;

  // Keep the normal click path completely free of diagnostic work. Detailed
  // interaction capture is installed only for an explicitly enabled session.
  if (interactionDiagnosticsEnabled()) {
    document.addEventListener(
      "click",
      (event) => {
        const target =
          event.target instanceof Element ? event.target : document.body;
        const interactive = target.closest<HTMLElement>("a,button,[role]");
        clickIndex += 1;
        reportClientDiagnostic("interaction", {
          clickIndex,
          tag:
            interactive?.tagName.toLowerCase() ?? target.tagName.toLowerCase(),
          role: interactive?.getAttribute("role") ?? null,
          className: (interactive?.className || target.className || "")
            .toString()
            .slice(0, 120),
          href:
            interactive instanceof HTMLAnchorElement
              ? interactive.getAttribute("href")
              : null,
        });
      },
      { capture: true },
    );
  }

  window.addEventListener("error", (event) => {
    reportClientDiagnostic("runtime_error", {
      message: event.message.slice(0, 240),
      source: event.filename.split("/").at(-1) ?? null,
      line: event.lineno,
      column: event.colno,
      stack:
        event.error instanceof Error ? event.error.stack?.slice(0, 800) : null,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    reportClientDiagnostic("runtime_error", {
      message:
        reason instanceof Error
          ? reason.message.slice(0, 240)
          : String(reason).slice(0, 240),
      stack: reason instanceof Error ? reason.stack?.slice(0, 800) : null,
    });
  });
}
