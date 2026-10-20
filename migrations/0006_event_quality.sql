-- Preserve historical rows while separating first-time metadata backfills from true changes.
ALTER TABLE price_events ADD COLUMN quality TEXT NOT NULL DEFAULT 'observed'
  CHECK(quality IN ('observed','baseline_noise'));

-- Earlier schema upgrades populated capabilities_json from '{}' to full metadata
-- for hundreds of preexisting models in one catalog pass.
UPDATE price_events SET quality='baseline_noise'
 WHERE kind='model.capability_changed' AND old_price='{}' AND new_price IS NOT NULL;

-- The same catalog pass filled previously unknown expiry/alias metadata.
UPDATE price_events SET quality='baseline_noise'
 WHERE kind IN ('model.alias_changed','model.expiration_changed')
 AND old_price IS NULL AND new_price IS NOT NULL
 AND EXISTS(
  SELECT 1 FROM price_events backfill
  WHERE backfill.model_id=price_events.model_id
   AND backfill.created_at=price_events.created_at
   AND backfill.kind='model.capability_changed'
   AND backfill.old_price='{}'
 );

-- Discount changes do not express price direction. Correct their legacy labels.
UPDATE price_events SET kind='price.policy_changed',change_pct=NULL
 WHERE dimension='discount' AND kind IN ('price.increased','price.decreased');

CREATE INDEX idx_price_events_quality_time ON price_events(quality,created_at DESC);
