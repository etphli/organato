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

class GoogleCallbackError extends Error {}

export async function exchangeGoogleCallbackIfPresent(): Promise<boolean> {
  const isAuthenticationCallback =
    window.location.pathname === "/auth/google/callback" ||
    window.location.pathname === "/api/auth/google/callback";
  const isIntegrationCallback =
    window.location.pathname === "/api/integrations/google/callback";
  if (!isAuthenticationCallback && !isIntegrationCallback) return false;
  const query = new URLSearchParams(window.location.search);
  const code = query.get("code");
  const state = query.get("state");
  if (!code || !state) {
    throw new GoogleCallbackError(
      "Google sign-in could not finish. Please try again.",
    );
  }
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
      body: JSON.stringify({ code, state }),
    },
  );
  if (!response.ok) {
    const failure = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new GoogleCallbackError(
      failure.error ?? "Google sign-in could not finish. Please try again.",
    );
  }
  const exchange = (await response.json()) as ExchangeResponse;
  if (isAuthenticationCallback) {
    sessionStorage.setItem("organato_csrf", exchange.csrfToken);
  }
  const returnTo = exchange.returnTo ?? "/";
  const safeReturnTo =
    returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
  window.history.replaceState(null, "", safeReturnTo);
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
      // Retry the session check once: a single transient blip (sleep/wake,
      // momentary offline) should not bounce a signed-in user to the starter
      // page. The OAuth exchange above is single-use and is never retried.
      let response: Response | null = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        response = await fetch("/api/session", {
          credentials: "same-origin",
        });
        if (response.ok || attempt === 1) break;
        if (response.status === 401 || response.status === 403) break;
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
      if (!response || !response.ok) throw new Error("signed_out");
      const session = (await response.json()) as SessionResponse;
      sessionStorage.setItem("organato_csrf", session.csrfToken);
      setState({ status: "signed_in", owner: session.owner });
    }

    void finishSignIn().catch((error: unknown) => {
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
                message:
                  error instanceof GoogleCallbackError
                    ? error.message
                    : "Google sign-in could not finish. Please try again.",
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
          <button onClick={() => window.location.reload()}>Retry</button>
        </section>
      </main>
    );
  }
  if (state.status === "signed_out") {
    return <SignedOutPage message={state.message} setState={setState} />;
  }
  return (
    <AuthContext.Provider value={state.owner}>{children}</AuthContext.Provider>
  );
}

function SignedOutPage({
  message,
  setState,
}: {
  message: string | undefined;
  setState: React.Dispatch<
    React.SetStateAction<
      | { status: "checking" }
      | { status: "offline" }
      | { status: "signed_out"; message?: string }
      | { status: "signed_in"; owner: SessionOwner }
    >
  >;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <main className="auth-page">
      <section>
        <span className="auth-mark">
          <BrandMark size={24} />
        </span>
        <h1>Organato</h1>
        <p>Your private school work and todos, in one quiet place.</p>
        <button
          disabled={busy}
          onClick={async () => {
            if (busy) return;
            setBusy(true);
            try {
              const returnTo = `${window.location.pathname}${window.location.search}`;
              const response = await fetch("/api/auth/google/start", {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ returnTo }),
              });
              if (!response.ok) throw new Error("start_failed");
              const result = (await response.json()) as {
                authorizationUrl: string;
              };
              if (
                !/^https:\/\/(accounts\.google\.com|lh3\.googleusercontent\.com)/.test(
                  result.authorizationUrl,
                ) &&
                !result.authorizationUrl.startsWith("/")
              ) {
                throw new Error("bad_url");
              }
              window.location.assign(result.authorizationUrl);
            } catch {
              setBusy(false);
              setState({
                status: "signed_out",
                message:
                  "Sign-in could not start. Check the connection and try again.",
              });
            }
          }}
        >
          {busy ? "Starting sign-in…" : "Continue with Google"}
        </button>
        {message ? <small role="alert">{message}</small> : null}
        <footer>
          Every verified Google account receives a private workspace.
        </footer>
      </section>
    </main>
  );
}
