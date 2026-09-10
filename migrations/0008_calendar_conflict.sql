-- Retain the conflicting Google event so explicit resolution can apply it.
ALTER TABLE calendar_link ADD COLUMN conflict_event_json TEXT;
ALTER TABLE calendar_link ADD COLUMN conflict_etag TEXT;
