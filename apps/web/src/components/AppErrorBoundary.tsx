import { Component, type ReactNode } from "react";
import { BrandMark } from "./BrandMark";

export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Organato render failure", error);
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
