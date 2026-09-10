-- Make OAuth completion idempotent and retry-safe.
ALTER TABLE oauth_transaction ADD COLUMN claimed_at TEXT;
CREATE TABLE IF NOT EXISTS completed_oauth_exchange (
  state_hash TEXT PRIMARY KEY,
  csrf_token TEXT NOT NULL,
  return_to TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS completed_oauth_exchange_created_idx
  ON completed_oauth_exchange(created_at);
