# Runtime Environment Contract

This repo is copied per client site. The platform owns provisioning, writes the environment, runs bootstrap once, and then starts the runtime with migrations on startup.

## Site Runtime

- `NODE_ENV=production`
- `APP_ENV=production` or `staging`
- `APP_NAME`
- `APP_MODE`: `presentation`, `cms`, `shop`, `saas`, or `landing`
- `APP_PUBLIC_URL`: canonical public URL for the generated site
- `API_PREFIX`: usually `/api/v1`
- `PORT`: container port, usually `4000`
- `DATABASE_URL`: PostgreSQL connection string for this copied site
- `MIGRATION_DATABASE_URL`: optional elevated connection used only for startup migrations
- `JWT_ACCESS_SECRET`: unique secret per site, at least 32 characters
- `CORS_ORIGINS`: comma-separated public origins, no wildcard in production
- `TRUST_PROXY`: defaults to `false`; production rejects `true`, so use the exact hop count such as `1` only behind a known reverse proxy
- `SECURITY_AUDIT_KEY`: optional current key for hash-linked audit integrity; defaults to the generated credential-encryption key
- `SECURITY_AUDIT_PREVIOUS_KEYS`: comma-separated previous audit keys retained while old records still need verification

The self-host package generates the migration connection, restricted runtime role, and security keys automatically. End users do not configure or choose these values. Managed CodeY deployments should provide the same values from their secret manager.

## Domains

- `PLATFORM_BASE_DOMAIN`: optional base domain used for platform subdomains such as `default.sites.example.com`
- Custom domains are stored in `SiteDomain` with `PENDING`, `ACTIVE`, `FAILED`, or `DISABLED` status.
- The platform should create DNS guidance for the customer. For a VPS with one public IP, customers normally add an `A` record pointing to the VPS IP. For a CDN/load balancer, use the hostname or IP that infrastructure exposes.

## Modules

The copied runtime reads enabled modules from `InstalledModule`. The platform can choose a deployment profile first, then enable modules through:

```text
GET    /api/v1/config/modules
POST   /api/v1/config/modules/:moduleId/install
POST   /api/v1/config/modules/:moduleId/enable
POST   /api/v1/config/modules/:moduleId/disable
PATCH  /api/v1/config/modules/:moduleId/settings
```

Use `GET /api/v1/config/compatibility` before enabling paid modules. It returns the module version, dependency, profile, plan, lifecycle, and base-version compatibility matrix used by the platform generator.

Runtime enable/disable takes effect immediately for modules included in the deployed profile. Enabling a module outside that profile is rejected because its Prisma schema and routes are not part of the built runtime.

## Storage

Production media storage must be S3-compatible. The platform default is Cloudflare R2 because it uses the S3 API and fits the Cloudflare domain/DNS flow:

- `STORAGE_DRIVER=s3`
- `STORAGE_S3_ENDPOINT`
- `STORAGE_S3_REGION`
- `STORAGE_S3_BUCKET`
- `STORAGE_S3_ACCESS_KEY_ID`
- `STORAGE_S3_SECRET_ACCESS_KEY`
- `STORAGE_S3_FORCE_PATH_STYLE`
- `STORAGE_PUBLIC_BASE_URL`
- `STORAGE_KEY_PREFIX`
- `STORAGE_SIGNED_URL_TTL_SECONDS`
- `STORAGE_MAX_UPLOAD_BYTES`
- `STORAGE_UPLOAD_BODY_LIMIT`
- `STORAGE_IMAGE_VARIANT_WIDTHS`
- `MEDIA_MAX_PIXELS`
- `MEDIA_MAX_WIDTH`
- `MEDIA_MAX_HEIGHT`
- `MEDIA_MAX_FRAMES`
- `MEDIA_PROCESSING_CONCURRENCY`
- `STORAGE_QUOTA_DEFAULT_MB`
- `STORAGE_QUOTA_PRESENTATION_MB`
- `STORAGE_QUOTA_CMS_MB`
- `STORAGE_QUOTA_SHOP_MB`
- `STORAGE_QUOTA_SAAS_MB`

`MEDIA_MAX_PIXELS`, `MEDIA_MAX_WIDTH`, `MEDIA_MAX_HEIGHT`, and `MEDIA_MAX_FRAMES` bound decoded image work, including animated files. `MEDIA_PROCESSING_CONCURRENCY` limits simultaneous variant jobs per CMS process. Keep the defaults unless the host has been sized and monitored for larger workloads; raising upload bytes alone does not relax decoded-image protections.

Site owners choose **Local storage**, **Amazon S3**, or **Cloudflare R2** under **Settings > Storage**. S3 and R2 access keys are encrypted database settings and remain write-only. A new connection is tested before activation. When the current media URLs use the stable `/uploads/...` proxy, existing objects are copied before a provider change becomes active. Custom S3-compatible endpoints remain an environment-only deployment option so browser-entered URLs cannot reach private server networks.

