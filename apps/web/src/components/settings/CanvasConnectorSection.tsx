import { canvasSyncMessage } from "../../lib/canvasSync";
import {
  AlertCircle,
  Aperture,
  Check,
  ChevronDown,
  Clock3,
  KeyRound,
  Keyboard as KeyboardIcon,
  Monitor,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  WifiOff,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  IntegrationRequestError,
  integrationRequest,
  reauthenticate,
} from "../../lib/integrationApi";
import {
  canvasConnectorIsConnected,
  parseCanvasConnectorStatus,
  parseOkResponse,
  parsePairResponse,
  parseSessionSecurity,
  parseViewResponse,
  requestErrorMessage,
  requiresRecentAuthentication,
  type CanvasConnectorState,
  type CanvasConnectorStatus,
} from "./CanvasConnectorProtocol";
import {
  defaultRfbFactory,
  forwardMobileSpecialKey,
  forwardMobileText,
  type CanvasRfbFactory,
  type CanvasRfbSession,
} from "./CanvasConnectorViewer";
import "./CanvasConnectorSection.css";

export {
  canvasConnectorIsConnected,
  parseCanvasConnectorStatus,
} from "./CanvasConnectorProtocol";
export type {
  CanvasConnectorIdentity,
  CanvasConnectorState,
  CanvasConnectorStatus,
} from "./CanvasConnectorProtocol";
export type {
  CanvasRfbFactory,
  CanvasRfbSession,
} from "./CanvasConnectorViewer";

export type CanvasConnectorRequest = (
  path: string,
  init?: RequestInit,
) => Promise<unknown>;

export interface CanvasConnectorSectionProps {
  initialStatus?: CanvasConnectorStatus;
  request?: CanvasConnectorRequest;
  onWorkspaceRefresh?: () => Promise<void>;
  onStatusChange?: (status: CanvasConnectorStatus) => void;
  onConnected?: (status: CanvasConnectorStatus) => void;
  returnTo?: string;
  variant?: "settings" | "setup";
  canvasDomain?: string;
  rfbFactory?: CanvasRfbFactory;
}

type BusyAction =
  | "pair"
  | "login"
  | "view"
  | "verify"
  | "confirm"
  | "close"
  | "sync"
  | "disconnect"
  | "reauthenticate"
  | null;

const defaultCanvasDomain = "emanuel.instructure.com";
const browserReadyRetryDelayMs = 1_000;
const browserReadyRetryAttempts = 60;
const browserNotReadyMessage = "Wait for the sign-in browser to be ready.";

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

const demoStatus: CanvasConnectorStatus = {
  enabled: true,
  paired: false,
  erasurePending: false,
  deviceName: null,
  lastSeenAt: null,
  state: "unpaired",
  identity: null,
  candidateIdentity: null,
  lastSyncAt: null,
  error: null,
  loginExpiresAt: null,
};

function formatTime(value: string | null): string {
  if (!value) return "Not yet";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function formatRemaining(value: string | null, now: number): string {
  if (!value) return "";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "Expiry unavailable";
  const remaining = timestamp - now;
  if (remaining <= 0) return "Expired";
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);
  if (minutes > 0) return `${minutes} min${minutes === 1 ? "" : "s"} left`;
  return `${seconds} sec${seconds === 1 ? "" : "s"} left`;
}

