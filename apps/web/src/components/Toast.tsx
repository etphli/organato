import { useEffect, useRef, useState } from "react";
import { useOrganatoActions, useOrganatoUi } from "../state/OrganatoProvider";
import {
  TOAST_DISMISS_MS,
  TOAST_POLL_MS,
  TOAST_UNDO_DISMISS_MS,
} from "../lib/timing";

export function Toast() {
  const { toast, toastSeq, undo } = useOrganatoUi();
  const { dispatch } = useOrganatoActions();
  const [held, setHeld] = useState(false);
  const deadline = useRef(0);
  useEffect(() => {
    if (!toast) return;
    // Undoable actions get a longer window; plain notices dismiss faster.
    // The countdown pauses while the toast is hovered or focused so the
    // action never expires under the pointer or a screen reader.
    deadline.current =
      Date.now() + (undo ? TOAST_UNDO_DISMISS_MS : TOAST_DISMISS_MS);
    const timer = window.setInterval(() => {
      if (!held && Date.now() >= deadline.current) {
        dispatch({ type: "toast", message: null });
      }
    }, TOAST_POLL_MS);
    return () => window.clearInterval(timer);
  }, [dispatch, held, toast, toastSeq, undo]);
  return toast ? (
    <div
      className="toast"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
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
