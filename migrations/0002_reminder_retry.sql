ALTER TABLE reminder_delivery ADD COLUMN last_attempt_at TEXT;
ALTER TABLE reminder_delivery ADD COLUMN next_attempt_at TEXT;
ALTER TABLE reminder_delivery ADD COLUMN last_error_category TEXT;

CREATE INDEX reminder_delivery_retry_idx
ON reminder_delivery(status, next_attempt_at, created_at DESC);