function stateLabel(state: CanvasConnectorState): string {
  switch (state) {
    case "unpaired":
      return "Not paired";
    case "offline":
      return "Pi offline";
    case "ready":
      return "Ready to sign in";
    case "signing_in":
      return "Sign-in open";
    case "awaiting_confirmation":
      return "Confirm account";
    case "connected":
      return "Connected";
    case "login_required":
      return "Sign-in expired";
    case "syncing":
      return "Syncing";
    case "error":
      return "Needs attention";
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

export function CanvasConnectorSection({
  initialStatus,
  request,
  onWorkspaceRefresh,
  onStatusChange,
  onConnected,
  returnTo = window.location.pathname,
  variant = "settings",
  canvasDomain = defaultCanvasDomain,
  rfbFactory,
}: CanvasConnectorSectionProps) {
  const demoMode = !request && import.meta.env.VITE_DEMO_MODE === "true";
  const requestJson = request ?? integrationRequest;
  const [status, setStatus] = useState<CanvasConnectorStatus | null>(
    initialStatus ?? (demoMode ? demoStatus : null),
  );
  const statusRef = useRef<CanvasConnectorStatus | null>(
    initialStatus ?? (demoMode ? demoStatus : null),
  );
  const [recentAuthentication, setRecentAuthentication] = useState<
    boolean | null
  >(demoMode ? true : null);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const [viewExpiresAt, setViewExpiresAt] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activityMessage, setActivityMessage] = useState<string | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [rfbReady, setRfbReady] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const viewerRef = useRef<HTMLDivElement>(null);
  const viewerSessionRef = useRef<CanvasRfbSession | null>(null);
  const mobileKeyboardRef = useRef<HTMLInputElement>(null);
  const viewRequestedRef = useRef(false);
  const viewRetryAttemptRef = useRef(0);
  const reportedConnectedRef = useRef(false);
  const createRfb = rfbFactory ?? defaultRfbFactory;

  const handleMobileKeyboardInput = useCallback(
    (event: FormEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      const session = viewerSessionRef.current;
      const text = input.value;

      forwardMobileText(session, text);

      input.value = "";
    },
    [],
  );

  const handleMobileKeyboardKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (!forwardMobileSpecialKey(viewerSessionRef.current, event.key)) {
        return;
      }

      event.preventDefault();
      event.currentTarget.value = "";
    },
    [],
  );

  const showMobileKeyboard = useCallback(() => {
    const input = mobileKeyboardRef.current;
    if (!input || !rfbReady) return;

    viewerSessionRef.current?.focus?.();
    input.value = "";
    input.focus({ preventScroll: true });
  }, [rfbReady]);

  const applyStatus = useCallback(
    (next: CanvasConnectorStatus) => {
      statusRef.current = next;
      setStatus(next);
      onStatusChange?.(next);
    },
    [onStatusChange],
  );

  const loadStatus =
    useCallback(async (): Promise<CanvasConnectorStatus | null> => {
      if (demoMode) return statusRef.current;
      const next = parseCanvasConnectorStatus(
        await requestJson("/api/integrations/canvas/connector"),
      );
      if (next.paired) {
        setPairingCode(null);
        setPairingExpiresAt(null);
      }
      const imported =
        next.lastSyncAt && next.lastSyncAt !== statusRef.current?.lastSyncAt;
      if (imported) setActivityMessage(null);
      applyStatus(next);
      if (imported) await onWorkspaceRefresh?.().catch(() => undefined);
      return next;
    }, [applyStatus, demoMode, onWorkspaceRefresh, requestJson]);

  const handleRequestError = useCallback(
    (requestError: unknown, fallback: string) => {
      if (requiresRecentAuthentication(requestError)) {
        setRecentAuthentication(false);
        setError("Confirm your Google sign-in before continuing.");
        return;
      }
      setError(requestErrorMessage(requestError, fallback));
    },
    [],
  );

  const loadSessionSecurity = useCallback(async (): Promise<boolean> => {
    if (demoMode) return true;
    const authenticated = parseSessionSecurity(
      await requestJson("/api/session"),
    );
    setRecentAuthentication(authenticated);
    return authenticated;
  }, [demoMode, requestJson]);

  const retryLoad = useCallback(async () => {
    setError(null);
    try {
      await Promise.all([
        initialStatus ? Promise.resolve(statusRef.current) : loadStatus(),
        loadSessionSecurity(),
      ]);
    } catch (loadError) {
      setError(
        requestErrorMessage(
          loadError,
          "Canvas connector status could not be loaded.",
        ),
      );
    }
  }, [initialStatus, loadSessionSecurity, loadStatus]);

  useEffect(() => {
    if (initialStatus && initialStatus !== statusRef.current) {
      applyStatus(initialStatus);
    }
  }, [applyStatus, initialStatus]);

  useEffect(() => {
    let active = true;
    if (demoMode) return () => undefined;

    void Promise.all([
      initialStatus ? Promise.resolve(statusRef.current) : loadStatus(),
      loadSessionSecurity(),
    ])
      .then(([, authenticated]) => {
        if (active) setRecentAuthentication(authenticated);
      })
      .catch((loadError) => {
        if (active) {
          setError(
            requestErrorMessage(
              loadError,
              "Canvas connector status could not be loaded.",
            ),
          );
        }
      });

    return () => {
      active = false;
    };
  }, [demoMode, initialStatus, loadSessionSecurity, loadStatus]);

  useEffect(() => {
    if (!pairingCode && !viewExpiresAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [pairingCode, viewExpiresAt]);

  const pollingDelay =
    status?.state === "syncing" ||
    status?.state === "signing_in" ||
    status?.state === "awaiting_confirmation" ||
    viewerOpen ||
    pairingCode
      ? 3_000
      : 15_000;

  useEffect(() => {
    if (demoMode || !status) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void loadStatus().catch((pollError) => {
        if (active) {
          setError(
            requestErrorMessage(
              pollError,
              "Canvas connector status could not be refreshed.",
            ),
          );
        }
      });
    }, pollingDelay);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [demoMode, loadStatus, pollingDelay, status]);

  useEffect(() => {
    if (!status) return;
    if (canvasConnectorIsConnected(status)) {
      if (!reportedConnectedRef.current) {
        reportedConnectedRef.current = true;
        onConnected?.(status);
      }
      if (viewerOpen || viewUrl) {
        setViewerOpen(false);
        setViewUrl(null);
        setViewExpiresAt(null);
        setViewError(null);
        viewRequestedRef.current = true;
      }
    } else {
      reportedConnectedRef.current = false;
    }
  }, [onConnected, status, viewUrl, viewerOpen]);

  const canMutate = useCallback(
    (requiresRecentAuthentication = true): boolean => {
      if (recentAuthentication === null) {
        setError("Checking your Google sign-in. Try again in a moment.");
        return false;
      }
      if (requiresRecentAuthentication && recentAuthentication === false) {
        setError("Confirm your Google sign-in before continuing.");
        return false;
      }
      return true;
    },
    [recentAuthentication],
  );

  const clearLocalView = useCallback((preventAutoOpen: boolean) => {
    setViewerOpen(false);
    setViewUrl(null);
    setViewExpiresAt(null);
    setViewError(null);
    if (preventAutoOpen) {
      viewRequestedRef.current = true;
      viewRetryAttemptRef.current = 0;
    }
  }, []);

  const requestView = useCallback(
    async (force = false) => {
      const currentStatus = statusRef.current;
      if (
        recentAuthentication !== true ||
        !currentStatus?.paired ||
        (!force && viewRequestedRef.current)
      ) {
        return;
      }
      if (force) clearLocalView(false);
      viewRequestedRef.current = true;
      setBusy("view");
      setViewError(null);
      try {
        if (demoMode) {
          throw new Error(
            "Remote Canvas sign-in is available when a Canvas Pi is connected.",
          );
        }
        const response = parseViewResponse(
          await requestJson("/api/integrations/canvas/connector/view", {
            method: "POST",
            body: JSON.stringify({}),
          }),
        );
        setViewUrl(response.url);
        setViewExpiresAt(response.expiresAt);
        setViewerOpen(true);
        viewRetryAttemptRef.current = 0;
      } catch (viewRequestError) {
        if (requiresRecentAuthentication(viewRequestError)) {
          handleRequestError(
            viewRequestError,
            "Canvas sign-in browser failed.",
          );
        } else {
          viewRetryAttemptRef.current += 1;
          setViewError(
            requestErrorMessage(
              viewRequestError,
              "Canvas sign-in browser could not be opened.",
            ),
          );
        }
      } finally {
        setBusy(null);
      }
    },
    [
      clearLocalView,
      demoMode,
      handleRequestError,
      recentAuthentication,
      requestJson,
    ],
  );

  useEffect(() => {
    if (status?.state !== "signing_in" || viewUrl || viewRequestedRef.current) {
      return;
    }
    void requestView();
  }, [recentAuthentication, requestView, status?.state, viewUrl]);

  useEffect(() => {
    if (
      !["signing_in", "awaiting_confirmation"].includes(status?.state ?? "") ||
      !viewError ||
      viewUrl ||
      busy === "view" ||
      recentAuthentication !== true
    ) {
      return;
    }
    const expiresAt = Date.parse(status?.loginExpiresAt ?? "");
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) return;
    const delay = Math.min(
      1_000 * 2 ** Math.max(0, viewRetryAttemptRef.current - 1),
      8_000,
    );
    const timer = window.setTimeout(() => void requestView(true), delay);
    return () => window.clearTimeout(timer);
  }, [
    busy,
    recentAuthentication,
    requestView,
    status?.loginExpiresAt,
    status?.state,
    viewError,
    viewUrl,
  ]);

  useEffect(() => {
    if (!viewerOpen || !viewUrl || !viewerRef.current) return;
    let active = true;
    let session: CanvasRfbSession | null = null;
    const target = viewerRef.current;
    const keyboardInput = mobileKeyboardRef.current;

    const controller = new AbortController();
    const disconnected = () => {
      if (!active) return;
      setViewUrl(null);
      setRfbReady(false);
      setViewError("The Pi display disconnected. Reconnecting…");
    };
    void createRfb(target, viewUrl, {
      signal: controller.signal,
      onDisconnect: disconnected,
    })
      .then((nextSession) => {
        if (active) {
          session = nextSession;
          viewerSessionRef.current = nextSession;
          setRfbReady(true);
        } else {
          nextSession.disconnect();
        }
      })
      .catch((rfbError) => {
        if (active) {
          setViewUrl(null);
          setViewError(
            requestErrorMessage(
              rfbError,
              "The Canvas sign-in browser could not connect.",
            ),
          );
        }
      });

    return () => {
      active = false;
      controller.abort();
      session?.disconnect();
      if (viewerSessionRef.current === session) {
        viewerSessionRef.current = null;
      }
      if (keyboardInput) {
        keyboardInput.value = "";
      }
      setRfbReady(false);
      session = null;
    };
  }, [createRfb, viewUrl, viewerOpen]);

  const expireLocalView = useCallback(() => {
    if (!viewUrl && !viewerOpen && !viewExpiresAt) return;
    clearLocalView(true);
    setViewError(
      "The remote browser link expired. Retry viewing to reconnect.",
    );
  }, [clearLocalView, viewExpiresAt, viewUrl, viewerOpen]);

  useEffect(() => {
    const expiry = viewExpiresAt ?? status?.loginExpiresAt;
    if (!expiry) return;
    const expiresAt = Date.parse(expiry);
    if (!Number.isFinite(expiresAt)) return;
    const delay = expiresAt - Date.now();
    if (delay <= 0) {
      expireLocalView();
      return;
    }
    const timer = window.setTimeout(expireLocalView, delay);
    return () => window.clearTimeout(timer);
  }, [expireLocalView, status?.loginExpiresAt, viewExpiresAt]);

  const pair = async () => {
    if (!canMutate()) return;
    setBusy("pair");
    setError(null);
    setActivityMessage(null);
    try {
      if (demoMode) {
        const expiresAt = new Date(Date.now() + 600_000).toISOString();
        setPairingCode("DEMO-PAIR");
        setPairingExpiresAt(expiresAt);
        setActivityMessage("Use a real Canvas Pi to complete pairing.");
      } else {
        const response = parsePairResponse(
          await requestJson("/api/integrations/canvas/connector/pair", {
            method: "POST",
            body: JSON.stringify({}),
          }),
        );
        setPairingCode(response.code);
        setPairingExpiresAt(response.expiresAt);
        setActivityMessage("Pairing code created. Enter it in the Canvas Pi.");
        await loadStatus();
      }
    } catch (pairError) {
      handleRequestError(pairError, "Canvas Pi could not be paired.");
    } finally {
      setBusy(null);
    }
  };

  const login = async () => {
    if (!canMutate()) return;
    setBusy("login");
    setError(null);
    setViewError(null);
    clearLocalView(false);
    viewRequestedRef.current = false;
    viewRetryAttemptRef.current = 0;
    try {
      if (demoMode) {
        throw new Error(
          "Remote Canvas sign-in is available when a Canvas Pi is connected.",
        );
      }
      parseOkResponse(
        await requestJson("/api/integrations/canvas/connector/login", {
          method: "POST",
          body: JSON.stringify({}),
        }),
        "Canvas sign-in",
      );
      await loadStatus();
    } catch (loginError) {
      handleRequestError(loginError, "Canvas sign-in could not be started.");
    } finally {
      setBusy(null);
    }
  };

  const verify = async () => {
    if (!canMutate()) return;
    setBusy("verify");
    setError(null);
    try {
      for (let attempt = 0; attempt < browserReadyRetryAttempts; attempt += 1) {
        try {
          parseOkResponse(
            await requestJson("/api/integrations/canvas/connector/verify", {
              method: "POST",
              body: JSON.stringify({}),
            }),
            "Canvas account verification",
          );
          break;
        } catch (verifyError) {
          const browserIsStarting =
            verifyError instanceof IntegrationRequestError &&
            verifyError.message === browserNotReadyMessage;
          if (!browserIsStarting || attempt === browserReadyRetryAttempts - 1) {
            throw verifyError;
          }
          setActivityMessage("Finishing the Pi browser startup…");
          await wait(browserReadyRetryDelayMs);
        }
      }
      setActivityMessage(
        "Canvas account found. Check the name before confirming.",
      );
      await loadStatus();
    } catch (verifyError) {
      handleRequestError(verifyError, "Canvas account could not be verified.");
    } finally {
      setBusy(null);
    }
  };

  const confirmIdentity = async () => {
    if (!canMutate()) return;
    const candidate = statusRef.current?.candidateIdentity;
    if (!candidate) {
      setError("Canvas has not returned an account to confirm yet.");
      return;
    }
    setBusy("confirm");
    setError(null);
    try {
      parseOkResponse(
        await requestJson("/api/integrations/canvas/connector/confirm", {
          method: "POST",
          body: JSON.stringify({ userId: candidate.id }),
        }),
        "Canvas account confirmation",
      );
      clearLocalView(true);
      setActivityMessage("Canvas account confirmed. Sync has started.");
      await loadStatus();
    } catch (confirmError) {
      handleRequestError(
        confirmError,
        "Canvas account could not be confirmed.",
      );
    } finally {
      setBusy(null);
    }
  };

  const closeViewer = async () => {
    if (!canMutate(false)) return;
    setBusy("close");
    setError(null);
    try {
      if (!demoMode) {
        parseOkResponse(
          await requestJson("/api/integrations/canvas/connector/close", {
            method: "POST",
            body: JSON.stringify({}),
          }),
          "Canvas sign-in browser",
        );
        await loadStatus();
      }
      // Clear the local viewer only after the server acknowledges closure so
      // a failed close keeps its recovery path (automatic reopen on retry).
      clearLocalView(true);
    } catch (closeError) {
      // Leave the viewer mounted and allow automatic reopen to retry.
      clearLocalView(false);
      handleRequestError(closeError, "Canvas sign-in browser could not close.");
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    if (!canMutate(false)) return;
    setBusy("sync");
    setError(null);
    try {
      if (!demoMode) {
        parseOkResponse(
          await requestJson("/api/integrations/canvas/connector/sync", {
            method: "POST",
            body: JSON.stringify({}),
          }),
          "Canvas sync",
        );
        await loadStatus();
      }
      setActivityMessage("Canvas sync has started.");
    } catch (syncError) {
      handleRequestError(syncError, "Canvas could not be synced.");
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (!canMutate()) return;
    setBusy("disconnect");
    setError(null);
    setConfirmingDisconnect(false);
    clearLocalView(true);
    try {
      if (!demoMode) {
        parseOkResponse(
          await requestJson("/api/integrations/canvas/connector/disconnect", {
            method: "POST",
            body: JSON.stringify({}),
          }),
          "Canvas connector disconnect",
        );
        await loadStatus();
        await onWorkspaceRefresh?.().catch(() => undefined);
      }
      setActivityMessage(
        "Canvas disconnected. Imported work stays in Organato. The Pi erases its Canvas session when it reconnects.",
      );
    } catch (disconnectError) {
      handleRequestError(
        disconnectError,
        "Canvas connector could not be disconnected.",
      );
    } finally {
      setBusy(null);
    }
  };

  const confirmAgain = async () => {
    setBusy("reauthenticate");
    setError(null);
    try {
      await reauthenticate(returnTo);
    } catch (reauthenticationError) {
      handleRequestError(
        reauthenticationError,
        "Google sign-in could not be opened.",
      );
      setBusy(null);
    }
  };

  if (error && (!status || recentAuthentication === null)) {
    return (
      <section
        className={`canvas-connector canvas-connector--${variant}`}
        aria-labelledby="canvas-connector-heading"
      >
        <header className="canvas-connector__header">
          <h2 id="canvas-connector-heading">Connect Reshet</h2>
          <p>Canvas connector status could not be loaded.</p>
        </header>
        <p className="canvas-connector__message canvas-connector__message--error">
          {error}
        </p>
        <button
          type="button"
          className="canvas-connector__secondary"
          onClick={() => void retryLoad()}
        >
          Try again
        </button>
      </section>
    );
  }

  if (!status || recentAuthentication === null) {
    return (
      <section
        className={`canvas-connector canvas-connector--${variant} canvas-connector--loading`}
        aria-label="Loading Canvas connector"
      >
        <span />
        <span />
        <span />
      </section>
    );
  }

  const connected = canvasConnectorIsConnected(status);
  const deviceLabel = status.deviceName ?? "Canvas Pi";
  const domain = status.identity?.hostname ?? canvasDomain;
  const pairingExpired = Boolean(
    pairingExpiresAt && Date.parse(pairingExpiresAt) <= now,
  );
  const viewExpired = Boolean(
    viewExpiresAt && Date.parse(viewExpiresAt) <= now,
  );

  return (
    <section
      className={`canvas-connector canvas-connector--${variant}`}
      aria-labelledby="canvas-connector-heading"
    >
      <header className="canvas-connector__header">
        <div>
          <h2 id="canvas-connector-heading">
            {connected ? "Reshet" : "Connect Reshet"}
          </h2>
          <p>
            {connected
              ? "Published school work, including overdue and submitted items, flows into Organato."
              : "Sign in through a real Canvas browser running on your paired Pi."}
          </p>
        </div>
        <span
          className={`canvas-connector__state canvas-connector__state--${status.state}`}
        >
          {stateLabel(status.state)}
        </span>
      </header>

      {!status.enabled ? (
        <div className="canvas-connector__disabled">
          <AlertCircle size={19} aria-hidden="true" />
          <div>
            <strong>Canvas connector is not enabled</strong>
            <p>
              This deployment has no Canvas Pi connector configured. An
              administrator needs to deploy one before Reshet can be connected.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="canvas-connector__device">
            <span className="canvas-connector__device-mark" aria-hidden="true">
              <Monitor size={21} />
            </span>
            <span>
              <strong>Real browser on {deviceLabel}</strong>
              <small>
                Canvas · {domain}
                {status.paired ? " · Paired" : " · Pair this Pi to begin"}
              </small>
            </span>
            <span className="canvas-connector__device-state">
              {status.paired ? "Paired" : "Needs pairing"}
            </span>
          </div>

          {status.erasurePending ? (
            <p className="canvas-connector__revocation" role="status">
              <ShieldCheck size={15} /> A disconnected Pi has not yet confirmed
              local session removal. It can reconnect once to finish cleanup.
            </p>
          ) : null}

          {recentAuthentication === false ? (
            <div className="canvas-connector__reauthentication">
              <ShieldCheck size={18} aria-hidden="true" />
              <span>
                <strong>Confirm your Google sign-in first</strong>
                <small>
                  Organato asks once before changing the Canvas connector.
                </small>
              </span>
              <button
                type="button"
                className="canvas-connector__primary"
                disabled={busy === "reauthenticate"}
                onClick={() => void confirmAgain()}
              >
                {busy === "reauthenticate"
                  ? "Opening Google…"
                  : "Confirm sign-in"}
              </button>
            </div>
          ) : null}

          {pairingCode ? (
            <div className="canvas-connector__pairing" role="status">
              <div>
                <span className="canvas-connector__eyebrow">
                  Pi pairing code
                </span>
                <strong>{pairingCode}</strong>
                <small>
                  Enter this code in the Pi terminal. Codes expire after 10
                  minutes.
                </small>
              </div>
              <span
                className={
                  pairingExpired
                    ? "canvas-connector__expiry canvas-connector__expiry--expired"
                    : "canvas-connector__expiry"
                }
              >
                {pairingExpired
                  ? "Expired"
                  : `${formatRemaining(pairingExpiresAt, now)} · until ${formatTime(pairingExpiresAt)}`}
              </span>
            </div>
          ) : null}

          {status.state === "unpaired" ? (
            <div className="canvas-connector__prompt">
              <KeyRound size={19} aria-hidden="true" />
              <div>
                <strong>Pair the Canvas Pi</strong>
                <p>
                  Generate a short-lived code, then run the pairing command on
                  the Pi. It will appear here when it is online.
                </p>
                <button
                  type="button"
                  className="canvas-connector__primary"
                  disabled={busy !== null}
                  onClick={() => void pair()}
                >
                  {busy === "pair" ? "Creating code…" : "Create pairing code"}
                </button>
              </div>
            </div>
          ) : null}

          {status.state === "offline" ? (
            <div className="canvas-connector__prompt canvas-connector__prompt--offline">
              <WifiOff size={19} aria-hidden="true" />
              <div>
                <strong>The Canvas Pi is offline</strong>
                <p>
                  The Pi was last seen {formatTime(status.lastSeenAt)}. Check
                  its power and network connection, then refresh this status.
                </p>
                <button
                  type="button"
                  className="canvas-connector__secondary"
                  disabled={busy !== null}
                  onClick={() => {
                    setError(null);
                    void loadStatus().catch((refreshError) =>
                      handleRequestError(
                        refreshError,
                        "Canvas connector status could not be refreshed.",
                      ),
                    );
                  }}
                >
                  <RefreshCw size={14} /> Refresh status
                </button>
              </div>
            </div>
          ) : null}

          {status.state === "ready" || status.state === "login_required" ? (
            <div className="canvas-connector__prompt">
              <Aperture size={19} aria-hidden="true" />
              <div>
                <strong>
                  {status.state === "login_required"
                    ? "Canvas sign-in expired"
                    : "Canvas is ready for sign-in"}
                </strong>
                <p>
                  {status.state === "login_required"
                    ? "The Pi is online, but its Canvas browser session has expired. Start a new sign-in in the remote browser."
                    : "Organato will open a secure browser on the paired Pi. Sign in there, then return here to confirm the account."}
                </p>
                <button
                  type="button"
                  className="canvas-connector__primary"
                  disabled={busy !== null || recentAuthentication !== true}
                  onClick={() => void login()}
                >
                  {busy === "login" ? "Opening browser…" : "Sign in to Canvas"}
                </button>
              </div>
            </div>
          ) : null}

          {status.state === "signing_in" ||
          status.state === "awaiting_confirmation" ? (
            <div className="canvas-connector__session">
              <div className="canvas-connector__session-header">
                <span>
                  <strong>Real browser on {deviceLabel}</strong>
                  <small>Canvas · {domain}</small>
                </span>
                <span
                  className={
                    viewExpired
                      ? "canvas-connector__expiry canvas-connector__expiry--expired"
                      : "canvas-connector__expiry"
                  }
                >
                  {viewExpired
                    ? "Browser expired"
                    : `${formatRemaining(viewExpiresAt ?? status.loginExpiresAt, now)} · 10 min sign-in`}
                </span>
              </div>
              <div className="canvas-connector__screen">
                <div
                  ref={viewerRef}
                  className="canvas-connector__viewer"
                  aria-label="Canvas sign-in browser"
                ></div>
                {!rfbReady ? (
                  <div
                    className="canvas-connector__loading-progress"
                    role="status"
                  >
                    <span>
                      {viewUrl
                        ? "Connecting to your Canvas screen…"
                        : "Opening Canvas on the Pi…"}
                    </span>
                    <progress aria-label="Canvas is loading" />
                    <small>Loading — the first start may take longer</small>
                  </div>
                ) : null}
              </div>
              {viewError ? (
                <div className="canvas-connector__viewer-error" role="alert">
                  <span>
                    {viewError} Organato will retry while sign-in remains open.
                  </span>
                  <button
                    type="button"
                    className="canvas-connector__secondary"
                    disabled={busy !== null || recentAuthentication !== true}
                    onClick={() => void requestView(true)}
                  >
                    <RefreshCw size={14} /> Retry viewing
                  </button>
                </div>
              ) : null}
              <div className="canvas-connector__session-help-row">
                <p className="canvas-connector__session-help">
                  You are signing in on your Pi. Organato relays this session
                  without recording it or saving your password.
                </p>
                {rfbReady ? (
                  <button
                    type="button"
                    className="canvas-connector__secondary canvas-connector__keyboard-button"
                    onClick={showMobileKeyboard}
                  >
                    <KeyboardIcon size={14} aria-hidden="true" /> Show keyboard
                  </button>
                ) : null}
                <input
                  ref={mobileKeyboardRef}
                  className="canvas-connector__keyboard-input"
                  type="password"
                  inputMode="text"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  tabIndex={-1}
                  aria-label="Type in remote Canvas browser"
                  onInput={handleMobileKeyboardInput}
                  onKeyDown={handleMobileKeyboardKeyDown}
                  onBlur={(event) => {
                    event.currentTarget.value = "";
                  }}
                />
              </div>
              {status.state === "signing_in" ? (
                <div className="canvas-connector__form-actions">
                  <button
                    type="button"
                    className="canvas-connector__primary"
                    disabled={busy !== null || recentAuthentication !== true}
                    onClick={() => void verify()}
                  >
                    <UserCheck size={14} />
                    {busy === "verify"
                      ? "Checking account…"
                      : "I have signed in"}
                  </button>
                  <button
                    type="button"
                    className="canvas-connector__secondary"
                    disabled={busy !== null}
                    onClick={() => void closeViewer()}
                  >
                    Close browser
                  </button>
                </div>
              ) : null}
              {status.state === "awaiting_confirmation" ? (
                <div className="canvas-connector__candidate">
                  <div>
                    <span className="canvas-connector__eyebrow">
                      Canvas account found
                    </span>
                    {status.candidateIdentity ? (
                      <strong>{status.candidateIdentity.name}</strong>
                    ) : (
                      <small>Waiting for the verified Canvas account…</small>
                    )}
                    {status.candidateIdentity ? (
                      <small>
                        {status.candidateIdentity.id} ·{" "}
                        {status.candidateIdentity.hostname}
                      </small>
                    ) : null}
                  </div>
                  <div className="canvas-connector__form-actions">
                    <button
                      type="button"
                      className="canvas-connector__primary"
                      disabled={
                        busy !== null ||
                        recentAuthentication !== true ||
                        status.candidateIdentity === null
                      }
                      onClick={() => void confirmIdentity()}
                    >
                      <Check size={14} />
                      {busy === "confirm"
                        ? "Confirming…"
                        : "Confirm this account"}
                    </button>
                    <button
                      type="button"
                      className="canvas-connector__secondary"
                      disabled={busy !== null}
                      onClick={() => void closeViewer()}
                    >
                      Close browser
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {connected && status.identity ? (
            <>
              <div className="canvas-connector__connected">
                <span
                  className="canvas-connector__connected-mark"
                  aria-hidden="true"
                >
                  <Check size={17} />
                </span>
                <span>
                  <strong>Connected as {status.identity.name}</strong>
                  <small>
                    {status.identity.id} · {status.identity.hostname}
                  </small>
                </span>
              </div>
              <div className="canvas-connector__actions">
                <button
                  type="button"
                  className="canvas-connector__primary canvas-connector__primary--quiet"
                  disabled={busy !== null || status.state === "syncing"}
                  onClick={() => void sync()}
                >
                  <span className={busy === "sync" ? "is-spinning" : ""}>
                    <RefreshCw size={14} />
                  </span>
                  {busy === "sync" || status.state === "syncing"
                    ? "Syncing…"
                    : "Sync now"}
                </button>
                <details className="canvas-connector__menu">
                  <summary aria-label="More Canvas actions">
                    <ChevronDown size={16} />
                  </summary>
                  <div>
                    {confirmingDisconnect ? (
                      <>
                        <p role="alert">
                          Disconnect the Pi? Imported work stays. The Pi erases
                          its Canvas session when it reconnects.
                        </p>
                        <button
                          type="button"
                          disabled={
                            busy !== null || recentAuthentication !== true
                          }
                          onClick={() => void disconnect()}
                        >
                          {busy === "disconnect"
                            ? "Disconnecting…"
                            : "Yes, disconnect"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingDisconnect(false)}
                        >
                          Keep connected
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={
                          busy !== null || recentAuthentication !== true
                        }
                        onClick={() => setConfirmingDisconnect(true)}
                      >
                        Disconnect Pi
                      </button>
                    )}
                  </div>
                </details>
              </div>
            </>
          ) : null}

          {status.state === "error" ? (
            <div className="canvas-connector__prompt canvas-connector__prompt--error">
              <AlertCircle size={19} aria-hidden="true" />
              <div>
                <strong>Canvas connector needs attention</strong>
                <p>
                  {status.error ?? "The connector reported an unknown error."}
                </p>
                <button
                  type="button"
                  className="canvas-connector__secondary"
                  disabled={
                    busy !== null ||
                    (!status.identity && recentAuthentication !== true)
                  }
                  onClick={() => void (status.identity ? sync() : login())}
                >
                  <RefreshCw size={14} />
                  {status.identity ? "Try sync again" : "Try sign-in again"}
                </button>
              </div>
            </div>
          ) : null}

          {error ? (
            <p
              className="canvas-connector__message canvas-connector__message--error"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          {status.error && status.state !== "error" ? (
            <p
              className="canvas-connector__message canvas-connector__message--error"
              role="alert"
            >
              {status.error}
            </p>
          ) : null}

          <div className="canvas-connector__activity">
            <h3>Connection activity</h3>
            <p>
              {activityMessage ? (
                <>
                  <Check size={16} /> {activityMessage}
                </>
              ) : status.lastSyncAt ? (
                <>
                  <Clock3 size={16} /> Last sync {formatTime(status.lastSyncAt)}
                </>
              ) : status.lastSeenAt ? (
                <>
                  <Clock3 size={16} /> Pi last seen{" "}
                  {formatTime(status.lastSeenAt)}
                </>
              ) : (
                <>
                  <Clock3 size={16} /> No Canvas activity yet.
                </>
              )}
            </p>
            {status.lastSync && status.state !== "syncing" ? (
              <p role="status">{canvasSyncMessage(status.lastSync)}</p>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
