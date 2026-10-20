-- One-time seed flag for endpoints that predate the sparse history feature.
-- Old endpoints become historical baselines only after the next successful real Provider scan.
ALTER TABLE endpoints ADD COLUMN history_seeded INTEGER NOT NULL DEFAULT 0;
