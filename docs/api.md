# Radar HTTP API (V1)

All endpoints are mounted on one Hono Worker. Body parameters are JSON. Session credentials are stored in an HTTP-only `radar_session` cookie and are never returned in JSON.

## Public

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Catalogue and global Provider sweep status; returns 503 until initial sync or during degraded state |
| GET | `/api/stats` | Public model/provider/subscription/event counts |
| GET | `/api/models?q=...&page=1&limit=30` | Model search and pagination (limit max 100, sort=name|newest|context|price, provider=exact provider). Response adds total, lowest_input (USD/token), provider_count |
| GET | `/api/model?id=author/model` | Model details & endpoint snapshots |
| GET | `/api/providers` | Seen providers (all-model global scan, independent of subscriptions) |
| GET | `/api/events?model_id=...` | Paginated immutable events (model_id, q, kind, page, limit). Response adds total |
| GET | `/feed.xml` | RSS |
| POST | `/api/auth/register` | Registration; send verification email |
| GET | `/api/auth/verify?token=...` | Verify email and redirect home |
| POST | `/api/auth/login` | Login verified user |
| POST | `/api/auth/logout` | Destroy current session |
| POST | `/api/auth/forgot-password` | Send reset token |
| POST | `/api/auth/reset-password` | Consume reset token |

## Authenticated

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/auth/me` | Account info |
| GET | `/api/subscriptions` | Own monitoring rules |
| POST | `/api/subscriptions` | Create a monitoring rule |
| DELETE | `/api/subscriptions/:id` | Remove own rule |
| GET | `/api/notifications` | Own notifications and delivery status |
| PATCH | `/api/notifications/:id/read` | Mark own notification read |
| GET | `/api/my-stats` | Own subscription/unread counts |

Example subscription:

```json
{
  "model_id": "deepseek/deepseek-chat",
  "provider": null,
  "events": ["price.decreased", "price.increased", "price.policy_changed", "endpoint.added", "endpoint.removed", "endpoint.restored", "model.context_changed", "model.capability_changed", "model.alias_changed", "model.expiration_changed", "model.expiring"],
  "threshold_pct": 10,
  "frequency": "instant"
}
```

`provider=null` watches all providers; non-empty provider watches only that exact returned Provider name. `threshold_pct` affects only price events. `frequency` is `instant` or `daily` (next 08:00 UTC). Maximum 50 rules per user. Price values are stored and returned as decimal USD/token strings; dashboard displays USD per million tokens.

No endpoint accepts a user-supplied OpenRouter API key. Billing, metering, inference forwarding and cost-estimation endpoints do not exist.

## Event correctness

- The global scanner establishes endpoint baselines even with zero subscriptions. Creating or deleting subscriptions never starts or stops collection. A newly encountered endpoint establishes a baseline. On later runs, genuine new providers may generate `endpoint.added`.
- Two consecutive **successful and non-empty** provider snapshots must omit an endpoint before a removal event is emitted.
- HTTP 403, 429, 500, invalid response and empty endpoint sets do **not** constitute endpoint removals.
- Price changes are computed independently for input and output dimensions using decimal arithmetic.
- Each notified rule generates a notification record. Emails are retried up to five attempts if delivery fails.
- Initial provider prices are not backfilled historically; all records start from first observation.

## Phase 3 events and owner-key policy

All upstream requests require the instance's `OPENROUTER_API_KEY` secret, which is never sent to a browser or accepted in an end-user request.

Additional event types are `price.policy_changed` (cache-related dimensions and `overrides` rule changes), `model.context_changed`, `model.capability_changed`, `model.alias_changed`, `model.expiration_changed`, and `model.expiring`. The last event fires once per model, expiration timestamp and 30/7/1-day warning window. Existing subscriptions remain unchanged; select the new event types explicitly.

The event store reuses the existing `price_events` table for compatibility. When the event is non-numeric, `old_price` / `new_price` carry before/after values (including JSON for complex policy differences), so do not assume these fields always represent USD per token. Only `price.increased` and `price.decreased` use `change_pct` and subscription price thresholds.

## Hourly global collection

The Durable Object alarm wakes each minute. The full model catalogue refreshes once an hour, and **every** discovered model has a `collection_jobs` row. Providers are checked once their prior attempt is at least one hour old, in batches of 15 models per alarm by default (1–25 configurable by `MAX_MODELS_PER_TICK`). Subscriptions only match recorded changes and queue notifications; they never influence which models are collected. `/api/health` reports `provider_total`, `provider_scanned`, `provider_due`, `provider_errors` and interval fields. Hourly is a best-effort target, subject to model count, latency and quotas.

## Model discovery and change feed

- GET /api/models accepts q, provider (exact provider name), sort (name, newest, context, price), page (1-based), limit (1–100). The response includes total and each model's active Provider count plus lowest observed **base** input token price (USD/token). The price sort uses this normalized displayed price; it does not imply comparability of other billing dimensions or dynamic overrides.
- GET /api/events accepts model_id, q (substring of model ID or Provider), kind (exact change code), page, limit (1–100), and returns total. Events are ordered newest-first. Use page links to avoid truncating the public history at 40–50 entries.
- These APIs show recorded data, not confirmed minute-by-minute live quotes. The catalogue and Provider sweeps are best-effort hourly jobs.
