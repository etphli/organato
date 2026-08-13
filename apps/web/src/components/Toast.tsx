import { useEffect } from "react";
import {
  useOrganatoActions,
  useOrganatoData,
  useOrganatoUi,
} from "../state/OrganatoProvider";

export function Toast() {
  const { settings } = useOrganatoData();
  const { toast, undo } = useOrganatoUi();
  const { dispatch } = useOrganatoActions();
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(
      () => dispatch({ type: "toast", message: null }),
      5000,
    );
    return () => window.clearTimeout(timeout);
  }, [dispatch, toast]);
  return toast ? (
    <div
      className="toast"
      role={settings.screenReaderAnnouncements ? "status" : undefined}
      aria-live={settings.screenReaderAnnouncements ? "polite" : "off"}
    >
      {toast}
      {undo ? (
        <button onClick={() => dispatch({ type: "undo" })}>Undo</button>
      ) : (
        <button onClick={() => dispatch({ type: "toast", message: null })}>
          Dismiss
        </button>
      )}
    </div>
  ) : null;
}
