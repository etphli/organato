import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

interface SessionOwner {
  email: string;
  displayName: string;
}

interface SessionResponse {
  authenticated: true;
  owner: SessionOwner;
  csrfToken: string;
}

const AuthContext = createContext<SessionOwner | null>(null);

export function useAuthOwner() {
  return useContext(AuthContext);
}

export function AuthGate({ children }: { children: ReactNode }) {
  const demoMode = import.meta.env.VITE_DEMO_MODE === "true";
  const [state, setState] = useState<
    | { status: "checking" }
    | { status: "offline" }
    | { status: "signed_out"; message?: string }
    | { status: "signed_in"; owner: SessionOwner }
  >(() =>
    demoMode
      ? {
          status: "signed_in",
          owner: { email: "owner@example.com", displayName: "Alex Smith" },
        }
      : { status: "checking" },
  );

  useEffect(() => {
    if (demoMode) return;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const csrf = fragment.get("csrf");
    if (csrf) {
      sessionStorage.setItem("organato_csrf", csrf);
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    }
    void fetch("/api/session", { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error("signed_out");
        const session = (await response.json()) as SessionResponse;
        sessionStorage.setItem("organato_csrf", session.csrfToken);
        setState({ status: "signed_in", owner: session.owner });
      })
      .catch(() =>
        setState(
          navigator.onLine ? { status: "signed_out" } : { status: "offline" },
        ),
      );
  }, [demoMode]);

  if (state.status === "checking") {
    return <div className="auth-loading" aria-label="Checking sign-in" />;
  }
  if (state.status === "offline") {
    return (
      <main className="auth-page">
        <section>
          <span className="auth-mark">O</span>
          <h1>Organato is offline</h1>
          <p>
            Reconnect to load private workspace data. Organato does not save or
            edit work while offline.
          </p>
        </section>
      </main>
    );
  }
  if (state.status === "signed_out") {
    return (
      <main className="auth-page">
        <section>
          <span className="auth-mark">O</span>
          <h1>Organato</h1>
          <p>Your private school work and todos, in one quiet place.</p>
          <button
            onClick={async () => {
              try {
                const response = await fetch("/api/auth/google/start", {
                  method: "POST",
                  credentials: "same-origin",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ returnTo: window.location.pathname }),
                });
                if (!response.ok) throw new Error("start_failed");
                const result = (await response.json()) as {
                  authorizationUrl: string;
                };
                window.location.assign(result.authorizationUrl);
              } catch {
                setState({
                  status: "signed_out",
                  message:
                    "Sign-in could not start. Check the connection and try again.",
                });
              }
            }}
          >
            Continue with Google
          </button>
          {state.message ? <small role="alert">{state.message}</small> : null}
          <footer>Only approved accounts can enter this workspace.</footer>
        </section>
      </main>
    );
  }
  return (
    <AuthContext.Provider value={state.owner}>{children}</AuthContext.Provider>
  );
}
