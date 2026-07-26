import { Check, KeyRound, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuthOwner } from "../AuthGate";
import { useOrganato } from "../../state/OrganatoProvider";
import { ActiveSessions } from "./ActiveSessions";

interface AllowedIdentity {
  email_normalized: string;
  display_name: string;
  google_subject: string | null;
  enabled: number;
  is_owner: number;
  last_login_at: string | null;
  created_at: string;
  is_current: number;
}

interface IdentityResponse {
  identities: AllowedIdentity[];
  integrationOwnerEmail: string | null;
}

function initials(value: string) {
  return value
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function lastSignIn(value: string | null) {
  if (!value) return "Awaiting first verified sign-in";
  return `Last signed in ${new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value))}`;
}

export function AccountAccessSection() {
  const owner = useAuthOwner();
  const { dispatch, settings } = useOrganato();
  const demoMode = import.meta.env.VITE_DEMO_MODE === "true";
  const [data, setData] = useState<IdentityResponse | null>(() =>
    demoMode
      ? {
          identities: [
            {
              email_normalized: owner?.email ?? "owner@example.com",
              display_name: owner?.displayName ?? "Alex Smith",
              google_subject: "demo-owner",
              enabled: 1,
              is_owner: 1,
              last_login_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
              is_current: 1,
            },
          ],
          integrationOwnerEmail: owner?.email ?? "owner@example.com",
        }
      : null,
  );
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const displayName = owner?.displayName || owner?.email || "Owner";

  const request = async <T,>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> => {
    const headers = new Headers(init.headers);
    if (init.method && !["GET", "HEAD"].includes(init.method)) {
      headers.set("Content-Type", "application/json");
      headers.set(
        "X-CSRF-Token",
        sessionStorage.getItem("organato_csrf") ?? "",
      );
    }
    const response = await fetch(path, {
      ...init,
      headers,
      credentials: "same-origin",
    });
    const result = (await response.json().catch(() => ({}))) as T & {
      error?: string;
      code?: string;
    };
    if (!response.ok) {
      throw new Error(
        result.code === "reauthentication_required"
          ? "Confirm your Google sign-in from Settings → Security, then retry."
          : (result.error ?? "Account access could not be updated."),
      );
    }
    return result;
  };

  const refresh = async () => {
    if (demoMode) return;
    setError(null);
    try {
      setData(await request<IdentityResponse>("/api/identities"));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Approved accounts could not be loaded.",
      );
    }
  };

  useEffect(() => {
    void refresh();
    // The request helper intentionally has no stateful dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoMode]);

  const orderedIdentities = useMemo(
    () =>
      [...(data?.identities ?? [])].sort(
        (left, right) =>
          Number(right.is_current) - Number(left.is_current) ||
          Number(right.enabled) - Number(left.enabled) ||
          left.email_normalized.localeCompare(right.email_normalized),
      ),
    [data],
  );

  const runMutation = async (
    key: string,
    path: string,
    init: RequestInit,
    success: string,
  ) => {
    setBusy(key);
    setError(null);
    try {
      if (!demoMode) await request(path, init);
      await refresh();
      dispatch({ type: "toast", message: success });
      return true;
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Account access could not be updated.",
      );
      return false;
    } finally {
      setBusy(null);
    }
  };

  const addIdentity = async (event: FormEvent) => {
    event.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!normalized) return;
    const added = await runMutation(
      `add:${normalized}`,
      "/api/identities",
      {
        method: "POST",
        body: JSON.stringify({ email: normalized }),
      },
      `${normalized} approved for Google verification`,
    );
    if (added) setEmail("");
  };

  const chooseIntegrationOwner = async (identity: AllowedIdentity) => {
    const key = `owner:${identity.email_normalized}`;
    setBusy(key);
    setError(null);
    try {
      if (demoMode) {
        setData((current) =>
          current
            ? {
                ...current,
                integrationOwnerEmail: identity.email_normalized,
              }
            : current,
        );
        return;
      }
      const result = await request<{ googleReconnectRequired: boolean }>(
        `/api/identities/${encodeURIComponent(identity.email_normalized)}/integration-owner`,
        { method: "POST", body: "{}" },
      );
      if (result.googleReconnectRequired) {
        const connection = await request<{ authorizationUrl: string }>(
          "/api/integrations/google/start",
          { method: "POST", body: "{}" },
        );
        window.location.assign(connection.authorizationUrl);
        return;
      }
      await refresh();
      dispatch({ type: "toast", message: "Integration owner updated" });
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Integration owner could not be updated.",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="settings-block">
        <h3>Profile</h3>
        <div className="field-row">
          <span>
            Display name<small>Provided by your verified Google account.</small>
          </span>
          <span className="field-value">{displayName}</span>
        </div>
        <div className="field-row">
          <span>
            Workspace timezone
            <small>Daylight-saving aware for dates and reminders.</small>
          </span>
          <span className="field-value">{settings.timezone}</span>
        </div>
      </div>

      <div className="settings-block">
        <div className="settings-block-heading">
          <h3>Approved Google accounts</h3>
          <span className="settings-count">
            {orderedIdentities.filter((identity) => identity.enabled).length}{" "}
            active
          </span>
        </div>
        {orderedIdentities.map((identity) => {
          const isIntegrationOwner =
            data?.integrationOwnerEmail === identity.email_normalized;
          const key = identity.email_normalized;
          return (
            <div className="identity-row" key={key}>
              <span className="avatar" aria-hidden="true">
                {initials(identity.display_name || key)}
              </span>
              <span>
                <strong>{key}</strong>
                <small>
                  {identity.is_current ? "Current session · " : ""}
                  {isIntegrationOwner ? "Integration owner · " : ""}
                  {identity.enabled
                    ? lastSignIn(identity.last_login_at)
                    : "Disabled"}
                </small>
              </span>
              <span className="identity-actions">
                {identity.is_current &&
                identity.enabled &&
                !isIntegrationOwner ? (
                  <button
                    className="text-button"
                    disabled={busy === `owner:${key}`}
                    onClick={() => void chooseIntegrationOwner(identity)}
                  >
                    <KeyRound size={13} /> Use for integrations
                  </button>
                ) : null}
                {!identity.is_current ? (
                  <button
                    className="text-button"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void runMutation(
                        `state:${key}`,
                        `/api/identities/${encodeURIComponent(key)}`,
                        {
                          method: "PATCH",
                          body: JSON.stringify({
                            enabled: !identity.enabled,
                          }),
                        },
                        `${key} ${identity.enabled ? "disabled" : "enabled"}`,
                      )
                    }
                  >
                    {identity.enabled ? (
                      "Disable"
                    ) : (
                      <>
                        <Check size={13} /> Enable
                      </>
                    )}
                  </button>
                ) : null}
                {!identity.google_subject && !identity.is_current ? (
                  <button
                    className="text-button danger-text"
                    aria-label={`Remove ${key}`}
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void runMutation(
                        `remove:${key}`,
                        `/api/identities/${encodeURIComponent(key)}`,
                        { method: "DELETE", body: "{}" },
                        `${key} removed`,
                      )
                    }
                  >
                    <Trash2 size={13} /> Remove
                  </button>
                ) : null}
              </span>
            </div>
          );
        })}
        {!data && !error ? (
          <p className="settings-quiet-state">Loading approved accounts…</p>
        ) : null}
        <form className="identity-add-form" onSubmit={addIdentity}>
          <label htmlFor="approved-owner-email">
            Approve another owner email
          </label>
          <div>
            <input
              id="approved-owner-email"
              type="email"
              autoComplete="email"
              placeholder="name@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <button disabled={!email.trim() || Boolean(busy)} type="submit">
              <Plus size={14} /> Approve
            </button>
          </div>
          <small>
            Access starts only after that exact account completes Google
            verification. No invitation email is sent.
          </small>
        </form>
        {error ? (
          <p className="settings-inline-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <ActiveSessions />
    </>
  );
}