The environment values below remain a bootstrap fallback for managed deployments and existing installations. The platform must still assign each copied runtime a unique `STORAGE_KEY_PREFIX`; this tenant boundary and the local filesystem path are deployment-owned and are not editable in the browser. Media objects are written below that directory, for example `sites/project-123/media/...`.

Recommended Cloudflare R2 production example:

```env
STORAGE_DRIVER=s3
STORAGE_S3_ENDPOINT=https://<cloudflare-account-id>.r2.cloudflarestorage.com
STORAGE_S3_REGION=auto
STORAGE_S3_BUCKET=codey-media-prod
STORAGE_S3_FORCE_PATH_STYLE=true
STORAGE_PUBLIC_BASE_URL=https://media.usecodey.com
STORAGE_KEY_PREFIX=sites/{project-id}/media
```

For AWS S3, use the AWS regional endpoint, the real region such as `eu-central-1`, and usually `STORAGE_S3_FORCE_PATH_STYLE=false`.

When environment fallback is used, store `STORAGE_S3_ACCESS_KEY_ID` and `STORAGE_S3_SECRET_ACCESS_KEY` only in the real server/VPS environment or secret manager. Never commit those values. Dashboard-managed credentials are encrypted with `CMS_CREDENTIAL_ENCRYPTION_KEY` and are never returned by an API.

Before launch, verify upload, responsive variant delivery, signed download, and deletion against the configured S3-compatible bucket.

## Dashboard Credentials, Payments And Email

Production runtimes need `CMS_CREDENTIAL_ENCRYPTION_KEY` to encrypt site-owned credentials and MFA secrets at rest. It also keys recovery codes and persisted login-throttle identifiers. This is stable deployment-owned infrastructure material, not a provider credential.

Site owners configure Stripe and PayPal under **Shop > Shop Configuration** and transactional email under **Settings > Email**. Transactional email supports Resend, Postmark, SMTP, and a generic HTTPS adapter. SMTP passwords and provider API keys are encrypted site settings and remain write-only. Read APIs return public identifiers and credential status; decrypted secrets never leave the server. Online payment credentials and connection tests require secret-management permission and recent authentication; manual-payment instructions remain available to users with ordinary payment-update permission.

The email form supports Resend and Postmark presets, SMTP, and a generic HTTP provider. Provider credentials are write-only, stored in an encrypted envelope, and can be tested from the dashboard. Owners can enable account recovery after a provider is configured without editing runtime environment files. Generic endpoints receive a JSON message containing `to`, `from`, `subject`, `text`, optional `html`, and `metadata`. Email endpoints must use HTTP or HTTPS, and production endpoints must use HTTPS.

These environment values are an optional initial fallback for transactional email:

- `EMAIL_DRIVER=http`
- `EMAIL_FROM`
- `EMAIL_HTTP_ENDPOINT`
- `EMAIL_HTTP_BEARER_TOKEN` when the email provider requires it
- `EMAIL_TIMEOUT_MS`

Order received, paid, refunded, and status-change notifications are queued in the database and delivered through the configured HTTP email adapter.

Stripe API keys, Stripe webhook signing secrets, PayPal client credentials, and PayPal webhook IDs are not runtime environment variables.

`CMS_CREDENTIAL_ENCRYPTION_KEY` is deployment-owned infrastructure material, not a payment-provider credential. Use a unique high-entropy value, store it in the platform secret manager, back it up securely, and do not rotate it without a credential migration.

Audit keys can rotate independently. Move the old `SECURITY_AUDIT_KEY` into `SECURITY_AUDIT_PREVIOUS_KEYS`, set a new current key, deploy, and keep the previous key for as long as its history must verify. MFA secret envelopes created by the earlier security release migrate to the stable credential key after successful use. Existing recovery-code hashes still need the former key until the user disables and re-enables MFA to generate new codes.

See [payment-providers.md](payment-providers.md) for setup, checkout, webhook, retry, and credential-rotation flows.

## Checkout Protection

Checkout abuse controls are enforced through PostgreSQL so they remain consistent across multiple CMS processes. Limiter identifiers for email addresses and client IPs are keyed hashes; the limiter table never stores the original values.

- `CHECKOUT_MAX_ITEM_QUANTITY`: maximum units for one product or variant, default `20`
- `CHECKOUT_MAX_ORDER_ITEMS`: maximum order lines, default `50`
- `CHECKOUT_RATE_LIMIT_MAX`: attempts per protected checkout route in 15 minutes, default `15`
- `CHECKOUT_PENDING_ORDER_LIMIT_PER_EMAIL`: active unpaid orders per normalized email, default `3`
- `CHECKOUT_PENDING_ORDER_LIMIT_PER_IP`: active unpaid orders per client IP, default `5`
- `ORDER_RESERVATION_TTL_MINUTES`: temporary payment inventory hold, default `10`

