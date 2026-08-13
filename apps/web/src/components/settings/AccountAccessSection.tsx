import { useEffect, useState } from "react";
import { useAuthOwner } from "../AuthGate";
import { useOrganatoData } from "../../state/OrganatoProvider";
import { ActiveSessions } from "./ActiveSessions";

interface AllowedIdentity {
  email_normalized: string;
  display_name: string;
  last_login_at: string | null;
  is_current: number;
}

interface IdentityResponse {
  identities: AllowedIdentity[];
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
  if (!value) return "Verified Google account";
  return `Last signed in ${new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value))}`;
}

export function AccountAccessSection() {
  const owner = useAuthOwner();
  const { settings } = useOrganatoData();
  const demoMode = import.meta.env.VITE_DEMO_MODE === "true";
  const [identity, setIdentity] = useState<AllowedIdentity | null>(() =>
    demoMode
      ? {
          email_normalized: owner?.email ?? "owner@example.com",
          display_name: owner?.displayName ?? "Alex Smith",
          last_login_at: new Date().toISOString(),
          is_current: 1,
        }
      : null,
  );
  const [error, setError] = useState<string | null>(null);
  const displayName = owner?.displayName || owner?.email || "Owner";

  useEffect(() => {
    if (demoMode) return;
    void fetch("/api/identities", { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Account details could not be loaded.");
        return (await response.json()) as IdentityResponse;
      })
      .then((result) => {
        setIdentity(
          result.identities.find((entry) => Boolean(entry.is_current)) ?? null,
        );
      })
      .catch(() => setError("Account details could not be loaded."));
  }, [demoMode]);

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
          <h3>Private workspace account</h3>
          <span className="settings-count">Isolated</span>
        </div>
        <p className="settings-quiet-state">
          This workspace belongs only to the Google account below. Other people
          who sign in receive separate workspaces and cannot see or change your
          data, settings, or integrations.
        </p>
        {identity ? (
          <div className="identity-row">
            <span className="avatar" aria-hidden="true">
              {initials(identity.display_name || identity.email_normalized)}
            </span>
            <span>
              <strong>{identity.email_normalized}</strong>
              <small>{lastSignIn(identity.last_login_at)}</small>
            </span>
          </div>
        ) : null}
        {!identity && !error ? (
          <p className="settings-quiet-state">Loading account…</p>
        ) : null}
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
