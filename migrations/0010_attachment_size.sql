-- Track uploaded file sizes so per-workspace storage quotas cap abuse on
-- open-registration deployments.
ALTER TABLE attachment_link ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0;
