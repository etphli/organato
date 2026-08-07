PRAGMA foreign_keys = OFF;

-- Preserve all existing workspace-owned records for the original owner. Every
-- other signed-in identity receives a separate empty workspace.
UPDATE workspace SET id = 'ethan.likht@gmail.com' WHERE id = 'workspace';

INSERT OR IGNORE INTO workspace
  (id, name, timezone, integration_owner_email, settings_json, created_at, updated_at)
SELECT email_normalized, 'Organato', 'Australia/Sydney', NULL, '{}',
       datetime('now'), datetime('now')
FROM allowed_identity;

ALTER TABLE allowed_identity ADD COLUMN workspace_id TEXT;
UPDATE allowed_identity SET workspace_id = email_normalized;
UPDATE allowed_identity SET enabled = 1;

ALTER TABLE oauth_transaction ADD COLUMN workspace_id TEXT;

ALTER TABLE subject ADD COLUMN workspace_id TEXT;
UPDATE subject SET workspace_id = 'ethan.likht@gmail.com';
UPDATE subject
SET canvas_course_id = 'ethan.likht@gmail.com:' || canvas_course_id
WHERE canvas_course_id IS NOT NULL;

ALTER TABLE item ADD COLUMN workspace_id TEXT;
UPDATE item SET workspace_id = 'ethan.likht@gmail.com';
UPDATE item
SET canvas_base_url_hash = 'ethan.likht@gmail.com:' || canvas_base_url_hash
WHERE canvas_base_url_hash IS NOT NULL;
UPDATE item
SET canvas_course_id = 'ethan.likht@gmail.com:' || canvas_course_id
WHERE canvas_course_id IS NOT NULL;
ALTER TABLE field_override ADD COLUMN workspace_id TEXT;
UPDATE field_override SET workspace_id = 'ethan.likht@gmail.com';
ALTER TABLE attachment_link ADD COLUMN workspace_id TEXT;
UPDATE attachment_link SET workspace_id = 'ethan.likht@gmail.com';
ALTER TABLE item_history ADD COLUMN workspace_id TEXT;
UPDATE item_history SET workspace_id = 'ethan.likht@gmail.com';

CREATE TABLE calendar_link_tenant (
  item_id TEXT PRIMARY KEY REFERENCES item(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  google_calendar_id TEXT NOT NULL,
  google_event_id TEXT,
  google_etag TEXT,
  last_google_updated_at TEXT,
  last_pushed_item_version INTEGER,
  sync_state TEXT NOT NULL,
  suppressed_at TEXT,
  last_synced_at TEXT,
  UNIQUE(workspace_id, google_event_id)
);
INSERT INTO calendar_link_tenant
SELECT item_id, 'ethan.likht@gmail.com', google_calendar_id, google_event_id,
       google_etag, last_google_updated_at, last_pushed_item_version,
       sync_state, suppressed_at, last_synced_at
FROM calendar_link;
DROP TABLE calendar_link;
ALTER TABLE calendar_link_tenant RENAME TO calendar_link;

CREATE TABLE integration_connection_tenant (
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  account_label TEXT NOT NULL,
  status TEXT NOT NULL,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  encrypted_credential TEXT,
  credential_key_version INTEGER,
  last_success_at TEXT,
  last_attempt_at TEXT,
  last_error_category TEXT,
  reconnect_needed INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, provider)
);
INSERT INTO integration_connection_tenant
SELECT 'ethan.likht@gmail.com', provider, account_label, status, scopes_json,
       encrypted_credential, credential_key_version, last_success_at,
       last_attempt_at, last_error_category, reconnect_needed, metadata_json,
       updated_at
FROM integration_connection;
DROP TABLE integration_connection;
ALTER TABLE integration_connection_tenant RENAME TO integration_connection;

ALTER TABLE sync_run ADD COLUMN workspace_id TEXT;
UPDATE sync_run SET workspace_id = 'ethan.likht@gmail.com';
ALTER TABLE reminder_delivery ADD COLUMN workspace_id TEXT;
UPDATE reminder_delivery SET workspace_id = 'ethan.likht@gmail.com';
ALTER TABLE saved_view ADD COLUMN workspace_id TEXT;
UPDATE saved_view SET workspace_id = 'ethan.likht@gmail.com';
ALTER TABLE security_event ADD COLUMN workspace_id TEXT;
UPDATE security_event
SET workspace_id = COALESCE(actor_email, 'ethan.likht@gmail.com')
WHERE actor_email IN (SELECT id FROM workspace);
UPDATE security_event SET workspace_id = 'ethan.likht@gmail.com'
WHERE workspace_id IS NULL;

CREATE TRIGGER allowed_identity_workspace_required_insert
BEFORE INSERT ON allowed_identity
WHEN NEW.workspace_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM workspace WHERE id = NEW.workspace_id)
BEGIN
  SELECT RAISE(ABORT, 'valid workspace_id required');
