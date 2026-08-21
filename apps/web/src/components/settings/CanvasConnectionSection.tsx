import type {
  CanvasConnectResponse,
  CanvasConnectionStatus,
} from "@organato/domain";
import {
  Aperture,
  Check,
  ChevronDown,
  Clock3,
  Eye,
  EyeOff,
  LockKeyhole,
  MoreHorizontal,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  IntegrationRequestError,
  integrationRequest,
  reauthenticate,
  type SessionSecurityState,
} from "../../lib/integrationApi";
import "./CanvasConnectionSection.css";

type RequestJson = (path: string, init?: RequestInit) => Promise<unknown>;

export interface CanvasConnectionSectionProps {
  initialStatus?: CanvasConnectionStatus;
  request?: RequestJson;
  onWorkspaceRefresh?: () => Promise<void>;
}

const demoDisconnectedStatus: CanvasConnectionStatus = {
  installation: {
    name: "Emanuel School Canvas",
    hostname: "emanuel.instructure.com",
    readOnly: true,
  },
  state: "disconnected",
  connection: null,
  counts: { activeCourses: 0, upcomingItems: 0 },
  latestSync: null,
};

function demoConnectedStatus(): CanvasConnectionStatus {
  const now = new Date();
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return {
    ...demoDisconnectedStatus,
    state: "healthy",
    connection: {
      userId: "demo-owner",
      userName: "Ethan Likht",
      connectedAt: now.toISOString(),
      lastValidatedAt: now.toISOString(),
      lastSuccessfulSyncAt: now.toISOString(),
      nextExpectedSyncAt: next.toISOString(),
    },
    counts: { activeCourses: 6, upcomingItems: 14 },
    latestSync: {
      startedAt: now.toISOString(),
      finishedAt: now.toISOString(),
      result: "success",
      fetched: 14,
      created: 14,
      updated: 0,
      archived: 0,
    },
  };
}

