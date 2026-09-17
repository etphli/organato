CREATE TABLE canvas_item_tombstone (
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  canvas_base_url_hash TEXT NOT NULL,
  canvas_assignment_id TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, canvas_base_url_hash, canvas_assignment_id)
);
