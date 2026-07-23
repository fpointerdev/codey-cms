# Runtime Upgrade Runbook

CodeY CMS supports signed managed updates for the self-host package and exact-version rollout through UseCodeY. End users do not select runtime versions.

## Version Contract

- Keep `package.json`, the Git tag, and runtime manifest version aligned.
- Publish only signed stable manifests and immutable artifacts.
- Use Prisma migrations only; never patch production schemas manually.
- Use `GET /api/v1/config/compatibility` to check module compatibility before enabling new modules.
- Record the deployed git SHA and migration version for every copied site.

## Upgrade Steps

1. Qualify the signed release against presentation, CMS, and shop profiles.
2. Back up the site database and media prefix.
3. Enable maintenance mode if the migration affects auth, CMS writes, orders, or payments.
4. Stage the exact signed artifact and verify its checksum.
5. Use the supervisor or deployment pipeline to apply migrations.
6. Start the exact pinned runtime.
7. Check `/api/v1/health/ready` and `/api/v1/health/metrics`.
8. Smoke test auth, CMS visibility, shop checkout, payment webhook handling, and email delivery.
9. Disable maintenance mode.
10. Roll out to the next batch only after logs and audit events look clean.

## Rollback

- Prefer forward fixes for schema-compatible bugs.
- The self-host supervisor restores the pre-update database and previous runtime when post-migration readiness fails.
- For managed hosting, restore the exact pre-upgrade database backup and matching media prefix.
- Reconcile payment provider state before reopening a shop site.
- Keep the site in maintenance mode until the restored runtime is verified.

## Generator Compatibility

- Update fixtures in `fixtures/website-specs` when the WebsiteSpec contract changes.
- Keep deployment profiles in the manifest aligned with generator capabilities.
- Add upgrade notes when module settings or generated CMS structures change.
