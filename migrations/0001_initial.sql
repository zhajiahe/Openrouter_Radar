CREATE TABLE users (
 id TEXT PRIMARY KEY,
 email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 email_verified INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL
);
CREATE TABLE sessions (
 id_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE TABLE email_tokens (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 purpose TEXT NOT NULL CHECK(purpose IN ('verify','reset')),
 expires_at INTEGER NOT NULL
);
CREATE INDEX idx_email_tokens_user ON email_tokens(user_id);
CREATE TABLE rate_limits (
 key TEXT PRIMARY KEY,
 count INTEGER NOT NULL,
 reset_at INTEGER NOT NULL
);
CREATE TABLE models (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 pricing_json TEXT NOT NULL DEFAULT '{}',
 context_length INTEGER,
 updated_at INTEGER NOT NULL
);
CREATE INDEX idx_models_name ON models(name);
CREATE TABLE endpoints (
 id TEXT PRIMARY KEY,
 model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
 provider TEXT NOT NULL,
 tag TEXT NOT NULL,
 source TEXT NOT NULL CHECK(source IN ('model','provider')),
 input_price TEXT,
 output_price TEXT,
 pricing_json TEXT NOT NULL,
 missing_count INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'active',
 first_seen INTEGER NOT NULL,
 checked_at INTEGER NOT NULL
);
CREATE INDEX idx_endpoints_model ON endpoints(model_id);
CREATE INDEX idx_endpoints_provider ON endpoints(provider);
CREATE TABLE price_events (
 id TEXT PRIMARY KEY,
 endpoint_id TEXT NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
 model_id TEXT NOT NULL,
 provider TEXT NOT NULL,
 kind TEXT NOT NULL,
 dimension TEXT,
 old_price TEXT,
 new_price TEXT,
 change_pct REAL,
 created_at INTEGER NOT NULL,
 matched_at INTEGER
);
CREATE INDEX idx_events_model_time ON price_events(model_id,created_at DESC);
CREATE INDEX idx_events_created ON price_events(created_at DESC);
CREATE TABLE subscriptions (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
 provider TEXT,
 events_json TEXT NOT NULL,
 threshold_pct REAL NOT NULL DEFAULT 0,
 frequency TEXT NOT NULL CHECK(frequency IN ('instant','daily')),
 created_at INTEGER NOT NULL
);
CREATE INDEX idx_subscriptions_model ON subscriptions(model_id);
CREATE INDEX idx_subscriptions_user ON subscriptions(user_id);
CREATE TABLE notifications (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 event_id TEXT NOT NULL REFERENCES price_events(id) ON DELETE CASCADE,
 subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'pending',
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL,
 sent_at INTEGER,
 read_at INTEGER,
 created_at INTEGER NOT NULL,
 UNIQUE(user_id,event_id,subscription_id)
);
CREATE INDEX idx_notifications_pending ON notifications(status,next_attempt_at);
CREATE INDEX idx_notifications_user ON notifications(user_id,created_at DESC);
CREATE TABLE collection_jobs (
 model_id TEXT PRIMARY KEY REFERENCES models(id) ON DELETE CASCADE,
 last_checked INTEGER NOT NULL DEFAULT 0,
 leased_until INTEGER NOT NULL DEFAULT 0,
 last_error TEXT
);
CREATE TABLE sync_state (
 name TEXT PRIMARY KEY,
 last_success INTEGER NOT NULL DEFAULT 0,
 leased_until INTEGER NOT NULL DEFAULT 0,
 last_error TEXT
);
INSERT INTO sync_state(name) VALUES ('catalog');
