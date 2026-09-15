import {
  CalendarDays,
  Check,
  ChevronRight,
  GraduationCap,
  Mail,
  ShieldCheck,
  Tag,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  beginGoogleConnection,
  type GoogleDeliverySettings,
  IntegrationRequestError,
  integrationRequest,
  reauthenticate,
} from "../../lib/integrationApi";
import { useOrganatoActions } from "../../state/OrganatoProvider";
import {
  CanvasConnectorSection,
  canvasConnectorIsConnected,
  type CanvasConnectorStatus,
} from "../settings/CanvasConnectorSection";
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
  const [step, setStep] = useState<SetupStep>(() => {
    const saved = Number(sessionStorage.getItem("organato_setup_step"));
    return saved === 2 || saved === 3 || saved === 4 ? saved : 1;
  });
  const [canvas, setCanvas] = useState<CanvasConnectorStatus | null>(null);
  const [google, setGoogle] = useState<GoogleDeliverySettings | null>(null);
  const [busy, setBusy] = useState<"load" | "google" | "reauthenticate" | null>(
    "load",
  );
  const [error, setError] = useState<string | null>(null);
  const [needsReauthentication, setNeedsReauthentication] = useState(false);
  const [canvasMessage, setCanvasMessage] = useState<string | null>(null);
  const [emailReady, setEmailReady] = useState(
    () => sessionStorage.getItem("organato_setup_email_ready") === "true",
  );

  // A reload mid-setup resumes where the user left off instead of forcing
  // the email test (and its recipient entry) to be redone.
  useEffect(() => {
    sessionStorage.setItem("organato_setup_step", String(step));
  }, [step]);
  useEffect(() => {
    sessionStorage.setItem(
      "organato_setup_email_ready",
      emailReady ? "true" : "false",
    );
  }, [emailReady]);

  const handleCanvasStatus = useCallback(
    (nextStatus: CanvasConnectorStatus) => {
      setCanvas(nextStatus);
      if (canvasConnectorIsConnected(nextStatus)) {
        setStep((currentStep) => (currentStep === 1 ? 2 : currentStep));
      }
    },
    [],
  );

  useEffect(() => {
    let active = true;
    void Promise.all([
      integrationRequest<GoogleDeliverySettings>(
        "/api/integrations/google/settings",
      ),
    ])
      .then(([googleStatus]) => {
        if (!active) return;
        setGoogle(googleStatus);
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
      1: Boolean(canvas && canvasConnectorIsConnected(canvas)),
      2: Boolean(google?.connected),
      3: emailReady,
      4: false,
    }),
    [canvas, emailReady, google?.connected],
  );

  const handleError = (requestError: unknown) => {
    const reauthenticationRequired =
      requestError instanceof IntegrationRequestError &&
      requestError.code === "reauthentication_required";
    setNeedsReauthentication(reauthenticationRequired);
    setError(
      requestError instanceof Error
        ? requestError.message
        : "Setup could not continue.",
    );
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

  const confirmGoogleAgain = async () => {
    setBusy("reauthenticate");
    setError(null);
    try {
      await reauthenticate("/");
    } catch (requestError) {
      handleError(requestError);
      setBusy(null);
    }
  };

  const finish = () => {
    if (!canvas || !canvasConnectorIsConnected(canvas)) {
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
              title={
                entry.id === 2 && !completed[1]
                  ? "Connect Reshet first"
                  : entry.id === 3 && (!completed[1] || !completed[2])
                    ? "Connect Reshet and Google first"
                    : entry.id === 4 &&
                        (!completed[1] || !completed[2] || !completed[3])
                      ? "Finish the earlier steps first"
                      : undefined
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
              <div className="setup-step__form setup-step__form--connector">
                <CanvasConnectorSection
                  onStatusChange={handleCanvasStatus}
                  onWorkspaceRefresh={refresh}
                  returnTo="/"
                  variant="setup"
                />
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
                  Use the same Google account you signed in with for the private
                  Organato calendar and outgoing reminders — Google requires the
                  match.
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
                      onClick={() => void confirmGoogleAgain()}
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
                    if (canvas && canvasConnectorIsConnected(canvas)) {
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
