# Generated Site Security Checklist

Use this checklist before a generated site is published.

## Runtime

- `NODE_ENV=production`.
- `APP_PUBLIC_URL` points to the final public URL.
- `CORS_ORIGINS` contains only trusted origins.
- `TRUST_PROXY` is `false` for direct hosting, or a numeric hop count matching the exact trusted reverse-proxy path; never use `true` in production.
- PostgreSQL connection and mutation logs are retained off-host when audit evidence must survive a server compromise.
- Audit records show `Verified`; `Changed` indicates a broken signature or missing predecessor link, while `Key unavailable` means a required previous audit key is absent.
- Owners and administrators enable two-step verification under **Profile** and store recovery codes outside the server.
- **Settings > Security** is reviewed for denied actions or changed audit records.
- `JWT_ACCESS_SECRET` is unique per copied site and at least 32 characters.
- `AUTH_RECOVERY_TOKEN_DELIVERY=email` when password recovery or email verification is enabled, and when invitations should be delivered automatically.
- Transactional email is configured with an HTTPS endpoint and provider-tested under **Settings > Email** for auth recovery and shop notifications.
- `STORAGE_DRIVER=s3` is enabled for production media.
- `STORAGE_KEY_PREFIX` is unique per customer site.
- `CMS_CREDENTIAL_ENCRYPTION_KEY` is unique, backed up, and stored in the platform secret manager.
- `SECURITY_AUDIT_KEY` is stored outside the database, and old values remain in `SECURITY_AUDIT_PREVIOUS_KEYS` for the required verification-retention period.
- `BACKUP_REQUIRED=true`, `BACKUP_REQUIRE_ENCRYPTION=true`, and a unique `BACKUP_ENCRYPTION_KEY` are set.
- S3 versioning or replication has been tested before `BACKUP_S3_MEDIA_PROTECTED=true` is set.

## Content And Access

- Draft products and CMS content are not visible publicly.
- Client roles only have the permissions required for their modules.
- Admin users use strong passwords and verified emails.
- Public form endpoints keep anti-spam checks enabled.
- Uploaded media is limited to the supported image, video, and PDF allowlist; extension, MIME, kind, and file signatures must agree.
- Rich text is sanitized on write and again before public server rendering.

## Payments

- Checkout prices are calculated server-side.
- Stock is reserved in the order transaction and unpaid reservations expire after 30 minutes.
- Cancellation, abandonment, expiry, and failed payment release stock and coupon usage atomically.
- Provider credentials are configured through the authenticated dashboard and never returned by read APIs.
- Stripe and PayPal remain disabled until required credentials are saved and the connection test succeeds.
- Stripe webhook signatures use the raw request body and enforce replay tolerance.
- PayPal webhook signatures are verified with PayPal using the configured webhook ID.
- Provider webhook endpoints use HTTPS and subscribe only to the documented payment events.
- Payment status changes are idempotent through `providerEventId`.
- Provider amount and currency must match the stored server-side order before payment succeeds.

## Launch

- `/api/v1/health/ready` returns ready.
- Authenticated `/api/v1/health/diagnostics` reports a healthy runtime and protected backup.
- Anonymous requests to `/api/v1/health/diagnostics` and `/api/v1/health/metrics` are rejected.
- The primary custom domain is active in `SiteDomain`.
- Reverse proxy TLS is issued and redirects HTTP to HTTPS.
- Backup and restore have both been tested against an isolated database.
- Maintenance mode is disabled.
