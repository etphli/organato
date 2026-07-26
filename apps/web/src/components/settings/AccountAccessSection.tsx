import { useAuthOwner } from "../AuthGate";
import { ActiveSessions } from "./ActiveSessions";

export function AccountAccessSection() {
  const owner = useAuthOwner();
  const displayName = owner?.displayName || owner?.email || "Owner";
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <>
      <div className="settings-block">
        <h3>Profile</h3>
        <div className="field-row">
          <span>
            Display name<small>Provided by your approved Google account.</small>
          </span>
          <span className="field-value">{displayName}</span>
        </div>
        <div className="field-row">
          <span>
            Workspace timezone
            <small>Daylight-saving aware for dates and reminders.</small>
          </span>
          <span className="field-value">Australia/Sydney</span>
        </div>
      </div>
      <div className="settings-block">
        <h3>Approved Google account</h3>
        <div className="identity-row">
          <span className="avatar" aria-hidden="true">
            {initials}
          </span>
          <span>
            <strong>{owner?.email ?? "Configured owner"}</strong>
            <small>Owner · Approved sign-in identity</small>
          </span>
        </div>
        <p className="settings-help-copy">
          Only approved accounts can sign in. Identity changes require
          deployment access.
        </p>
      </div>
      <ActiveSessions />
    </>
  );
}