Rate-limited API responses include `Retry-After` and the standard CodeY error envelope. Pending-order limits are checked while holding PostgreSQL advisory transaction locks, so two application instances cannot create checkouts past the configured limit.

## Auth Recovery

`AUTH_RECOVERY_TOKEN_DELIVERY=response` is only for local development and tests. Production rejects response-based token delivery.

Production password recovery and email verification require:

- `AUTH_RECOVERY_TOKEN_DELIVERY=email`
- `APP_PUBLIC_URL`
- Transactional email saved and enabled under **Settings > Email**, or the environment fallback above
- A successful provider test before production launch

Email verification and password reset tokens are created server-side, delivered through the email adapter, and hidden from API responses in production. The same email configuration delivers invitations; administrators can instead copy a manual invite URL when transactional email is unavailable.

## Maintenance And Observability

- `MAINTENANCE_MODE=true` enables environment-level maintenance mode.
- `MAINTENANCE_MESSAGE` controls the 503 response message.
- `MAINTENANCE_ALLOWED_PATHS` keeps health, auth, and config access available while maintenance is active.
- Environment-level maintenance is authoritative; DB settings cannot disable `MAINTENANCE_MODE=true`.
- `GET /api/v1/config/maintenance` reads DB-level maintenance settings.
- `PATCH /api/v1/config/maintenance` changes DB-level maintenance settings and writes an audit log.
- All API success/error envelopes include `meta.requestId` when request context is available.
- Requests with a valid W3C `traceparent` header also include `meta.traceId` and `x-trace-id`.
- `GET /api/v1/health/ready` is an unauthenticated, minimal traffic-readiness result.
- `GET /api/v1/health/diagnostics` returns detailed readiness, backup, and process telemetry to users with `manage:modules`.
- `GET /api/v1/config/launch-readiness` gives authenticated managers an actionable local/public launch checklist without exposing diagnostics publicly.
- `GET /api/v1/health/metrics` remains available to users with `manage:modules` for compatibility.
- `GET /api/v1/config/audit-logs` returns the hash-linked audit trail for sensitive operations with `valid`, `invalid`, `unknown-key`, or `legacy` integrity status.

## Operations

- Start runtime: `pnpm runtime:start`
- First bootstrap after provisioning: `pnpm runtime:bootstrap`
- Backup: `pnpm runtime:backup`
- Scheduled backup worker: `pnpm runtime:backup:scheduler`
- Inventory check: `pnpm inventory:reconcile` (dry run)
- Inventory repair: `pnpm inventory:reconcile --repair` (audited)
- Restore: `pnpm runtime:restore -- /path/to/runtime.dump`

`runtime:start` deploys migrations before starting the API. `runtime:bootstrap` deploys migrations and runs the idempotent seed flow once after a new copied site is provisioned. By default, the seed creates only runtime roles, module settings, and an editable Home page; it does not publish sample posts, products, coupons, or shipping rules. Set `CODEY_SEED_DEMO_CONTENT=true` only for an intentional local demo or test fixture. The seed only creates an owner when explicit `CODEY_ADMIN_EMAIL` and `CODEY_ADMIN_PASSWORD` values are present; otherwise run `pnpm setup:admin` after bootstrap. If the configured email already belongs to a non-owner, the seed refuses to elevate it and `pnpm setup:admin` must be used to reset its password and sessions during promotion.

Backup controls are `BACKUP_DIR`, `BACKUP_MIRROR_DIR`, `BACKUP_RETENTION_DAYS`, `BACKUP_INTERVAL_HOURS`, `BACKUP_MAX_AGE_HOURS`, `BACKUP_REQUIRED`, `BACKUP_ENCRYPTION_KEY`, `BACKUP_REQUIRE_ENCRYPTION`, `BACKUP_OFFSITE_REQUIRED`, `BACKUP_OFFSITE_PROTECTED`, `BACKUP_S3_MEDIA_PROTECTED`, and the optional alert webhook values. The backup job reads the active non-secret storage provider metadata from the database, so dashboard-managed S3 and R2 storage still require protected object versioning or replication. Production should require encryption, a recent successful backup, and a tested off-site mirror. See [backup-disaster-recovery.md](backup-disaster-recovery.md).

Production restore requires `ALLOW_PRODUCTION_RESTORE=true`. Use the generated manifest so checksums, encryption, and matching media are verified.

## Readiness

Use `/api/v1/health/ready` for container and reverse-proxy health checks. Its response contains only `ready` or `not_ready`; internal check results are never exposed publicly. It verifies the database query path, live storage connectivity, dashboard-managed email state, and the last provider test. Backup failures do not take a working website offline.

Authenticated owners can use `/api/v1/health/diagnostics` for detailed runtime checks, process telemetry, backup freshness, encryption, mirroring, and off-site protection. `/api/v1/health/metrics` is also authenticated and retained as a compatibility endpoint.
