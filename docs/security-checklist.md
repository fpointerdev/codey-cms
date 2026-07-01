# Generated Site Security Checklist

Use this checklist before a generated site is published.

## Runtime

- `NODE_ENV=production`.
- `APP_PUBLIC_URL` points to the final public URL.
- `CORS_ORIGINS` contains only trusted origins.
- `JWT_ACCESS_SECRET` is unique per copied site and at least 32 characters.
- `AUTH_RECOVERY_TOKEN_DELIVERY=email` when auth recovery, email verification, or invites are enabled.
- `EMAIL_DRIVER=http` is configured for auth recovery and shop notifications.
- `STORAGE_DRIVER=s3` is enabled for production media.
- `STORAGE_KEY_PREFIX` is unique per customer site.
- Payment webhook secrets are unique per copied site.

## Content And Access

- Draft products and CMS content are not visible publicly.
- Client roles only have the permissions required for their modules.
- Admin users use strong passwords and verified emails.
- Public form endpoints keep anti-spam checks enabled.
- Uploaded media has size limits and signed download URLs where needed.

## Payments

- Checkout prices are calculated server-side.
- Stock is reserved in the order transaction.
- Stripe webhooks use `PAYMENT_STRIPE_WEBHOOK_SECRET`.
- PayPal adapter webhooks use `PAYMENT_PAYPAL_WEBHOOK_SECRET`.
- Legacy `PAYMENTS_WEBHOOK_SECRET` is used only for platform/manual payment webhooks.
- Payment status changes are idempotent through `providerEventId`.

## Launch

- `/api/v1/health/ready` returns ready.
- `/api/v1/health/metrics` returns process telemetry.
- The primary custom domain is active in `SiteDomain`.
- Reverse proxy TLS is issued and redirects HTTP to HTTPS.
- Backup job has completed at least once.
- Maintenance mode is disabled.
