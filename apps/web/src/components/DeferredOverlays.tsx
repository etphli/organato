import { lazy, Suspense, useEffect, useState } from "react";
import { useOrganatoUi } from "../state/OrganatoProvider";

const LazyInspector = lazy(() =>
  import("./Inspector").then(({ Inspector }) => ({ default: Inspector })),
);
const LazyCommandPalette = lazy(() =>
  import("./CommandPalette").then(({ CommandPalette }) => ({
    default: CommandPalette,
  })),
);
const LazySearchOverlay = lazy(() =>
  import("./SearchOverlay").then(({ SearchOverlay }) => ({
    default: SearchOverlay,
  })),
);

export function DeferredOverlays() {
  const { selectedItem, commandOpen, searchOpen } = useOrganatoUi();
  const [inspectorLoaded, setInspectorLoaded] = useState(
    () => selectedItem !== null,
  );

  useEffect(() => {
    if (selectedItem) setInspectorLoaded(true);
  }, [selectedItem]);

  return (
    <Suspense fallback={null}>
      {inspectorLoaded ? <LazyInspector /> : null}
      {commandOpen ? <LazyCommandPalette /> : null}
      {searchOpen ? <LazySearchOverlay /> : null}
    </Suspense>
  );
}
