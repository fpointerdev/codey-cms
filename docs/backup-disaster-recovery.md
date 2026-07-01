# Backup And Disaster Recovery

Each generated customer site is a copied runtime with its own database, environment, storage prefix, and backup directory. Treat every copy as an isolated tenant.

## Backup Strategy

- Run `pnpm runtime:backup` for every copied site on a fixed schedule.
- Store database dumps outside the application container, preferably in S3-compatible storage.
- Use a unique `BACKUP_DIR` per site when multiple runtimes share a VPS.
- Keep media under a unique `STORAGE_KEY_PREFIX` per site.
- Snapshot the runtime environment file alongside database backups.
- Retain at least daily backups for 30 days and weekly backups for 90 days for paid shop/CMS plans.
- Monitor backup success and alert when no backup exists for the last scheduled window.

## Restore Procedure

1. Put the copied site into maintenance mode.
2. Stop traffic at the reverse proxy or keep only `/health`, `/auth`, and `/config` open.
3. Restore the matching database dump:

```bash
ALLOW_PRODUCTION_RESTORE=true pnpm runtime:restore -- /path/to/runtime.dump
```

4. Restore media objects for the same `STORAGE_KEY_PREFIX`.
5. Run `pnpm db:deploy`.
6. Start the runtime with `pnpm runtime:start`.
7. Check `/api/v1/health/ready`.
8. Process queued order notifications if the outage included shop activity.
9. Disable maintenance mode after manual smoke checks.

## Recovery Targets

- Presentation site: restore within 4 hours.
- CMS site: restore within 2 hours.
- Shop site: restore within 1 hour.
- Shop order and payment data loss target: last successful backup plus provider reconciliation.

## Disaster Recovery Notes

- Never restore one customer dump into another customer's runtime.
- Keep provider webhook secrets and JWT secrets per copied site.
- Reconcile paid orders with the payment provider after any database restore.
- Do not run production restore unless the target database and storage prefix have been verified.
