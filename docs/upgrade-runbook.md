# Copied Site Upgrade Runbook

The platform creates one runtime copy per customer site. Base-product upgrades must be planned as repeatable rollouts across those copies.

## Version Contract

- Keep `package.json` version aligned with module manifest compatibility.
- Use Prisma migrations only; never patch production schemas manually.
- Use `GET /api/v1/config/compatibility` to check module compatibility before enabling new modules.
- Record the deployed git SHA and migration version for every copied site.

## Upgrade Steps

1. Select a pilot copied site for the same deployment profile.
2. Back up the site database and media prefix.
3. Enable maintenance mode if the migration affects auth, CMS writes, orders, or payments.
4. Pull the new runtime image or code bundle.
5. Run `pnpm db:deploy`.
6. Start with `pnpm runtime:start`.
7. Check `/api/v1/health/ready` and `/api/v1/health/metrics`.
8. Smoke test auth, CMS visibility, shop checkout, payment webhook handling, and email delivery.
9. Disable maintenance mode.
10. Roll out to the next batch only after logs and audit events look clean.

## Rollback

- Prefer forward fixes for schema-compatible bugs.
- If rollback is required, restore the pre-upgrade database backup and matching media prefix.
- Reconcile payment provider state before reopening a shop site.
- Keep the site in maintenance mode until the restored runtime is verified.

## Generator Compatibility

- Update fixtures in `fixtures/website-specs` when the WebsiteSpec contract changes.
- Keep deployment profiles in the manifest aligned with generator capabilities.
- Add upgrade notes when module settings or generated CMS structures change.
