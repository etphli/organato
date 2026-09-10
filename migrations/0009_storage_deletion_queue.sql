-- Durable deletion queue for uploaded files so permanent deletion retries
-- until KV confirms removal instead of orphaning objects.
CREATE TABLE IF NOT EXISTS storage_deletion_queue (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS storage_deletion_queue_due_idx
  ON storage_deletion_queue(next_attempt_at);
CREATE INDEX IF NOT EXISTS storage_deletion_queue_workspace_idx
  ON storage_deletion_queue(workspace_id);
