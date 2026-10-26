-- Cover the date-window analytics reads without scanning irrelevant or unobserved events.
-- Partial indexes limit storage/write overhead to rows displayed on public dashboards.
CREATE INDEX IF NOT EXISTS idx_events_observed_window
 ON price_events(created_at DESC,kind,dimension) WHERE quality='observed';

-- The provider coverage chart groups active provider/model pairs.
CREATE INDEX IF NOT EXISTS idx_active_endpoint_provider_model
 ON endpoints(provider,model_id) WHERE source='provider' AND status='active';
