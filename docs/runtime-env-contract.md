# Runtime Environment Contract

This repo is copied per client site. The platform owns provisioning, writes the environment, runs bootstrap once, and then starts the runtime with migrations on startup.

## Required Per Site

- `NODE_ENV=production`
- `APP_ENV=production` or `staging`
- `APP_NAME`
- `APP_MODE`: `presentation`, `cms`, `shop`, `saas`, or `landing`
- `APP_PUBLIC_URL`: canonical public URL for the generated site
- `API_PREFIX`: usually `/api/v1`
- `PORT`: container port, usually `4000`
- `DATABASE_URL`: PostgreSQL connection string for this copied site
- `JWT_ACCESS_SECRET`: unique secret per site, at least 32 characters
- `CORS_ORIGINS`: comma-separated public origins, no wildcard in production

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
- `STORAGE_QUOTA_DEFAULT_MB`
- `STORAGE_QUOTA_PRESENTATION_MB`
- `STORAGE_QUOTA_CMS_MB`
- `STORAGE_QUOTA_SHOP_MB`
- `STORAGE_QUOTA_SAAS_MB`

Codey supports one shared S3-compatible account and bucket for many copied customer runtimes. Keep the connection values managed by the platform, but assign each copied runtime a unique `STORAGE_KEY_PREFIX`. Media objects are written below that directory, for example `sites/project-123/media/...`.

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

Store `STORAGE_S3_ACCESS_KEY_ID` and `STORAGE_S3_SECRET_ACCESS_KEY` only in the real server/VPS environment or secret manager. Never commit those values.

Before launch, verify upload, responsive variant delivery, signed download, and deletion against the configured S3-compatible bucket.

## Payments And Email

Shop runtimes need:

- `CMS_CREDENTIAL_ENCRYPTION_KEY` to encrypt site-owned provider credentials at rest
- `EMAIL_DRIVER=http`
- `EMAIL_FROM`
- `EMAIL_HTTP_ENDPOINT`
- `EMAIL_HTTP_BEARER_TOKEN` when the email provider requires it
- `EMAIL_TIMEOUT_MS`

Order received, paid, refunded, and status-change notifications are queued in the database and delivered through the configured HTTP email adapter.

Stripe API keys, Stripe webhook signing secrets, PayPal client credentials, and PayPal webhook IDs are not runtime environment variables. A site owner configures them under **Shop > Shop Configuration**. The API only returns public provider identifiers and write-only secret status; encrypted credentials never leave the server.

`CMS_CREDENTIAL_ENCRYPTION_KEY` is deployment-owned infrastructure material, not a payment-provider credential. Use a unique high-entropy value, store it in the platform secret manager, back it up securely, and do not rotate it without re-encrypting or re-entering every saved provider secret.

See [payment-providers.md](payment-providers.md) for setup, checkout, webhook, retry, and credential-rotation flows.

## Auth Recovery

`AUTH_RECOVERY_TOKEN_DELIVERY=response` is only for local development and tests. Production rejects response-based token delivery.

Production auth recovery and invite flows require:

- `AUTH_RECOVERY_TOKEN_DELIVERY=email`
- `APP_PUBLIC_URL`
- `EMAIL_DRIVER=http`
- `EMAIL_FROM`
- `EMAIL_HTTP_ENDPOINT`

Email verification, password reset, and invite tokens are created server-side, delivered through the email adapter, and hidden from API responses in production.

## Maintenance And Observability

- `MAINTENANCE_MODE=true` enables environment-level maintenance mode.
- `MAINTENANCE_MESSAGE` controls the 503 response message.
- `MAINTENANCE_ALLOWED_PATHS` keeps health, auth, and config access available while maintenance is active.
- Environment-level maintenance is authoritative; DB settings cannot disable `MAINTENANCE_MODE=true`.
- `GET /api/v1/config/maintenance` reads DB-level maintenance settings.
- `PATCH /api/v1/config/maintenance` changes DB-level maintenance settings and writes an audit log.
- All API success/error envelopes include `meta.requestId` when request context is available.
- Requests with a valid W3C `traceparent` header also include `meta.traceId` and `x-trace-id`.
- `GET /api/v1/health/metrics` returns process telemetry for operational checks.
- `GET /api/v1/config/audit-logs` returns the structured audit trail for sensitive operations.

## Operations

- Start runtime: `pnpm runtime:start`
- First bootstrap after provisioning: `pnpm runtime:bootstrap`
- Backup: `pnpm runtime:backup`
- Restore: `pnpm runtime:restore -- /path/to/runtime.dump`

`runtime:start` deploys migrations before starting the API. `runtime:bootstrap` deploys migrations and runs the idempotent seed flow once after a new copied site is provisioned.

Set `BACKUP_DIR` to the directory where `runtime:backup` writes `pg_dump` files. Production restore requires `ALLOW_PRODUCTION_RESTORE=true`.

## Readiness

Use `/api/v1/health/ready` for container and reverse-proxy health checks. It verifies the database query path and required storage/email runtime configuration.
