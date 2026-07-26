PRAGMA foreign_keys = ON;

CREATE TABLE workspace (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Organato',
  timezone TEXT NOT NULL DEFAULT 'Australia/Sydney',
  integration_owner_email TEXT,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE allowed_identity (
  email_normalized TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  google_subject TEXT UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  is_owner INTEGER NOT NULL DEFAULT 1 CHECK (is_owner IN (0, 1)),
  last_login_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE session (
  id_hash TEXT PRIMARY KEY,
  email_normalized TEXT NOT NULL REFERENCES allowed_identity(email_normalized),
  csrf_hash TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  idle_expires_at TEXT NOT NULL,
  absolute_expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE oauth_transaction (
  state_hash TEXT PRIMARY KEY,
  nonce_hash TEXT NOT NULL,
  nonce_encrypted TEXT NOT NULL,
  code_verifier_encrypted TEXT NOT NULL,
  return_to TEXT NOT NULL DEFAULT '/',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE subject (
  id TEXT PRIMARY KEY,
  canvas_course_id TEXT UNIQUE,
  source_name TEXT,
  display_name TEXT NOT NULL,
  short_name TEXT,
  colour TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE item (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL CHECK (kind IN ('work', 'todo')),
  classification TEXT NOT NULL CHECK (classification IN ('unclassified', 'assignment', 'checkpoint', 'both')),
  source_type TEXT NOT NULL CHECK (source_type IN ('canvas', 'manual')),
  canvas_base_url_hash TEXT,
  canvas_assignment_id TEXT,
  canvas_course_id TEXT,
  canvas_html_url TEXT,
  source_name TEXT,
  source_due_at TEXT,
  source_updated_at TEXT,
  source_payload_hash TEXT,
  display_name TEXT NOT NULL,
  due_at TEXT,
  due_date_local TEXT,
  due_has_explicit_time INTEGER NOT NULL DEFAULT 0 CHECK (due_has_explicit_time IN (0, 1)),
  subject_id TEXT REFERENCES subject(id),
  priority TEXT CHECK (priority IS NULL OR priority IN ('low', 'medium', 'high', 'urgent')),
  working_status TEXT NOT NULL CHECK (working_status IN ('not_started', 'in_progress', 'submitted', 'completed')),
  completed_at TEXT,
  submitted_at TEXT,
  notes_markdown TEXT NOT NULL DEFAULT '',
  recurrence_rule_json TEXT,
  recurrence_series_id TEXT,
  calendar_enabled INTEGER NOT NULL DEFAULT 1 CHECK (calendar_enabled IN (0, 1)),
  reminders_enabled INTEGER NOT NULL DEFAULT 1 CHECK (reminders_enabled IN (0, 1)),
  calendar_sync_state TEXT NOT NULL DEFAULT 'pending' CHECK (calendar_sync_state IN ('synced', 'pending', 'conflict', 'suppressed', 'error')),
  calendar_note TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  sort_rank REAL NOT NULL DEFAULT 0,
  archived_at TEXT,
  archive_reason TEXT,
  source_missing_since TEXT,
  missing_sync_count INTEGER NOT NULL DEFAULT 0,
  manual_archive INTEGER NOT NULL DEFAULT 0 CHECK (manual_archive IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (NOT (due_has_explicit_time = 1 AND due_date_local IS NOT NULL)),
  UNIQUE(canvas_base_url_hash, canvas_assignment_id)
);

CREATE TABLE field_override (
  item_id TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  override_value_json TEXT NOT NULL,
  source_value_at_override_json TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('organato', 'google')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (item_id, field_name)
);

CREATE TABLE attachment_link (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  link_type TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE item_history (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL,
  actor_identity TEXT NOT NULL,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  undo_until TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE calendar_link (
  item_id TEXT PRIMARY KEY REFERENCES item(id) ON DELETE CASCADE,
  google_calendar_id TEXT NOT NULL,
  google_event_id TEXT UNIQUE,
  google_etag TEXT,
  last_google_updated_at TEXT,
  last_pushed_item_version INTEGER,
  sync_state TEXT NOT NULL,
  suppressed_at TEXT,
  last_synced_at TEXT
);

CREATE TABLE integration_connection (
  provider TEXT PRIMARY KEY,
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
  updated_at TEXT NOT NULL
);

CREATE TABLE sync_run (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  scheduled_key TEXT UNIQUE,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  archived_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  result TEXT NOT NULL DEFAULT 'running',
  error_category TEXT
);

CREATE TABLE reminder_delivery (
  delivery_key TEXT PRIMARY KEY,
  delivery_type TEXT NOT NULL,
  local_date TEXT NOT NULL,
  item_snapshot_json TEXT NOT NULL,
  gmail_message_id TEXT,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE TABLE saved_view (
  id TEXT PRIMARY KEY,
  page TEXT NOT NULL,
  name TEXT NOT NULL,
  filters_json TEXT NOT NULL DEFAULT '{}',
  sort_json TEXT NOT NULL DEFAULT '[]',
  columns_json TEXT NOT NULL DEFAULT '[]',
  column_widths_json TEXT NOT NULL DEFAULT '{}',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE security_event (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  actor_email TEXT,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE rate_limit (
  key TEXT NOT NULL,
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);

CREATE INDEX item_active_due_idx ON item(archived_at, due_at);
CREATE INDEX item_archive_idx ON item(archived_at, archive_reason);
CREATE INDEX item_calendar_pending_idx ON item(calendar_sync_state, archived_at);
CREATE INDEX item_subject_idx ON item(subject_id, archived_at);
CREATE INDEX history_item_created_idx ON item_history(item_id, created_at DESC);
CREATE INDEX sync_run_started_idx ON sync_run(provider, started_at DESC);
CREATE INDEX security_event_created_idx ON security_event(created_at DESC);

INSERT INTO workspace (id, name, timezone, created_at, updated_at)
VALUES ('workspace', 'Organato', 'Australia/Sydney', datetime('now'), datetime('now'));
