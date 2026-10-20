-- A selective index makes event replay proportional to pending events,
-- instead of scanning the entire historical event table every minute.
CREATE INDEX IF NOT EXISTS idx_events_unmatched_observed
 ON price_events(created_at) WHERE matched_at IS NULL AND quality='observed';

-- Retention runs daily, using this index to avoid scanning 180 days of data.
CREATE INDEX IF NOT EXISTS idx_observations_retention ON price_observations(observed_at);
CREATE INDEX IF NOT EXISTS idx_price_history_retention ON price_history(observed_at);
