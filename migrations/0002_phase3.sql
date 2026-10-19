-- Preserve Phase 0–2 data while adding model capability and expiry metadata.
ALTER TABLE models ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE models ADD COLUMN expiration_date INTEGER;
ALTER TABLE models ADD COLUMN alias_target TEXT;
CREATE INDEX idx_models_expiration ON models(expiration_date);
