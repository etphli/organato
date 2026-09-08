import { Component, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { reportClientDiagnostic } from "../clientDiagnostics";
import { BrandMark } from "./BrandMark";

interface BoundaryState {
  error: Error | null;
}

class AppErrorBoundaryClass extends Component<
  { children: ReactNode; locationKey: string },
  BoundaryState
> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Reporting goes through the diagnostic channel only, so render
    // failures (which can include item content) never land in the console.
    reportClientDiagnostic("react_error", {
      message: error.message.slice(0, 240),
      stack: error.stack?.slice(0, 800) ?? null,
    });
  }

  componentDidUpdate(previousProps: { locationKey: string }) {
    if (
      this.state.error &&
      previousProps.locationKey !== this.props.locationKey
    ) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="auth-page">
        <section role="alert" aria-labelledby="app-recovery-title">
          <span className="auth-mark">
            <BrandMark size={24} />
          </span>
          <h1 id="app-recovery-title">Organato hit an interface error</h1>
          <p>
            Your workspace data is safe. Try the interface again, or reload the
            latest version if the problem continues.
          </p>
          <button type="button" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button type="button" onClick={() => window.location.reload()}>
            Reload latest Organato
          </button>
        </section>
      </main>
    );
  }
}

export function AppErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <AppErrorBoundaryClass locationKey={pathname}>
      {children}
    </AppErrorBoundaryClass>
  );
}

export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <AppErrorBoundaryClass locationKey={pathname}>
      {children}
    </AppErrorBoundaryClass>
  );
}
