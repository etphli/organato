import { AlertCircle, Check, Mail, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  beginGoogleConnection,
  IntegrationRequestError,
  integrationRequest,
  reauthenticate,
  type GoogleDeliverySettings,
} from "../../lib/integrationApi";
import "./EmailDeliverySection.css";

function parseRecipients(value: string): string[] {
  const seen = new Set<string>();
  for (const part of value.split(",")) {
    const normalized = part.trim().toLowerCase();
    if (normalized) seen.add(normalized);
    if (seen.size >= 5) break;
  }
  return [...seen];
}

interface EmailDeliverySectionProps {
  variant?: "settings" | "setup";
  onReady?: () => void;
  onWorkspaceRefresh?: () => Promise<void>;
}

export function EmailDeliverySection({
  variant = "settings",
  onReady,
  onWorkspaceRefresh,
}: EmailDeliverySectionProps) {
  const [settings, setSettings] = useState<GoogleDeliverySettings | null>(null);
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState<
    "connect" | "save" | "test" | "reauthenticate" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [needsReauthentication, setNeedsReauthentication] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const next = await integrationRequest<GoogleDeliverySettings>(
      "/api/integrations/google/settings",
    );
    setSettings(next);
    setRecipient(
      next.recipients.length ? next.recipients.join(", ") : (next.sender ?? ""),
    );
    return next;
  }, []);

  useEffect(() => {
    void load().catch((loadError) => {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Email settings could not be loaded.",
      );
    });
  }, [load]);

  const handleError = (requestError: unknown) => {
    const reauthenticationRequired =
      requestError instanceof IntegrationRequestError &&
      requestError.code === "reauthentication_required";
    setNeedsReauthentication(reauthenticationRequired);
    setError(
      requestError instanceof Error
        ? requestError.message
        : "Email settings could not be updated.",
    );
  };

  const saveRecipient = async () => {
    const recipients = parseRecipients(recipient);
    if (!recipients.length) return null;
    setBusy("save");
    setError(null);
    setMessage(null);
    try {
      const next = await integrationRequest<GoogleDeliverySettings>(
        "/api/integrations/google/recipients",
        {
          method: "PUT",
          body: JSON.stringify({ recipients }),
        },
      );
      setSettings(next);
      setRecipient(next.recipients.join(", "));
      setMessage(`Reminders will go to ${recipients.join(", ")}.`);
      return next;
    } catch (requestError) {
      handleError(requestError);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const sendTest = async () => {
    const recipients = parseRecipients(recipient);
    if (!recipients.length) return;
    setBusy("test");
    setError(null);
    setMessage(null);
    try {
      const saved = parseRecipients(settings?.recipients.join(", ") ?? "");
      const next =
        saved.length === recipients.length &&
        saved.every((entry, index) => entry === recipients[index])
          ? settings
          : await integrationRequest<GoogleDeliverySettings>(
              "/api/integrations/google/recipients",
              {
                method: "PUT",
                body: JSON.stringify({ recipients }),
              },
            );
      await integrationRequest<{ ok: true; messageId: string }>(
        "/api/integrations/google/test-email",
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      );
      if (next) setSettings(next);
      setMessage(`Reminder preview sent to ${recipients.join(", ")}.`);
      await onWorkspaceRefresh?.().catch(() => undefined);
      onReady?.();
    } catch (requestError) {
      handleError(requestError);
    } finally {
      setBusy(null);
    }
  };

  const connect = async () => {
    setBusy("connect");
    setError(null);
    try {
      await beginGoogleConnection();
    } catch (requestError) {
      handleError(requestError);
      setBusy(null);
    }
  };

  const confirmAgain = async () => {
    setBusy("reauthenticate");
    setError(null);
    try {
      await reauthenticate();
    } catch (requestError) {
      handleError(requestError);
      setBusy(null);
    }
  };

  if (!settings && !error) {
    return (
      <section
        className={`email-delivery email-delivery--${variant}`}
        aria-label="Loading email delivery settings"
        aria-busy="true"
      >
        <span className="email-delivery__loading" />
      </section>
    );
  }

  if (!settings?.connected) {
    return (
      <section className={`email-delivery email-delivery--${variant}`}>
        <div className="email-delivery__identity">
          <Mail size={19} strokeWidth={1.6} aria-hidden="true" />
          <span>
            <strong>Calendar & Gmail</strong>
            <small>
              Connect your personal Gmail account to send reminders.
            </small>
          </span>
        </div>
        {error ? (
          <p className="email-delivery__message email-delivery__message--error">
            <AlertCircle size={15} /> {error}
          </p>
        ) : null}
        <button
          className="email-delivery__primary"
          disabled={Boolean(busy)}
          onClick={() => void connect()}
          type="button"
        >
          {busy === "connect" ? "Opening Google…" : "Connect Calendar & Gmail"}
        </button>
        {needsReauthentication ? (
          <button
            className="email-delivery__secondary"
            disabled={Boolean(busy)}
            onClick={() => void confirmAgain()}
            type="button"
          >
            Confirm Google sign-in
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <section className={`email-delivery email-delivery--${variant}`}>
      <div className="email-delivery__identity">
        <span className="email-delivery__connected" aria-hidden="true">
          <Check size={14} />
        </span>
        <span>
          <strong>Sending from {settings.sender}</strong>
          <small>
            Gmail sends only. Organato cannot read this account’s inbox.
          </small>
        </span>
      </div>
      <div className="email-delivery__field">
        <label htmlFor="email-delivery-recipient">Send reminders to</label>
        <input
          aria-describedby="email-delivery-recipient-help"
          autoComplete="email"
          id="email-delivery-recipient"
          inputMode="email"
          placeholder="you@school.edu.au, parent@example.com"
          type="text"
          value={recipient}
          onChange={(event) => setRecipient(event.target.value)}
        />
        <small id="email-delivery-recipient-help">
          Up to five addresses, separated by commas. Use any valid email,
          including a school address that cannot sign in to Organato.
        </small>
      </div>
      {error ? (
        <p className="email-delivery__message email-delivery__message--error">
          <AlertCircle size={15} /> {error}
        </p>
      ) : null}
      {message ? (
        <p className="email-delivery__message email-delivery__message--success">
          <Check size={15} /> {message}
        </p>
      ) : null}
      <div className="email-delivery__actions">
        <button
          className="email-delivery__secondary"
          disabled={Boolean(busy) || !recipient.trim()}
          onClick={() => void saveRecipient()}
          type="button"
        >
          {busy === "save" ? "Saving…" : "Save recipients"}
        </button>
        <button
          className="email-delivery__primary"
          disabled={Boolean(busy) || !recipient.trim()}
          onClick={() => void sendTest()}
          type="button"
        >
          <Send size={14} />
          {busy === "test" ? "Sending…" : "Send reminder preview"}
        </button>
        {needsReauthentication ? (
          <button
            className="email-delivery__secondary"
            disabled={Boolean(busy)}
            onClick={() => void confirmAgain()}
            type="button"
          >
            Confirm Google sign-in
          </button>
        ) : null}
      </div>
    </section>
  );
}