function formatTime(value: string | null): string {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusLabel(status: CanvasConnectionStatus): string {
  if (!status.connection) return "Not connected";
  if (status.state === "healthy") return "Connected";
  if (status.state === "partial") return "Connected · needs review";
  if (status.state === "delayed") return "Sync delayed";
  return "Action needed";
}

export function CanvasConnectionSection({
  initialStatus,
  request,
  onWorkspaceRefresh,
}: CanvasConnectionSectionProps) {
  const demoMode = !request && import.meta.env.VITE_DEMO_MODE === "true";
  const requestJson = request ?? integrationRequest;
  const [status, setStatus] = useState<CanvasConnectionStatus | null>(
    initialStatus ?? (demoMode ? demoDisconnectedStatus : null),
  );
  const [cookie, setCookie] = useState("");
  const [showCookie, setShowCookie] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState<
    "connect" | "sync" | "disconnect" | "reauthenticate" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [cookieRejected, setCookieRejected] = useState(false);
  const [recentAuthentication, setRecentAuthentication] = useState<
    boolean | null
  >(demoMode ? true : null);
  const [activityMessage, setActivityMessage] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    if (demoMode) return;
    const next = (await requestJson(
      "/api/integrations/canvas/status",
    )) as CanvasConnectionStatus;
    setStatus(next);
  }, [demoMode, requestJson]);

  const loadSessionSecurity = useCallback(async () => {
    if (demoMode) return;
    const session = (await requestJson("/api/session")) as SessionSecurityState;
    setRecentAuthentication(session.recentAuthentication);
  }, [demoMode, requestJson]);

  useEffect(() => {
    if (demoMode) return;
    void Promise.all([
      initialStatus ? Promise.resolve() : loadStatus(),
      loadSessionSecurity(),
    ]).catch((loadError) => {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Reshet status could not be loaded.",
      );
    });
  }, [demoMode, initialStatus, loadSessionSecurity, loadStatus]);

  const refreshAfterMutation = async () => {
    await loadStatus();
    await onWorkspaceRefresh?.().catch(() => undefined);
  };

  const connect = async () => {
    if (!recentAuthentication) {
      setError(
        "Confirm your Google sign-in before entering a Reshet session cookie.",
      );
      return;
    }
    const trimmedCookie = cookie.trim();
    if (trimmedCookie.length < 10) return;
    setBusy("connect");
    setError(null);
    setCookieRejected(false);
    setActivityMessage(null);
    try {
      if (demoMode) {
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        setStatus(demoConnectedStatus());
        setActivityMessage("14 upcoming items imported from 6 courses.");
      } else {
        const result = (await requestJson("/api/integrations/canvas/connect", {
          method: "POST",
          body: JSON.stringify({ cookie: trimmedCookie }),
        })) as CanvasConnectResponse;
        await refreshAfterMutation();
        setActivityMessage(
          result.initialSync.status === "failed"
            ? result.initialSync.message
            : `${result.initialSync.fetched} upcoming items checked across ${result.initialSync.courses} courses.`,
        );
      }
      setCookie("");
      setShowCookie(false);
      setReplacing(false);
    } catch (connectError) {
      const reauthenticationRequired =
        connectError instanceof IntegrationRequestError &&
        connectError.code === "reauthentication_required";
      const rejected =
        connectError instanceof IntegrationRequestError &&
        connectError.code === "session_rejected";
      setCookieRejected(rejected);
      if (reauthenticationRequired) {
        setRecentAuthentication(false);
        setCookie("");
        setShowCookie(false);
      }
      setError(
        connectError instanceof Error
          ? connectError.message
          : "Reshet could not be connected.",
      );
    } finally {
      setBusy(null);
    }
  };

  const confirmAgain = async () => {
    setBusy("reauthenticate");
    setError(null);
    setCookie("");
    setShowCookie(false);
    try {
      await reauthenticate("/settings/canvas");
    } catch (reauthenticationError) {
      setError(
        reauthenticationError instanceof Error
          ? reauthenticationError.message
          : "Google sign-in could not be opened.",
      );
      setBusy(null);
    }
  };

  const sync = async () => {
    setBusy("sync");
    setError(null);
    try {
      if (demoMode) {
        await new Promise((resolve) => window.setTimeout(resolve, 300));
        setStatus(demoConnectedStatus());
      } else {
        await requestJson("/api/integrations/canvas/sync", {
          method: "POST",
          body: JSON.stringify({}),
        });
        await refreshAfterMutation();
      }
      setActivityMessage("Reshet is up to date.");
    } catch (syncError) {
      setError(
        syncError instanceof Error
          ? syncError.message
          : "Reshet could not be synced.",
      );
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (
      !window.confirm(
        "Disconnect Reshet? Imported items will remain in Organato.",
      )
    ) {
      return;
    }
    setBusy("disconnect");
    setError(null);
    try {
      if (demoMode) {
        setStatus(demoDisconnectedStatus);
      } else {
        const next = (await requestJson("/api/integrations/canvas/disconnect", {
          method: "POST",
          body: JSON.stringify({}),
        })) as CanvasConnectionStatus;
        setStatus(next);
        await onWorkspaceRefresh?.().catch(() => undefined);
      }
      setActivityMessage(
        "Reshet disconnected. Imported items remain in Organato.",
      );
    } catch (disconnectError) {
      setError(
        disconnectError instanceof Error
          ? disconnectError.message
          : "Reshet could not be disconnected.",
      );
    } finally {
      setBusy(null);
    }
  };

  if (!status && error) {
    return (
      <section className="canvas-connection" aria-labelledby="reshet-heading">
        <header className="canvas-connection__header">
          <h2 id="reshet-heading">Reshet</h2>
          <p>Canvas connection settings could not be loaded.</p>
        </header>
        <p className="canvas-connection__message canvas-connection__message--error">
          {error}
        </p>
        <button
          type="button"
          className="canvas-connection__secondary"
          onClick={() => {
            setError(null);
            void loadStatus().catch((loadError) =>
              setError(
                loadError instanceof Error
                  ? loadError.message
                  : "Reshet status could not be loaded.",
              ),
            );
          }}
        >
          Try again
        </button>
      </section>
    );
  }

  if (!status || recentAuthentication === null) {
    return (
      <section
        className="canvas-connection canvas-connection--loading"
        aria-label="Loading Reshet connection"
      >
        <span />
        <span />
        <span />
      </section>
    );
  }

  const connected = Boolean(status.connection);
  const showCredentialForm = !connected || replacing;

  return (
    <section className="canvas-connection" aria-labelledby="reshet-heading">
      <header className="canvas-connection__header">
        <h2 id="reshet-heading">{connected ? "Reshet" : "Connect Reshet"}</h2>
        <p>
          {connected
            ? "Upcoming school work flows into Organato automatically."
            : "Bring upcoming work from Emanuel School into Organato."}
        </p>
      </header>

      <div className="canvas-connection__school">
        <span className="canvas-connection__school-mark" aria-hidden="true">
          <Aperture size={25} strokeWidth={1.7} />
        </span>
        <span>
          <strong>{status.installation.name}</strong>
          <small>
            {status.installation.hostname} ·{" "}
            {status.installation.readOnly ? "Read-only" : ""}
          </small>
        </span>
        <span
          className={`canvas-connection__state canvas-connection__state--${status.state}`}
        >
          {statusLabel(status)}
        </span>
      </div>

      {showCredentialForm && recentAuthentication ? (
        <div className="canvas-connection__credential">
          <label htmlFor="canvas-session-cookie">Reshet session cookie</label>
          <div className="canvas-connection__cookie-field">
            <LockKeyhole size={17} aria-hidden="true" />
            <input
              id="canvas-session-cookie"
              type={showCookie ? "text" : "password"}
              autoComplete="off"
              data-1p-ignore="true"
              data-lpignore="true"
              spellCheck={false}
              value={cookie}
              onChange={(event) => {
                setCookie(event.target.value);
                setCookieRejected(false);
                setError(null);
              }}
              placeholder="Paste your Reshet Cookie value"
            />
            <button
              type="button"
              aria-label={showCookie ? "Hide cookie" : "Show cookie"}
              onClick={() => setShowCookie((visible) => !visible)}
            >
              {showCookie ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <details className="canvas-connection__howto">
            <summary>
              Where do I find this? <ChevronDown size={14} />
            </summary>
            <ol>
              <li>Sign in to Reshet in your normal browser.</li>
              <li>
                Press F12 to open developer tools and switch to the Network tab.
              </li>
              <li>Refresh the page, then click the very first request.</li>
              <li>
                Under Request Headers, copy the whole value of the{" "}
                <code>cookie:</code> line.
              </li>
              <li>Paste it above. No API key is needed.</li>
            </ol>
          </details>
          <p>
            Used only to read your courses and upcoming assignments. No API key
            required.
          </p>
          <div className="canvas-connection__form-actions">
            <button
              type="button"
              className="canvas-connection__primary"
              disabled={
                busy === "connect" ||
                cookieRejected ||
                cookie.trim().length < 10
              }
              onClick={() => void connect()}
            >
              {busy === "connect"
                ? replacing
                  ? "Replacing…"
                  : "Connecting…"
                : replacing
                  ? "Replace session"
                  : "Connect Reshet"}
            </button>
            {replacing ? (
              <button
                type="button"
                className="canvas-connection__secondary"
                onClick={() => {
                  setReplacing(false);
                  setCookie("");
                  setCookieRejected(false);
                  setError(null);
                }}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {showCredentialForm && !recentAuthentication ? (
        <div className="canvas-connection__reauthentication">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>
            <strong>Confirm your Google sign-in first</strong>
            <small>
              Organato asks once before securely saving or replacing a Reshet
              credential.
            </small>
          </span>
          <button
            type="button"
            className="canvas-connection__primary"
            disabled={busy === "reauthenticate"}
            onClick={() => void confirmAgain()}
          >
            {busy === "reauthenticate" ? "Opening Google…" : "Confirm sign-in"}
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="canvas-connection__message canvas-connection__message--error">
          {error}
        </p>
      ) : null}
      {connected && status.connection ? (
        <>
          <div className="canvas-connection__summary">
            <div>
              <small>Connected as</small>
              <strong>{status.connection.userName}</strong>
            </div>
            <div>
              <small>Active courses</small>
              <strong>{status.counts.activeCourses}</strong>
            </div>
            <div>
              <small>Upcoming items</small>
              <strong>{status.counts.upcomingItems}</strong>
            </div>
          </div>
          <div className="canvas-connection__actions">
            <button
              type="button"
              className="canvas-connection__primary canvas-connection__primary--quiet"
              disabled={busy === "sync"}
              onClick={() => void sync()}
            >
              <span className={busy === "sync" ? "is-spinning" : ""}>
                <RefreshCw size={14} />
              </span>
              {busy === "sync" ? "Syncing…" : "Sync now"}
            </button>
            <details className="canvas-connection__menu">
              <summary aria-label="More Reshet actions">
                <MoreHorizontal size={18} />
              </summary>
              <div>
                <button
                  type="button"
                  onClick={(event) => {
                    event.currentTarget
                      .closest("details")
                      ?.removeAttribute("open");
                    setReplacing(true);
                    setActivityMessage(null);
                    setError(null);
                  }}
                >
                  Replace session
                </button>
                <button
                  type="button"
                  className="canvas-connection__danger"
                  disabled={busy === "disconnect"}
                  onClick={(event) => {
                    event.currentTarget
                      .closest("details")
                      ?.removeAttribute("open");
                    void disconnect();
                  }}
                >
                  Disconnect
                </button>
              </div>
            </details>
          </div>
        </>
      ) : (
        <>
          <details className="canvas-connection__different-school">
            <summary>
              Use a different Canvas school <ChevronDown size={16} />
            </summary>
            <p>
              This private workspace is securely pinned to Emanuel School. A
              self-hosted deployment can configure another Canvas installation
              without exposing its address here.
            </p>
          </details>
          <div className="canvas-connection__next">
            <h3>What happens next</h3>
            <ol>
              <li>
                <span>1</span> Verify your Emanuel account
              </li>
              <li>
                <span>2</span> Import active courses and upcoming assignments
              </li>
              <li>
                <span>3</span> New work appears in Home for classification
              </li>
            </ol>
          </div>
        </>
      )}

      <div className="canvas-connection__activity">
        <h3>Connection activity</h3>
        <p>
          {activityMessage ? (
            <>
              <Check size={16} /> {activityMessage}
            </>
          ) : status.latestSync ? (
            <>
              <Clock3 size={16} /> Last sync{" "}
              {formatTime(status.latestSync.finishedAt)}
            </>
          ) : (
            <>
              <Clock3 size={16} /> No Canvas connection yet.
            </>
          )}
        </p>
        {connected && status.connection?.nextExpectedSyncAt ? (
          <small>
            Next automatic check{" "}
            {formatTime(status.connection.nextExpectedSyncAt)}
          </small>
        ) : null}
      </div>
    </section>
  );
}
