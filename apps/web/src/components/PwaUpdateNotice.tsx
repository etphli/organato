import { RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";

export function PwaUpdateNotice() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const show = () => setReady(true);
    window.addEventListener("organato:pwa-update", show);
    return () => window.removeEventListener("organato:pwa-update", show);
  }, []);

  if (!ready) return null;
  return (
    <aside className="pwa-update-notice" aria-live="polite">
      <span>A quieter, newer Organato is ready.</span>
      <button onClick={() => window.location.reload()}>
        <RefreshCw size={14} aria-hidden="true" />
        Reload
      </button>
      <button
        className="icon-button"
        aria-label="Dismiss update notice"
        onClick={() => setReady(false)}
      >
        <X size={15} />
      </button>
    </aside>
  );
}
