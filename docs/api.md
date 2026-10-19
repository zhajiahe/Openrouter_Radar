# Radar HTTP API (V1)

All endpoints are mounted on one Hono Worker. Body parameters are JSON. Session credentials are stored in an HTTP-only `radar_session` cookie and are never returned in JSON.

## Public

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Current sync status; returns 503 until initial sync |
| GET | `/api/stats` | Public model/provider/subscription/event counts |
| GET | `/api/models?q=...&page=1&limit=30` | Model search (limit max 100) |
| GET | `/api/model?id=author/model` | Model details & endpoint snapshots |
| GET | `/api/providers` | Seen provider list (after subscribed models are scanned) |
| GET | `/api/events?model_id=...` | Recent immutable events |
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

- A newly encountered endpoint establishes a baseline. On later runs, genuine new providers may generate `endpoint.added`.
- Two consecutive **successful and non-empty** provider snapshots must omit an endpoint before a removal event is emitted.
- HTTP 403, 429, 500, invalid response and empty endpoint sets do **not** constitute endpoint removals.
- Price changes are computed independently for input and output dimensions using decimal arithmetic.
- Each notified rule generates a notification record. Emails are retried up to five attempts if delivery fails.
- Initial provider prices are not backfilled historically; all records start from first observation.

## Phase 3 events and owner-key policy

All upstream requests require the instance's `OPENROUTER_API_KEY` secret, which is never sent to a browser or accepted in an end-user request.

Additional event types are `price.policy_changed` (cache-related dimensions and `overrides` rule changes), `model.context_changed`, `model.capability_changed`, `model.alias_changed`, `model.expiration_changed`, and `model.expiring`. The last event fires once per model, expiration timestamp and 30/7/1-day warning window. Existing subscriptions remain unchanged; select the new event types explicitly.

The event store reuses the existing `price_events` table for compatibility. When the event is non-numeric, `old_price` / `new_price` carry before/after values (including JSON for complex policy differences), so do not assume these fields always represent USD per token. Only `price.increased` and `price.decreased` use `change_pct` and subscription price thresholds.
