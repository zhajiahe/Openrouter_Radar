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

- GET /api/models accepts q, provider (exact provider name), sort (name, newest, context, price), page (1-based), limit (1–100). Search `q` supports up to 8 case-insensitive OR keywords separated by comma (`gpt, claude`), Chinese comma, semicolon, or newline (max 256 input characters, 64 per keyword). Without separators, the full query stays a single substring, including spaces. The response includes total and each model's active Provider count plus lowest observed **base** input token price (USD/token). The price sort uses this normalized displayed price; it does not imply comparability of other billing dimensions or dynamic overrides.
- GET /api/events accepts model_id, q (same multi-keyword OR search over model ID or Provider), kind (exact change code), page, limit (1–100), and returns total. Events are ordered newest-first. Use page links to avoid truncating the public history at 40–50 entries.
- These APIs show recorded data, not confirmed minute-by-minute live quotes. The catalogue and Provider sweeps are best-effort hourly jobs.

## Expanded monitoring, comparison and exports

- GET /api/model?id=... returns collection metadata (fresh/stale/error/never), last attempted and successful Provider scans, plus sanitized errors.
- GET /api/price-history?model_id=...&provider=...&dimension=input|output|cache_read|cache_write|cache_write_1h|... returns sparse observed baseline/change points for known monetary dimensions with explicit units. Use source=model to see the aggregate quote; mode=image for image-unit observations. Includes the last real observation from before the requested window when available, with its actual observed_at timestamp. 180-day retention; no invented hourly samples.
- GET /api/models additionally accepts author, modality, capability, min_context and max_input_price (USD per million Token). Price comparisons only reflect recorded base Token quotes.
- GET /api/events additionally accepts provider, start, end (Unix seconds). GET /api/events/export uses the identical multi-keyword search filters, with CSV or JSON output and a maximum 1,000 rows per request. RSS supports page=.
- PATCH /api/subscriptions/:id edits provider, events, threshold_pct, frequency and paused (boolean). Pausing suppresses queued alerts and new event matching.
- GET /api/subscriptions includes paused, last_hit, last_sent and latest_status. GET /api/notifications includes retry counts and safe delivery error labels.
- No Telegram or Webhook APIs. Delivery is email + in-app; RSS remains public.
- New quality classification: public GET /api/events, /api/events/export, /feed.xml, and 24-hour stats default to quality='observed'. GET /api/events?include_baseline=1 and export?include_baseline=1 retain audit access to legacy baseline_noise entries. CSV/JSON exports include quality.
- Discount changes and previously unrecognized numeric pricing fields are policy changes, not price.increased / price.decreased.
- Legacy records with placeholder '{}' capabilities and companion initial alias / expiration metadata are retained as baseline_noise instead of promoted to market events.

## Complete unit-aware price observations (2026-10-20)

- Subscriptions accept optional `price_dimension` (such as `cache_read`) to restrict price-change alerts to that exact charge category; NULL preserves the all-dimensions behavior, and model lifecycle alerts remain unaffected.

- `/api/v1/models?output_modalities=all` requests the full published modality catalog; dedicated image endpoints remain authoritative for per-image billing. Different catalog sources have distinct success watermarks.
- Prices are stored in `price_observations` with `dimension`, `unit` and `observed_at`. The original two-dimension `price_history` table is retained for migration compatibility and its real rows are copied without altering timestamps.
- New cache, audio, request, image and auxiliary dimensions are seeded only after a *successful actual Provider scan*; legacy history is not fabricated.
- `input_cache_read`, `input_cache_write`, `input_cache_write_1h`, `image_token`, `input_audio_cache` and `internal_reasoning` use USD/token. `audio` and `audio_output` use USD/second; `image` and `image_output` use USD/image; `request` USD/request; `web_search` USD/search.
- Unknown numeric pricing keys remain policy events, not unverified USD increases. Unchanged UTC override schedules which switch effective top-level rates use `price.policy_changed` with a `scheduled_*` dimension rather than unconditional increased/decreased.
- `/api/health` reports `provider_recent` (successful scans during the preceding hour), separately from `provider_scanned` (ever scanned).
- `/api/analytics` adds `priceDimensions` for observed price change dimensions within the requested analytics window.


## Provider 价格稳定性（模型内比较）

`GET /api/provider-stability?model_id=...&days=7|30&dimension=input` 返回相同模型和计价维度的 Provider 价格稳定性。

- `stableDayRate` = `100 × (1 − 有变价记录的端点日数 / (符合条件端点数 × 窗口天数))`。同一端点同一天多次变价仅记 1 个变价端点日，但 `changeCount` 记录全部次数。
- `changeCount`、`increaseCount`、`decreaseCount`、`maxIncreasePct`、`maxDecreasePct`、`lastChangeAt` 按实际报价变化计算；不把不同计费单位混合。
- 只有**每个活跃端点**在统计窗口开始前或当时有真实价格基准，且该模型在最近 3 小时有成功采集时，才返回非空稳定率；否则 `status=insufficient|stale` 且 `stableDayRate=null`。
- 该指标衡量公开标价稳定程度，不是请求成功率、推理结果质量、延迟、吞吐量或 Provider SLA；页面明确标注。
- 实际事件显示「【输入价格】上涨」「【缓存读取价格】下降」等，使用 `eventTitle(kind,dimension)`；数据库中 `kind` 和 `dimension` 保持不变，既有订阅兼容。聚合筛选仍包含所有价格维度。
