import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { BrandMark } from "./BrandMark";

interface SessionOwner {
  email: string;
  displayName: string;
}

interface SessionResponse {
  authenticated: true;
  owner: SessionOwner;
  csrfToken: string;
}

interface ExchangeResponse {
  authenticated: true;
  csrfToken: string;
  returnTo: string;
}

export async function exchangeGoogleCallbackIfPresent(): Promise<boolean> {
  const isAuthenticationCallback =
    window.location.pathname === "/auth/google/callback" ||
    window.location.pathname === "/api/auth/google/callback";
  const isIntegrationCallback =
    window.location.pathname === "/api/integrations/google/callback";
  if (!isAuthenticationCallback && !isIntegrationCallback) return false;
  const query = new URLSearchParams(window.location.search);
  const response = await fetch(
    isAuthenticationCallback
      ? "/api/auth/google/exchange"
      : "/api/integrations/google/exchange",
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(isIntegrationCallback
          ? {
              "X-CSRF-Token": sessionStorage.getItem("organato_csrf") ?? "",
            }
          : {}),
      },
      body: JSON.stringify({
        code: query.get("code"),
        state: query.get("state"),
      }),
    },
  );
  if (!response.ok) throw new Error("exchange_failed");
  const exchange = (await response.json()) as ExchangeResponse;
  if (isAuthenticationCallback) {
    sessionStorage.setItem("organato_csrf", exchange.csrfToken);
  }
  window.history.replaceState(
    null,
    "",
    exchange.returnTo.startsWith("/") ? exchange.returnTo : "/",
  );
  return true;
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
    async function finishSignIn() {
      const callbackExchanged = await exchangeGoogleCallbackIfPresent();
      if (!callbackExchanged) {
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
      }
      const response = await fetch("/api/session", {
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("signed_out");
      const session = (await response.json()) as SessionResponse;
      sessionStorage.setItem("organato_csrf", session.csrfToken);
      setState({ status: "signed_in", owner: session.owner });
    }

    void finishSignIn().catch(() => {
      const callbackFailed =
        window.location.pathname === "/auth/google/callback" ||
        window.location.pathname === "/api/auth/google/callback" ||
        window.location.pathname === "/api/integrations/google/callback";
      if (callbackFailed) window.history.replaceState(null, "", "/");
      setState(
        navigator.onLine
          ? callbackFailed
            ? {
                status: "signed_out",
                message: "Google sign-in could not finish. Please try again.",
              }
            : { status: "signed_out" }
          : { status: "offline" },
      );
    });
  }, [demoMode]);

  if (state.status === "checking") {
    return <div className="auth-loading" aria-label="Checking sign-in" />;
  }
  if (state.status === "offline") {
    return (
      <main className="auth-page">
        <section>
          <span className="auth-mark">
            <BrandMark size={24} />
          </span>
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
          <span className="auth-mark">
            <BrandMark size={24} />
          </span>
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
