-- Portable SQLite / Cloudflare D1 integration tables.
-- Spoke apps need ato_outbox, ato_command_receipt, and ato_request_nonce.
-- Ato Centre additionally uses ato_sync_cursor and ato_projection.
-- Apply with the same immutable, forward-only migration process as app tables.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ato_outbox (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL,
  event_type TEXT NOT NULL,
  resource_version INTEGER NOT NULL CHECK (resource_version > 0),
  envelope_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  CHECK (length(envelope_json) <= 262144)
);

CREATE INDEX IF NOT EXISTS ato_outbox_expiry_idx
  ON ato_outbox(expires_at);

CREATE TABLE IF NOT EXISTS ato_command_receipt (
  idempotency_key TEXT PRIMARY KEY,
  command_id TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  command_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  response_status INTEGER,
  response_json TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  expires_at TEXT NOT NULL,
  CHECK (response_json IS NULL OR length(response_json) <= 262144)
);

CREATE INDEX IF NOT EXISTS ato_command_receipt_expiry_idx
  ON ato_command_receipt(expires_at);

CREATE TABLE IF NOT EXISTS ato_request_nonce (
  key_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (key_id, nonce)
);

CREATE INDEX IF NOT EXISTS ato_request_nonce_expiry_idx
  ON ato_request_nonce(expires_at);

CREATE TABLE IF NOT EXISTS ato_sync_cursor (
  source_app TEXT PRIMARY KEY,
  cursor TEXT,
  last_event_id TEXT,
  last_success_at TEXT,
  last_attempt_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  resnapshot_required INTEGER NOT NULL DEFAULT 0 CHECK (resnapshot_required IN (0, 1)),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ato_projection (
  canonical_id TEXT PRIMARY KEY,
  owner_app TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_version INTEGER NOT NULL CHECK (resource_version > 0),
  projection_json TEXT NOT NULL,
  source_sequence INTEGER NOT NULL CHECK (source_sequence > 0),
  source_occurred_at TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  deleted_at TEXT,
  indexed_at TEXT NOT NULL,
  CHECK (length(projection_json) <= 262144)
);

CREATE INDEX IF NOT EXISTS ato_projection_feed_idx
  ON ato_projection(deleted_at, source_occurred_at DESC);

CREATE INDEX IF NOT EXISTS ato_projection_owner_idx
  ON ato_projection(owner_app, resource_type, deleted_at, source_sequence);
