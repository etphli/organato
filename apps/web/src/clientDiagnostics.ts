type DiagnosticKind =
  | "interaction"
  | "runtime_error"
  | "react_error"
  | "freeze"
  | "crash_recovery"
  | "long_task";

const sessionKey = "organato_diagnostic_session";
const verboseDiagnosticsKey = "organato_verbose_diagnostics";
const lastAliveKey = "organato_last_alive";
let installed = false;
let clickIndex = 0;
let longTasksReported = 0;

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
    performance as Performance & { memory?: { usedJSHeapSize?: number } }
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

/**
 * A hard crash kills the tab before any in-page reporter can fire, so the
 * only evidence that survives is written while everything still works.
 * Every few seconds a tiny marker lands in localStorage (synchronous,
 * crash-proof). The next successful load compares timestamps: a gap proves
 * the previous session stopped responding or died, and the stored route
 * plus memory reading say where and how bloated it was when it happened.
 */
function reportPreviousSessionGap() {
  let marker: { ts: number; route: string; memoryMb: number | null } | null =
    null;
  try {
    marker = JSON.parse(localStorage.getItem(lastAliveKey) ?? "null") as {
      ts: number;
      route: string;
      memoryMb: number | null;
    } | null;
  } catch {
    return;
  }
  if (!marker) return;
  const gapSeconds = Math.round((Date.now() - marker.ts) / 1000);
  localStorage.removeItem(lastAliveKey);
  if (gapSeconds >= 4 && gapSeconds <= 600) {
    // Defer until the workspace CSRF token exists so the report is accepted.
    window.setTimeout(
      () =>
        reportClientDiagnostic("crash_recovery", {
          gapSeconds,
          crashedRoute: marker.route,
          crashedMemoryMb: marker.memoryMb,
        }),
      4000,
    );
  }
}

function installAliveMarker() {
  const write = () => {
    try {
      localStorage.setItem(
        lastAliveKey,
        JSON.stringify({
          ts: Date.now(),
          route: window.location.pathname,
          memoryMb: memoryMegabytes(),
        }),
      );
    } catch {
      /* Storage limits must never break the app. */
    }
  };
  write();
  window.setInterval(write, 2000);
  window.addEventListener("beforeunload", write);
}

const maximumReportedLongTasks = 10;

function installFreezeWatchdog() {
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < 200) continue;
        longTasksReported += 1;
        if (longTasksReported > maximumReportedLongTasks) return;
        reportClientDiagnostic("long_task", {
          durationMs: Math.round(entry.duration),
        });
      }
    });
    observer.observe({ entryTypes: ["longtask"] });
  } catch {
    return;
  }

  // Distinguishes a slow machine from an app problem: the Compute Pressure
  // API reports whole-system CPU state. If pressure reads critical during a
  // freeze, the browser was starved by something outside this tab.
  try {
    type PressureRecord = { state: string };
    type PressureSource = "cpu";
    const ObserverCtor = (
      window as unknown as {
        PressureObserver?: new (
          callback: (records: PressureRecord[]) => void,
        ) => {
          observe: (source: PressureSource) => Promise<void>;
          disconnect(): void;
        };
      }
    ).PressureObserver;
    if (ObserverCtor) {
      let lastState = "";
      const cpuObserver = new ObserverCtor((records) => {
        const latest = records.at(-1)?.state ?? "";
        if (!latest || latest === lastState) return;
        lastState = latest;
        if (latest !== "nominal") {
          reportClientDiagnostic("freeze", { systemPressure: latest });
        }
      });
      void cpuObserver.observe("cpu");
    }
  } catch {
    /* Compute Pressure is optional instrumentation. */
  }

  // Click-to-response latency above half a second means the interface
  // stopped answering input even though no long task was recorded - the
  // signature of renderer starvation rather than JavaScript work.
  try {
    const eventObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < 500) continue;
        reportClientDiagnostic("long_task", {
          interactionMs: Math.round(entry.duration),
          interactionName: entry.name,
        });
      }
    });
    eventObserver.observe({
      type: "event",
      durationThreshold: 500,
    } as PerformanceObserverInit);
  } catch {
    /* Event timing is optional instrumentation. */
  }

  let previous = Date.now();
  window.setInterval(() => {
    const nowMs = Date.now();
    const drift = nowMs - previous - 2000;
    previous = nowMs;
    if (drift > 3000 && document.visibilityState === "visible") {
      reportClientDiagnostic("freeze", { driftMs: Math.round(drift) });
    }
  }, 2000);
}

export function installClientDiagnostics() {
  if (installed) return;
  installed = true;

  reportPreviousSessionGap();
  installAliveMarker();
  installFreezeWatchdog();

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
    if (event.target instanceof HTMLScriptElement) return;
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
