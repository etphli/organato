-- Checklists, dependencies, and effort estimates.
ALTER TABLE item ADD COLUMN estimated_minutes INTEGER;

CREATE TABLE IF NOT EXISTS subtask (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  item_id TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
  sort_rank REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS subtask_item_idx
  ON subtask(workspace_id, item_id);

CREATE TABLE IF NOT EXISTS item_link (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  from_item_id TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  to_item_id TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(from_item_id, to_item_id)
);
CREATE INDEX IF NOT EXISTS item_link_from_idx
  ON item_link(workspace_id, from_item_id);
CREATE INDEX IF NOT EXISTS item_link_to_idx
  ON item_link(workspace_id, to_item_id);
