import type {
  CanvasConnectResponse,
  CanvasConnectionStatus,
} from "@organato/domain";
import {
  CalendarDays,
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  GraduationCap,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Tag,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  beginGoogleConnection,
  type GoogleDeliverySettings,
  IntegrationRequestError,
  integrationRequest,
  reauthenticate,
  type SessionSecurityState,
} from "../../lib/integrationApi";
import { useOrganatoActions } from "../../state/OrganatoProvider";
import { EmailDeliverySection } from "../settings/EmailDeliverySection";
import "./SetupWizard.css";

type SetupStep = 1 | 2 | 3 | 4;

interface SetupWizardProps {
  onDismiss(): void;
}

const setupSteps: Array<{
  id: SetupStep;
  label: string;
}> = [
  { id: 1, label: "Reshet" },
  { id: 2, label: "Calendar & Gmail" },
  { id: 3, label: "Reminder email" },
  { id: 4, label: "Ready" },
];

export function SetupWizard({ onDismiss }: SetupWizardProps) {
  const { dispatch, refresh } = useOrganatoActions();
  const [step, setStep] = useState<SetupStep>(1);
  const [canvas, setCanvas] = useState<CanvasConnectionStatus | null>(null);
  const [google, setGoogle] = useState<GoogleDeliverySettings | null>(null);
  const [cookie, setCookie] = useState("");
  const [showCookie, setShowCookie] = useState(false);
  const [busy, setBusy] = useState<
    "load" | "canvas" | "canvas-probe" | "google" | "reauthenticate" | null
  >("load");
  const [error, setError] = useState<string | null>(null);
  const [needsReauthentication, setNeedsReauthentication] = useState(false);
  const [canvasMessage, setCanvasMessage] = useState<string | null>(null);
  const [emailReady, setEmailReady] = useState(false);
  const [recentAuthentication, setRecentAuthentication] = useState<
    boolean | null
  >(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      integrationRequest<CanvasConnectionStatus>(
        "/api/integrations/canvas/status",
      ),
      integrationRequest<GoogleDeliverySettings>(
        "/api/integrations/google/settings",
      ),
      integrationRequest<SessionSecurityState>("/api/session"),
    ])
      .then(([canvasStatus, googleStatus, sessionStatus]) => {
        if (!active) return;
        setCanvas(canvasStatus);
        setGoogle(googleStatus);
        setRecentAuthentication(sessionStatus.recentAuthentication);
        setNeedsReauthentication(
          !canvasStatus.connection && !sessionStatus.recentAuthentication,
        );
        setStep(!canvasStatus.connection ? 1 : !googleStatus.connected ? 2 : 3);
      })
      .catch((loadError) => {
        if (!active) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Setup could not be loaded.",
        );
      })
      .finally(() => {
        if (active) setBusy(null);
      });
    return () => {
      active = false;
    };
  }, []);

  const completed = useMemo(
    () => ({
      1: Boolean(canvas?.connection),
      2: Boolean(google?.connected),
      3: emailReady,
      4: false,
    }),
    [canvas?.connection, emailReady, google?.connected],
  );

  const handleError = (requestError: unknown) => {
    const reauthenticationRequired =
      requestError instanceof IntegrationRequestError &&
      requestError.code === "reauthentication_required";
    setNeedsReauthentication(reauthenticationRequired);
    if (reauthenticationRequired) {
      setRecentAuthentication(false);
      setCookie("");
      setShowCookie(false);
    }
    setError(
      requestError instanceof Error
        ? requestError.message
        : "Setup could not continue.",
    );
  };

  const connectCanvas = async () => {
    if (!recentAuthentication) {
      setNeedsReauthentication(true);
      setError(
        "Confirm your Google sign-in before entering a Reshet session cookie.",
      );
      return;
    }
    const trimmed = cookie.trim();
    if (trimmed.length < 10) return;
    setBusy("canvas");
    setError(null);
    setCanvasMessage(null);
    try {
      const result = await integrationRequest<CanvasConnectResponse>(
        "/api/integrations/canvas/connect",
        {
          method: "POST",
          body: JSON.stringify({ cookie: trimmed }),
        },
      );
      const nextStatus = await integrationRequest<CanvasConnectionStatus>(
        "/api/integrations/canvas/status",
      );
      setCanvas(nextStatus);
      setCookie("");
      setShowCookie(false);
      setCanvasMessage(
        result.initialSync.status === "failed"
          ? result.initialSync.message
          : `${result.initialSync.fetched} upcoming item${result.initialSync.fetched === 1 ? "" : "s"} checked across ${result.initialSync.courses} course${result.initialSync.courses === 1 ? "" : "s"}.`,
      );
      await refresh().catch(() => undefined);
      setStep(2);
    } catch (requestError) {
      handleError(requestError);
    } finally {
      setBusy(null);
    }
  };

  const connectGoogle = async () => {
    setBusy("google");
    setError(null);
    try {
      await beginGoogleConnection();
    } catch (requestError) {
      handleError(requestError);
      setBusy(null);
    }
  };

  const checkCanvasReachability = async () => {
    setBusy("canvas-probe");
    setError(null);
    setCanvasMessage(null);
    try {
      const result = await integrationRequest<{
        reachable: boolean;
        result: string;
      }>("/api/integrations/canvas/reachability");
      setCanvasMessage(
        result.reachable
          ? "Reshet is reachable from Organato. If validation still fails, copy a fresh session cookie from your browser."
          : `Organato’s server could not reach Reshet (${result.result.replaceAll("_", " ")}).`,
      );
    } catch (requestError) {
      handleError(requestError);
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
      await reauthenticate("/");
    } catch (requestError) {
      handleError(requestError);
      setBusy(null);
    }
  };

  const finish = () => {
    if (!canvas?.connection) {
      setStep(1);
      return;
    }
    if (!google?.connected) {
      setStep(2);
      return;
    }
    if (!emailReady) {
      setStep(3);
      return;
    }
    dispatch({ type: "settings", patch: { onboardingCompleted: true } });
  };

  return (
    <section className="setup-wizard" aria-labelledby="setup-title">
      <header className="setup-wizard__header">
        <div>
          <h1 id="setup-title">Set up your workspace</h1>
          <p>
            Connect the services Organato needs, then choose where reminders
            should arrive.
          </p>
        </div>
        <button
          className="setup-wizard__later"
          onClick={onDismiss}
          type="button"
        >
          Finish later
        </button>
      </header>

      <div className="setup-wizard__layout">
        <nav className="setup-wizard__steps" aria-label="Setup progress">
          {setupSteps.map((entry) => (
            <button
              aria-current={step === entry.id ? "step" : undefined}
              className={
                step === entry.id
                  ? "is-active"
                  : completed[entry.id]
                    ? "is-complete"
                    : ""
              }
              disabled={
                (entry.id === 2 && !completed[1]) ||
                (entry.id === 3 && (!completed[1] || !completed[2])) ||
                (entry.id === 4 &&
                  (!completed[1] || !completed[2] || !completed[3]))
              }
              key={entry.id}
              onClick={() => setStep(entry.id)}
              type="button"
            >
              <span>
                {completed[entry.id] ? <Check size={14} /> : entry.id}
              </span>
              {entry.label}
            </button>
          ))}
        </nav>

        <div className="setup-wizard__content">
          {busy === "load" ? (
            <div className="setup-wizard__loading" aria-label="Loading setup">
              <span />
              <span />
              <span />
            </div>
          ) : null}

          {step === 1 && busy !== "load" ? (
            <div className="setup-step setup-step--canvas">
              <div className="setup-step__form">
                <h2>Connect Reshet</h2>
                <p>
                  Import active courses and upcoming assignments from Emanuel
                  School.
                </p>
                {canvas?.connection ? (
                  <div className="setup-step__connected">
                    <Check size={15} />
                    <span>
                      <strong>Connected as {canvas.connection.userName}</strong>
                      <small>
                        {canvas.counts.activeCourses} active courses ·{" "}
                        {canvas.counts.upcomingItems} upcoming items
                      </small>
                    </span>
                  </div>
                ) : !recentAuthentication ? (
                  <button
                    className="setup-google-account"
                    disabled={busy === "reauthenticate"}
                    onClick={() => void confirmAgain()}
                    type="button"
                  >
                    <ShieldCheck size={18} />
                    <span>
                      <strong>Confirm your Google sign-in</strong>
                      <small>
                        Required once before Organato can securely save a Reshet
                        credential.
                      </small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                ) : (
                  <>
                    <div className="setup-token">
                      <label htmlFor="setup-canvas-cookie">
                        Reshet session cookie
                      </label>
                      <span className="setup-token__input">
                        <LockKeyhole size={16} aria-hidden="true" />
                        <input
                          autoComplete="off"
                          data-1p-ignore="true"
                          data-lpignore="true"
                          id="setup-canvas-cookie"
                          placeholder="Paste your Reshet Cookie value"
                          spellCheck={false}
                          type={showCookie ? "text" : "password"}
                          value={cookie}
                          onChange={(event) => setCookie(event.target.value)}
                        />
                        <button
                          aria-label={
                            showCookie ? "Hide cookie" : "Show cookie"
                          }
                          onClick={() => setShowCookie((current) => !current)}
                          type="button"
                        >
                          {showCookie ? (
                            <EyeOff size={16} />
                          ) : (
                            <Eye size={16} />
                          )}
                        </button>
                      </span>
                    </div>
                    <details className="setup-step__howto">
                      <summary>
                        How to copy the cookie
                        <ChevronRight size={13} />
                      </summary>
                      <ol>
                        <li>Sign in to Reshet in your normal browser.</li>
                        <li>
                          Press F12, open the Network tab, and refresh the page.
                        </li>
                        <li>Click the very first request in the list.</li>
                        <li>
                          Under Request Headers, copy the whole value of the{" "}
                          <code>cookie:</code> line.
                        </li>
                        <li>Paste it above. No API key is needed.</li>
                      </ol>
                    </details>
                    <button
                      className="setup-step__probe"
                      disabled={busy === "canvas-probe"}
                      onClick={() => void checkCanvasReachability()}
                      type="button"
                    >
                      {busy === "canvas-probe"
                        ? "Checking Reshet…"
                        : "Check Reshet availability"}
                    </button>
                    <p className="setup-step__privacy">
                      <ShieldCheck size={14} />
                      Read-only. Stored encrypted and never shown again.
                    </p>
                  </>
                )}
                {error ? (
                  <p className="setup-step__error" role="alert">
                    {error}
                  </p>
                ) : null}
                {canvasMessage ? (
                  <p className="setup-step__success">
                    <Check size={14} /> {canvasMessage}
                  </p>
                ) : null}
                <div className="setup-step__actions">
                  {canvas?.connection ? (
                    <button
                      className="setup-step__primary"
                      onClick={() => setStep(2)}
                      type="button"
                    >
                      Continue
                    </button>
                  ) : recentAuthentication ? (
                    <button
                      className="setup-step__primary"
                      disabled={busy === "canvas" || cookie.trim().length < 10}
                      onClick={() => void connectCanvas()}
                      type="button"
                    >
                      {busy === "canvas"
                        ? "Verifying and importing…"
                        : "Connect and import"}
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="setup-step__explanation">
                <div>
                  <GraduationCap size={19} />
                  <span>
                    <strong>Verify your account</strong>
                    <small>
                      Organato checks your Reshet session against Emanuel
                      School.
                    </small>
                  </span>
                </div>
                <div>
                  <CalendarDays size={19} />
                  <span>
                    <strong>Import upcoming work</strong>
                    <small>
                      Active courses and future assignments are checked.
                    </small>
                  </span>
                </div>
                <div>
                  <Tag size={19} />
                  <span>
                    <strong>Classify on Home</strong>
                    <small>
                      New items wait safely until you classify them.
                    </small>
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          {step === 2 && busy !== "load" ? (
            <div className="setup-step setup-step--google">
              <div className="setup-step__form">
                <h2>Connect Calendar & Gmail</h2>
                <p>
                  Use your personal Gmail account for the private Organato
                  calendar and outgoing reminders.
                </p>
                {google?.connected ? (
                  <div className="setup-step__connected">
                    <Check size={15} />
                    <span>
                      <strong>Connected as {google.sender}</strong>
                      <small>
                        Calendar events and Gmail sending are authorized.
                      </small>
                    </span>
                  </div>
                ) : (
                  <button
                    className="setup-google-account"
                    disabled={busy === "google"}
                    onClick={() => void connectGoogle()}
                    type="button"
                  >
                    <Mail size={18} />
                    <span>
                      <strong>Connect your personal Gmail</strong>
                      <small>
                        Calendar & Gmail send only · your inbox is never read
                      </small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                )}
                {error ? (
                  <p className="setup-step__error" role="alert">
                    {error}
                  </p>
                ) : null}
                <div className="setup-step__actions">
                  {google?.connected ? (
                    <button
                      className="setup-step__primary"
                      onClick={() => setStep(3)}
                      type="button"
                    >
                      Continue
                    </button>
                  ) : null}
                  {needsReauthentication ? (
                    <button
                      className="setup-step__secondary"
                      disabled={Boolean(busy)}
                      onClick={() => void confirmAgain()}
                      type="button"
                    >
                      Confirm Google sign-in
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="setup-step__explanation">
                <div>
                  <CalendarDays size={19} />
                  <span>
                    <strong>One dedicated calendar</strong>
                    <small>
                      Organato never reads or changes unrelated events.
                    </small>
                  </span>
                </div>
                <div>
                  <Mail size={19} />
                  <span>
                    <strong>Send only</strong>
                    <small>
                      Gmail permission cannot read messages, contacts, or
                      threads.
                    </small>
                  </span>
                </div>
                <div>
                  <ShieldCheck size={19} />
                  <span>
                    <strong>Personal integration owner</strong>
                    <small>
                      Your school administrator does not need to approve these
                      scopes.
                    </small>
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          {step === 3 && busy !== "load" ? (
            <div className="setup-step setup-step--email">
              <div className="setup-step__form">
                <h2>Choose your reminder email</h2>
                <p>
                  Send from your connected Gmail account to the school address
                  where you want to see reminders.
                </p>
                <EmailDeliverySection
                  onReady={() => {
                    setEmailReady(true);
                    if (canvas?.connection) {
                      setStep(4);
                    } else {
                      setCanvasMessage(
                        "Email delivery is ready. Connect Reshet to finish setup.",
                      );
                      setStep(1);
                    }
                  }}
                  onWorkspaceRefresh={refresh}
                  variant="setup"
                />
              </div>
              <div className="setup-step__explanation">
                <div>
                  <Mail size={19} />
                  <span>
                    <strong>School email is supported</strong>
                    <small>
                      It can receive reminders even when school policy blocks
                      sign-in.
                    </small>
                  </span>
                </div>
                <div>
                  <Check size={19} />
                  <span>
                    <strong>Test before finishing</strong>
                    <small>
                      Setup advances only after Gmail accepts a real test
                      message.
                    </small>
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          {step === 4 && busy !== "load" ? (
            <div className="setup-step setup-step--ready">
              <span className="setup-ready-mark">
                <Check size={22} />
              </span>
              <h2>Your workspace is ready</h2>
              <p>
                Organato can import upcoming school work, keep its calendar in
                sync, and send reminders to the address you chose.
              </p>
              <ul>
                <li>
                  <Check size={14} /> Reshet connected
                </li>
                <li>
                  <Check size={14} /> Calendar & Gmail connected
                </li>
                <li>
                  <Check size={14} /> Reminder preview accepted by Gmail
                </li>
              </ul>
              <button
                className="setup-step__primary"
                onClick={finish}
                type="button"
              >
                Open Organato
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
