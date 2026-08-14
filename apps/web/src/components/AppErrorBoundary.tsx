import { Component, type ReactNode } from "react";
import { BrandMark } from "./BrandMark";

const chunkFailurePattern =
  /chunkloaderror|failed to fetch dynamically imported module|importing a module script failed|loading chunk/i;
const reloadMarker = "organato_chunk_recovery_at";

export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    if (!chunkFailurePattern.test(`${error.name} ${error.message}`)) return;
    const lastReload = Number(sessionStorage.getItem(reloadMarker) ?? "0");
    if (Date.now() - lastReload < 30_000) return;
    sessionStorage.setItem(reloadMarker, String(Date.now()));
    window.location.reload();
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="auth-page">
        <section role="alert" aria-labelledby="app-recovery-title">
          <span className="auth-mark">
            <BrandMark size={24} />
          </span>
          <h1 id="app-recovery-title">Organato needs a quick refresh</h1>
          <p>
            A newer app version became available while this tab was open. Your
            workspace data is safe.
          </p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload Organato
          </button>
        </section>
      </main>
    );
  }
}
