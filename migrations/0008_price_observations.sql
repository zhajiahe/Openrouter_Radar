-- Flexible, explicitly unit-qualified sparse observations. Preserve old limited table and exact timestamps.
CREATE TABLE price_observations (
 endpoint_id TEXT NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
 model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
 provider TEXT NOT NULL,
 source TEXT NOT NULL CHECK(source IN ('model','provider')),
 dimension TEXT NOT NULL,
 unit TEXT NOT NULL,
 price TEXT NOT NULL,
 observed_at INTEGER NOT NULL,
 PRIMARY KEY(endpoint_id,dimension,observed_at)
);
CREATE INDEX idx_observations_model_dimension ON price_observations(model_id,source,dimension,observed_at DESC);
CREATE INDEX idx_observations_endpoint ON price_observations(endpoint_id,dimension,observed_at DESC);
INSERT OR IGNORE INTO price_observations(endpoint_id,model_id,provider,source,dimension,unit,price,observed_at)
 SELECT endpoint_id,model_id,provider,source,dimension,'USD/token',price,observed_at FROM price_history;
-- Fill newly supported dimensions at the next successful real Provider scan.
UPDATE endpoints SET history_seeded=0 WHERE source='provider';
