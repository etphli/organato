-- Track the last interactive authentication per session so step-up checks
-- (requireRecentSession) measure from the actual sign-in instead of session
-- creation. Backfilled to created_at so existing sessions keep working.
ALTER TABLE session ADD COLUMN authenticated_at TEXT;
UPDATE session SET authenticated_at = created_at WHERE authenticated_at IS NULL;

-- Per-event calendar pull failures, so poison events stop pinning the
-- incremental sync token and surface in health instead.
ALTER TABLE calendar_link ADD COLUMN last_error_category TEXT;
