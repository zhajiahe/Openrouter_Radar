# Security Policy

Please report security concerns privately to the repository owner rather than by opening a public exploit issue.

## Threat model

- Only the deploying instance owner configures **OPENROUTER_API_KEY** as a Cloudflare Secret. No visitor or registered user submits an upstream API Key.
- Instance operators also configure RESEND_API_KEY as a Cloudflare Secret. Neither secret belongs in Git, Wrangler `vars`, `VITE_*` build-time variables, or public API responses.
- Passwords are PBKDF2-SHA256 (150,000 iterations + unique salt). Session tokens are cryptographically random and persisted as SHA-256 digests; cookies are HttpOnly, SameSite=Lax and Secure on HTTPS.
- Email verification is mandatory for login and subscription notifications. Password reset invalidates all previous sessions.
- Registration, login and password reset endpoints have IP-based D1 counters; more restrictive public deployments may also deploy Turnstile, Cloudflare WAF and custom limits.
- All user-facing subscription / notification reads and mutations are bound to the authenticated user ID.
- No user-configured URL destination exists: email only to the verified account address, avoiding user-supplied Webhook SSRF risk.
- API errors return sanitized messages. Review operational logs to avoid accidentally logging message bodies, password fields or verification links.

## Disclosure

Do not post secrets or exploit payloads in public GitHub issues. Reach out privately to the repository owner through GitHub security advisories if enabled.

## Production checklist

- Set production `APP_ORIGIN` to HTTPS, verify outbound mail domain, use a secret for Resend.
- Confirm D1 backups, Cloudflare abuse protection, Workers usage caps and log retention.
- Consider enforcing Turnstile, email bounce limits, improved bot protection, MFA and per-account delivery caps before running a large public deployment.
- Avoid running a public domain with `APP_ORIGIN=http://localhost:8787`.

## API-first collection

Never automatically scrape OpenRouter HTML after authentication errors or rate limiting. Having an API Key does not waive Terms of Service. Only enable separate page connectors when explicitly permitted, without CAPTCHA bypass, rate-limit circumvention or unauthorized access. Upstream fetch exceptions must preserve last-known snapshots.
