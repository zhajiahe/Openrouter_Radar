-- Model lifecycle is confirmed by two successful, complete catalogues per source.
ALTER TABLE models ADD COLUMN model_kind TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE models ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE models ADD COLUMN missing_count INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_models_kind_status ON models(model_kind,lifecycle_status);

-- Provider/tag is a stable endpoint identity. Mutable display names and tiers are not.
ALTER TABLE endpoints ADD COLUMN stable_key TEXT;
CREATE INDEX idx_endpoints_stable_key ON endpoints(model_id,source,stable_key);

-- All dimensions observed from one successful endpoint snapshot share a scan ID.
ALTER TABLE price_events ADD COLUMN snapshot_id TEXT;
CREATE INDEX idx_events_snapshot ON price_events(snapshot_id);
INSERT OR IGNORE INTO sync_state(name) VALUES ('images_catalog');
