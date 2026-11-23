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
- **Profile > Signed-in devices** is reviewed and unfamiliar sessions are removed.
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
- The self-host API mounts only runtime secrets and read-only backups/releases. Database-owner and backup keys belong to the private supervisor/backup services, not `backend`.
- New passwords are limited to 72 UTF-8 bytes before bcrypt hashing; existing password hashes remain valid. Multibyte characters can reach this limit before 72 characters.

## Release Checks

- Run `pnpm run audit` with the committed lockfile and review all advisories. The audit includes the bundled MCP SDK, Motion, and Three.js, not just the CMS server's production dependencies.
- Run `pnpm audit:containers` with Docker. It builds and scans CMS, MCP, hardened PostgreSQL, and patched Caddy images with a digest-pinned Trivy scanner. High/critical findings (including unfixed findings) and scanner errors block publication. Reports are retained under `.release/container-security` and in CI artifacts.
- `Dockerfile.postgres` retains the official PostgreSQL 16 entrypoint and data directory. It pins the XML library fix and Alpine's smaller privilege helper, without changing the database major version or deleting data. Keep its package pins and `runtime-meta/container-images.json` synchronized.
- CI runs this image gate before publishing a release; the scheduled Security workflow repeats it against current vulnerability data. Digest pinning alone is not a vulnerability check.
- Review Dependabot major-version proposals instead of hiding them. Merge only after the complete compatibility and release gates pass.

### Caddy Build

The standard Caddy entrypoint is rebuilt with a locked graph that removes
vulnerable JOSE v3 via an exact upstream Smallstep commit and updates Go networking.
See [build provenance](../integrations/caddy/README.md). `pnpm release:caddy`
verifies TLS with a test CA, redirects, compression, POST forwarding and restart
behavior. No scanner exclusions or TLS-verification bypasses are permitted.
Runtime-only updates cannot replace Caddy; refresh the packaged images too.

## Request Limits

Authentication and installation JSON requests are limited to 16 KB; ordinary API
JSON to 256 KB; payment webhooks to 1 MB. CMS/product content, media uploads, and generation
validate/apply requests retain `STORAGE_UPLOAD_BODY_LIMIT`, but authenticate before
parsing the larger body. URL-encoded forms are capped at 16 KB, 100 parameters,
and five nesting levels. Compressed request bodies are rejected; response
compression remains enabled. Only payment webhooks retain raw bytes for signature
verification. Generators must send uncompressed JSON and use authenticated
content endpoints or signed media-upload URLs for larger payloads.

## Content And Access

- Draft products and CMS content are not visible publicly.
- Client roles only have the permissions required for their modules.
- Admin users use strong passwords and verified emails.
- Public form endpoints keep anti-spam checks enabled.
- Uploaded media is limited to the supported image, video, and PDF allowlist; extension, MIME, kind, and file signatures must agree.
- Rich text is sanitized on write and again before public server rendering.
- Custom Code elements accept only bounded content and HTTPS library URLs. They run only in sandboxed opaque-origin frames, never in the admin or visual editor; do not add `allow-same-origin` to their iframe policy.
- Treat `update:cms` as a trusted publishing permission: custom-code widgets stay in an opaque-origin sandbox, but can still collect data inside their frame and contact HTTPS services.

## Payments

- Checkout prices are calculated server-side.
- Stock is reserved in the order transaction and unpaid reservations expire after 30 minutes.
- Cancellation, abandonment, expiry, and failed payment release stock and coupon usage atomically.
- Provider credentials are configured through the authenticated dashboard and never returned by read APIs.
- Stripe and PayPal credential changes and connection tests require `manage:secrets` and recent authentication.
- Stripe and PayPal remain disabled until required credentials are saved and the connection test succeeds.
- Stripe webhook signatures use the raw request body and enforce replay tolerance.
- PayPal webhook signatures are verified with PayPal using the configured webhook ID.
- Provider webhook endpoints use HTTPS and subscribe only to the documented payment events.
- Payment status changes are idempotent through `providerEventId`.
- Admin refunds require `update:payments`, recent authentication, a durable refund record, and a provider idempotency key.
- Buyer refund requests require ownership through the HTTP-only buyer session, a paid balance, and merchant approval before they can be linked to a refund.
- Only one refund may be pending per payment; retries reuse the original provider request ID.
- Provider amount and currency must match the stored server-side order before payment succeeds.

## Launch

- `/api/v1/health/ready` returns ready.
- Authenticated `/api/v1/health/diagnostics` reports a healthy runtime and protected backup.
- Anonymous requests to `/api/v1/health/diagnostics` and `/api/v1/health/metrics` are rejected.
- The primary custom domain is active in `SiteDomain`.
- Reverse proxy TLS is issued and redirects HTTP to HTTPS.
- Backup and restore have both been tested against an isolated database.
- Maintenance mode is disabled.
