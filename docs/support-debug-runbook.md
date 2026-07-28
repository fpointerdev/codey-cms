# Production Support Debug Runbook

Use this procedure when a copied customer site has a production incident.

## First Checks

1. Identify the copied site, deployment profile, domain, git SHA, and runtime environment.
2. Check `/api/v1/health/ready`.
3. Sign in as an owner and check `/api/v1/health/diagnostics`.
4. Capture the `x-request-id` from the failing response.
5. Search structured logs by request ID or trace ID.
6. Check `GET /api/v1/config/audit-logs` for recent sensitive actions.

## Common Incidents

- Auth recovery email not delivered: verify `AUTH_RECOVERY_TOKEN_DELIVERY=email`, `APP_PUBLIC_URL`, **Settings > Email**, the last provider-test result, and provider response logs.
- CMS content missing publicly: check page/post status and role permissions; drafts should stay private.
- Checkout total mismatch: inspect order items, coupons, shipping rates, and tax rules stored on the order.
- Payment not updating: verify provider signature headers, webhook secret, `providerEventId`, and `providerReference`.
- Domain unavailable: inspect `SiteDomain.status`, reverse proxy config, DNS A/CNAME records, and TLS issuance logs.
- Storage failure: check S3 endpoint credentials, bucket policy, key prefix, and quota.
- Backup failure: inspect `operations.backup` in authenticated diagnostics, `BACKUP_DIR/latest.json`, scheduler logs, mirror storage, and the alert webhook response.

## Safe Operator Actions

- Enable maintenance mode before risky writes.
- Process queued order notifications after email provider recovery.
- Re-run `pnpm db:deploy` only when the deployed code expects pending migrations.
- Restore from backup only after confirming the target database and storage prefix.

## Escalation Data

Collect these before escalation:

- Site ID and domain.
- Request ID and trace ID.
- Deployment profile and enabled modules.
- Recent audit log entries.
- Relevant order/payment IDs.
- Latest backup timestamp.
- Runtime logs around the incident window.
