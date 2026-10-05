import { useOrganatoUi } from "../state/OrganatoProvider";
import { Suspense, useEffect } from "react";
import { prefetchablePage } from "../lib/prefetchablePage";

const inspector = prefetchablePage<Record<string, never>>(() =>
  import("./Inspector").then((module) => ({ default: module.Inspector })),
);
const commands = prefetchablePage<Record<string, never>>(() =>
  import("./CommandPalette").then((module) => ({
    default: module.CommandPalette,
  })),
);
const search = prefetchablePage<Record<string, never>>(() =>
  import("./SearchOverlay").then((module) => ({
    default: module.SearchOverlay,
  })),
);

export function DeferredOverlays() {
  const { selectedItem, commandOpen, searchOpen } = useOrganatoUi();
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!navigator.onLine) return;
      void inspector.preload().catch(() => undefined);
      void commands.preload().catch(() => undefined);
      void search.preload().catch(() => undefined);
    }, 2000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <Suspense
      fallback={
        <div role="status" className="route-loading">
          Loading…
        </div>
      }
    >
      {selectedItem ? <inspector.Page /> : null}
      {commandOpen ? <commands.Page /> : null}
      {searchOpen ? <search.Page /> : null}
    </Suspense>
  );
}
