/**
 * Shared client timing constants. Tune here instead of hunting literals —
 * every value below previously lived inline across components.
 */
export const TOAST_DISMISS_MS = 5000;
export const TOAST_UNDO_DISMISS_MS = 10_000;
export const TOAST_POLL_MS = 250;
/** One retry of the session check so a transient blip never signs the user out. */
export const SESSION_RETRY_DELAY_MS = 600;
export const API_TIMEOUT_MS = 15_000;
export const KEY_SEQUENCE_TIMEOUT_MS = 800;
export const POST_RESTORE_RELOAD_DELAY_MS = 700;
