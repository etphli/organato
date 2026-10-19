CREATE TABLE api_key (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  permission TEXT NOT NULL CHECK (permission IN ('read', 'read_write')),
  created_at TEXT NOT NULL,
  expires_at TEXT,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX api_key_workspace ON api_key(workspace_id, created_at);
CREATE INDEX item_workspace_page ON item(workspace_id, id);
