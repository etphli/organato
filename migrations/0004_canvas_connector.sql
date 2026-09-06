CREATE TABLE IF NOT EXISTS canvas_connector_pairing (
  code_hash TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS canvas_connector_pairing_workspace ON canvas_connector_pairing(workspace_id);
CREATE TABLE IF NOT EXISTS canvas_connector_device (
  token_hash TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  device_name TEXT NOT NULL,
  revoked_at TEXT,
  erased_at TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS canvas_connector_active_workspace ON canvas_connector_device(workspace_id) WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS canvas_connector_pending_cleanup ON canvas_connector_device(workspace_id) WHERE revoked_at IS NOT NULL AND erased_at IS NULL;

ALTER TABLE item ADD COLUMN canvas_missing_run_id TEXT;
