# Prisma Migrations Guide

Production customer runtimes must use Prisma migrations. `db push` is only for local development speed.

## Rules

- Add a migration for every production database change.
- Keep migration files committed.
- Keep `prisma/migrations/migration_lock.toml` committed.
- Run `pnpm run db:validate` before pushing.
- CI should provide `MIGRATION_SHADOW_DATABASE_URL` so migration drift is detected.
- Do not edit an applied production migration. Add a new migration instead.
- Document manual rollback notes when rollback is possible.

## Commands

Create a local development migration:

```bash
pnpm db:migrate
```

Deploy migrations:

```bash
pnpm db:deploy
```

Validate schema and migration drift:

```bash
pnpm run db:validate
```

Full local validation:

```bash
pnpm run validate
```

## Current Migrations

### `20260611000000_initial`

Purpose:

- Creates the initial Codey base schema.
- Adds users, roles, permissions, refresh tokens, invites, password reset and email verification tokens.
- Adds site/module settings, product catalog, orders, CMS pages/posts/menus/revisions/media, notifications, payments, and audit logs.

Risk:

- High for existing databases because it defines the base schema.
- Safe for empty copied runtimes.

Forward deploy notes:

- Deploy to an empty database for new customer runtimes.
- Run seed after deployment.

Rollback notes:

- Restore the pre-migration database backup.

### `20260612000000_media_storage`

Purpose:

- Adds media site scoping, original filename, checksum, image variant metadata, soft-delete timestamp, and storage indexes.

Risk:

- Medium. Existing media rows can have null `siteId`; application code must tolerate legacy rows.

Forward deploy notes:

- Deploy before enabling production media upload workflows.
- Confirm storage adapter configuration after deploy.

Rollback notes:

- Prefer restore from backup if media metadata was written after deploy.

### `20260612000001_cms_completion`

Purpose:

- Adds contact form content block type.
- Adds CMS categories, post-category links, redirects, and contact submissions.
- Adds indexes for post tags, redirects, and contact submission queues.

Risk:

- Medium. Adds enum value and new CMS tables.

Forward deploy notes:

- Deploy before enabling contact forms, redirects, or post categories in generated sites.

Rollback notes:

- Restore from backup if new CMS categories, redirects, or submissions were created.

### `20260612000002_shop_completion`

Purpose:

- Completes shop checkout data.
- Adds product options, variants, carts, cart items, shipping zones/rates, tax rules, coupons, product media links, order checkout fields, and order notifications.

Risk:

- High for shop deployments because checkout and stock behavior depend on this schema.

Forward deploy notes:

- Deploy before enabling carts, variant checkout, coupons, shipping, or tax.
- Smoke-test one checkout after deploy.

Rollback notes:

- Restore from backup and reconcile any payment provider state before reopening the shop.

### `20260612000003_shop_email_notifications`

Purpose:

- Adds order notification event type, HTML body, retry attempts, failure reason, and last attempt timestamp.

Risk:

- Low to medium. Existing queued notifications receive the default `ORDER_RECEIVED` event.

Forward deploy notes:

- Deploy before enabling order status change or payment status notification emails.

Rollback notes:

- Restore from backup if queued notification data must be preserved exactly.

### `20260612000004_deployment_readiness`

Purpose:

- Adds site domains with type, status, primary-domain uniqueness, verification metadata, and lookup indexes.

Risk:

- Medium. Domain routing and platform publish checks depend on this table.

Forward deploy notes:

- Deploy before platform-managed custom domains.
- Ensure only one primary domain per site.

Rollback notes:

- Restore from backup if domain records were created or verified after deploy.

## Clean Clone Migration Smoke

For a copied runtime smoke test:

1. Create an empty PostgreSQL database.
2. Set `DATABASE_URL` to that database.
3. Set `MIGRATION_SHADOW_DATABASE_URL` to a second empty database.
4. Run `pnpm run db:validate`.
5. Run `pnpm db:deploy`.
6. Run `pnpm db:seed`.
7. Run `pnpm setup:admin`.
8. Start the app.
9. Check `/api/v1/health/ready`.

Integration tests use `TEST_DATABASE_URL` and refuse to run against `DATABASE_URL` unless `ALLOW_DATABASE_URL_INTEGRATION=true` is set.
