# Security Policy

Please report security concerns privately to the repository owner rather than by opening a public exploit issue.

## Threat model

- Only the deploying instance owner configures **OPENROUTER_API_KEY** as a Cloudflare Secret. No visitor or registered user submits an upstream API Key.
- Instance operators also configure RESEND_API_KEY as a Cloudflare Secret. Neither secret belongs in Git, Wrangler `vars`, `VITE_*` build-time variables, or public API responses.
- Passwords are PBKDF2-SHA256 (150,000 iterations + unique salt). Session tokens are cryptographically random and persisted as SHA-256 digests; cookies are HttpOnly, SameSite=Lax and Secure on HTTPS.
- Email verification is mandatory for login and subscription notifications. Password reset invalidates all previous sessions.
- Native Cloudflare Workers rate-limit bindings run before D1 reads for API, exports, health, login and mutations; login/register/recovery/reset also have per-identity buckets. Missing bindings fail closed (503). Edge counters are eventually consistent and location-local, not a globally strict brute-force guarantee.
- Only valid verified password-reset recipients consume D1 persistent send quotas (two emails per hour). JSON mutations are limited to 8 KiB, expensive GET query lengths and parameter counts are bounded, and cookie-based mutations need same-origin Origin or Referer evidence.
- All user-facing subscription / notification reads and mutations are bound to the authenticated user ID.
- No user-configured URL destination exists: email only to the verified account address, avoiding user-supplied Webhook SSRF risk.
- API errors return sanitized messages. Review operational logs to avoid accidentally logging message bodies, password fields or verification links.

## Disclosure

Do not post secrets or exploit payloads in public GitHub issues. Reach out privately to the repository owner through GitHub security advisories if enabled.

## Production checklist

- Set production `APP_ORIGIN` to HTTPS, verify outbound mail domain, use a secret for Resend.
- Confirm D1 backups, Cloudflare abuse protection, Workers usage caps and log retention.
- For a custom domain proxied through a Cloudflare zone, enable WAF managed rules, rate rules for `/api/auth/*` and expensive `/api/*`, bot protections and alerting. Worker rate limits are enforced after invoking the Worker; the `workers.dev` hostname alone does not provide zone WAF controls.
- Monitor 429 and 503 responses, D1 row-read/write quotas and mail volumes; never log passwords, cookies, reset URLs or raw identity tokens.
- Consider enforcing Turnstile, email bounce limits, improved bot protection, MFA and per-account delivery caps before running a large public deployment.
- Avoid running a public domain with `APP_ORIGIN=http://localhost:8787`.

## API-first collection

Never automatically scrape OpenRouter HTML after authentication errors or rate limiting. Having an API Key does not waive Terms of Service. Only enable separate page connectors when explicitly permitted, without CAPTCHA bypass, rate-limit circumvention or unauthorized access. Upstream fetch exceptions must preserve last-known snapshots.
