-- Additional opt-in channels. Emails and in-app notifications remain the baseline.
CREATE TABLE delivery_channels (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 telegram_chat_id TEXT,
 telegram_confirmed_at INTEGER,
 telegram_code_hash TEXT,
 telegram_code_expires_at INTEGER,
 telegram_code_attempts INTEGER NOT NULL DEFAULT 0,
 webhook_url TEXT,
 webhook_secret TEXT,
 webhook_enabled INTEGER NOT NULL DEFAULT 0 CHECK(webhook_enabled IN (0,1)),
 updated_at INTEGER NOT NULL
);
CREATE TABLE channel_deliveries (
 notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
 channel TEXT NOT NULL CHECK(channel IN ('telegram','webhook')),
 status TEXT NOT NULL DEFAULT 'pending',
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL,
 sent_at INTEGER,
 last_error TEXT,
 PRIMARY KEY(notification_id,channel)
);
CREATE INDEX idx_channel_deliveries_due ON channel_deliveries(status,next_attempt_at);
