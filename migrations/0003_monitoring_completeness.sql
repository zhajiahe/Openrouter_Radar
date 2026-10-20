-- Monitoring completeness: sparse observed price history and subscriber controls.
ALTER TABLE collection_jobs ADD COLUMN last_success INTEGER NOT NULL DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0,1));
ALTER TABLE notifications ADD COLUMN last_error TEXT;
CREATE TABLE price_history (
 endpoint_id TEXT NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
 model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
 provider TEXT NOT NULL,
 source TEXT NOT NULL CHECK(source IN ('model','provider')),
 dimension TEXT NOT NULL CHECK(dimension IN ('input','output')),
 price TEXT NOT NULL,
 observed_at INTEGER NOT NULL,
 PRIMARY KEY(endpoint_id,dimension,observed_at)
);
CREATE INDEX idx_price_history_model_time ON price_history(model_id,observed_at DESC);
CREATE INDEX idx_price_history_endpoint_time ON price_history(endpoint_id,dimension,observed_at DESC);
CREATE INDEX idx_events_kind_time ON price_events(kind,created_at DESC);
CREATE INDEX idx_notifications_subscription ON notifications(subscription_id,created_at DESC);
