-- Backfill all existing model IDs into the global Provider scan queue.
-- Catalogue refresh inserts new models independently of subscriptions.
INSERT OR IGNORE INTO collection_jobs(model_id)
 SELECT id FROM models;
CREATE INDEX IF NOT EXISTS idx_collection_jobs_due
 ON collection_jobs(last_checked,model_id);