END;
CREATE TRIGGER allowed_identity_workspace_required_update
BEFORE UPDATE OF workspace_id ON allowed_identity
WHEN NEW.workspace_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM workspace WHERE id = NEW.workspace_id)
BEGIN
  SELECT RAISE(ABORT, 'valid workspace_id required');
END;

CREATE TRIGGER item_workspace_required_insert
BEFORE INSERT ON item
WHEN NEW.workspace_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM workspace WHERE id = NEW.workspace_id)
BEGIN
  SELECT RAISE(ABORT, 'valid workspace_id required');
END;

CREATE TRIGGER subject_workspace_required_insert
BEFORE INSERT ON subject
WHEN NEW.workspace_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM workspace WHERE id = NEW.workspace_id)
BEGIN
  SELECT RAISE(ABORT, 'valid workspace_id required');
END;
CREATE TRIGGER subject_workspace_required_update
BEFORE UPDATE OF workspace_id ON subject
WHEN NEW.workspace_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM workspace WHERE id = NEW.workspace_id)
BEGIN
  SELECT RAISE(ABORT, 'valid workspace_id required');
END;
CREATE TRIGGER item_workspace_required_update
BEFORE UPDATE OF workspace_id ON item
WHEN NEW.workspace_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM workspace WHERE id = NEW.workspace_id)
BEGIN
  SELECT RAISE(ABORT, 'valid workspace_id required');
END;

CREATE TRIGGER sync_run_workspace_required_insert
BEFORE INSERT ON sync_run
WHEN NEW.workspace_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM workspace WHERE id = NEW.workspace_id)
BEGIN
  SELECT RAISE(ABORT, 'valid workspace_id required');
END;
CREATE TRIGGER reminder_workspace_required_insert
BEFORE INSERT ON reminder_delivery
WHEN NEW.workspace_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM workspace WHERE id = NEW.workspace_id)
BEGIN
  SELECT RAISE(ABORT, 'valid workspace_id required');
END;
CREATE TRIGGER saved_view_workspace_required_insert
BEFORE INSERT ON saved_view
WHEN NEW.workspace_id IS NULL
  OR NOT EXISTS (SELECT 1 FROM workspace WHERE id = NEW.workspace_id)
BEGIN
  SELECT RAISE(ABORT, 'valid workspace_id required');
END;

CREATE INDEX subject_workspace_idx
  ON subject(workspace_id, active, display_name);
CREATE INDEX item_workspace_active_due_idx
  ON item(workspace_id, archived_at, due_at);
CREATE INDEX item_workspace_calendar_idx
  ON item(workspace_id, calendar_sync_state, archived_at);
CREATE INDEX override_workspace_item_idx
  ON field_override(workspace_id, item_id);
CREATE INDEX attachment_workspace_item_idx
  ON attachment_link(workspace_id, item_id);
CREATE INDEX history_workspace_item_created_idx
  ON item_history(workspace_id, item_id, created_at DESC);
CREATE INDEX calendar_workspace_item_idx
  ON calendar_link(workspace_id, item_id);

CREATE TRIGGER field_override_workspace_insert
AFTER INSERT ON field_override
BEGIN
  UPDATE field_override
  SET workspace_id = (SELECT workspace_id FROM item WHERE id = NEW.item_id)
  WHERE item_id = NEW.item_id AND field_name = NEW.field_name;
END;

CREATE TRIGGER attachment_link_workspace_insert
AFTER INSERT ON attachment_link
BEGIN
  UPDATE attachment_link
  SET workspace_id = (SELECT workspace_id FROM item WHERE id = NEW.item_id)
  WHERE id = NEW.id;
END;

CREATE TRIGGER item_history_workspace_insert
AFTER INSERT ON item_history
BEGIN
  UPDATE item_history
  SET workspace_id = (SELECT workspace_id FROM item WHERE id = NEW.item_id)
  WHERE id = NEW.id;
END;

CREATE TRIGGER calendar_link_workspace_insert
AFTER INSERT ON calendar_link
BEGIN
  UPDATE calendar_link
  SET workspace_id = (SELECT workspace_id FROM item WHERE id = NEW.item_id)
  WHERE item_id = NEW.item_id;
END;
CREATE INDEX sync_run_workspace_started_idx
  ON sync_run(workspace_id, provider, started_at DESC);
CREATE INDEX reminder_workspace_date_idx
  ON reminder_delivery(workspace_id, local_date, status);
CREATE INDEX saved_view_workspace_idx
  ON saved_view(workspace_id, page, is_default);
CREATE INDEX security_event_workspace_created_idx
  ON security_event(workspace_id, created_at DESC);
CREATE INDEX session_email_active_idx
  ON session(email_normalized, revoked_at);

-- Force browsers to establish fresh tenant-aware sessions after deployment.
UPDATE session SET revoked_at = datetime('now') WHERE revoked_at IS NULL;

PRAGMA foreign_keys = ON;
