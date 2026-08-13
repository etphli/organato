import { Laptop, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useOrganatoActions } from "../../state/OrganatoProvider";

interface SessionSummary {
  email_normalized?: string;
  user_agent: string;
  created_at: string;
  last_activity_at: string;
  idle_expires_at: string;
  is_current: number;
}

function describeUserAgent(value: string) {
  if (!value) return "Unknown browser";
  const browser = value.includes("Edg/")
    ? "Edge"
    : value.includes("Firefox/")
      ? "Firefox"
      : value.includes("CriOS/")
        ? "Chrome"
        : value.includes("Chrome/")
          ? "Chrome"
          : value.includes("Safari/")
            ? "Safari"
            : "Browser";
  const device = /iPhone|iPad/.test(value)
    ? "iOS"
    : value.includes("Android")
      ? "Android"
      : value.includes("Mac OS X")
        ? "macOS"
        : value.includes("Windows")
          ? "Windows"
          : value.includes("Linux")
            ? "Linux"
            : "this device";
  return `${browser} on ${device}`;
}

function relativeActivity(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return "active now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

export function ActiveSessions() {
  const { dispatch } = useOrganatoActions();
  const demoMode = import.meta.env.VITE_DEMO_MODE === "true";
  const [sessions, setSessions] = useState<SessionSummary[]>(() =>
    demoMode
      ? [
          {
            user_agent: navigator.userAgent,
            created_at: new Date().toISOString(),
            last_activity_at: new Date().toISOString(),
            idle_expires_at: new Date(
              Date.now() + 7 * 86_400_000,
            ).toISOString(),
            is_current: 1,
          },
        ]
      : [],
  );
  const [loading, setLoading] = useState(!demoMode);

  useEffect(() => {
    if (demoMode) return;
    void fetch("/api/sessions", { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error("sessions_unavailable");
        return (await response.json()) as { sessions: SessionSummary[] };
      })
      .then((result) => setSessions(result.sessions))
      .catch(() => {
        dispatch({
          type: "toast",
          message: "Active sessions could not be loaded",
        });
      })
      .finally(() => setLoading(false));
  }, [demoMode, dispatch]);

  const revokeOthers = async () => {
    if (demoMode) {
      setSessions((current) => current.filter((session) => session.is_current));
      dispatch({ type: "toast", message: "Other sessions revoked" });
      return;
    }
    const response = await fetch("/api/sessions/revoke-others", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": sessionStorage.getItem("organato_csrf") ?? "",
      },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      dispatch({ type: "toast", message: "Sessions could not be updated" });
      return;
    }
    setSessions((current) => current.filter((session) => session.is_current));
    dispatch({ type: "toast", message: "Other sessions revoked" });
  };

  return (
    <div className="settings-block">
      <div className="settings-block-heading">
        <h3>Active sessions</h3>
        {sessions.some((session) => !session.is_current) ? (
          <button className="text-button" onClick={() => void revokeOthers()}>
            Revoke others
          </button>
        ) : null}
      </div>
      {loading ? (
        <p className="settings-quiet-state">Loading active sessions…</p>
      ) : sessions.length ? (
        sessions.map((session, index) => (
          <div className="identity-row" key={`${session.created_at}-${index}`}>
            {session.is_current ? (
              <ShieldCheck size={20} />
            ) : (
              <Laptop size={20} />
            )}
            <span>
              <strong>{describeUserAgent(session.user_agent)}</strong>
              <small>
                {session.is_current ? "Current session" : "Signed in"} ·{" "}
                {relativeActivity(session.last_activity_at)}
                {session.email_normalized
                  ? ` · ${session.email_normalized}`
                  : ""}
              </small>
            </span>
          </div>
        ))
      ) : (
        <p className="settings-quiet-state">No active sessions found.</p>
      )}
    </div>
  );
}
