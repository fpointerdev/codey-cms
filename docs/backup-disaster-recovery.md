# Backup And Disaster Recovery

Each copied runtime has its own database, storage prefix, encryption keys, and backup directories. Never share backup artifacts between customer sites.

## Backup Configuration

The production Compose stack runs `scripts/backup-scheduler.mjs` immediately on startup and then at `BACKUP_INTERVAL_HOURS` intervals. A backup includes:

- A PostgreSQL custom-format dump verified with `pg_restore --list`.
- A compressed media snapshot when `STORAGE_DRIVER=local`.
- An S3 media-protection declaration when `STORAGE_DRIVER=s3`.
- A manifest containing checksums, byte sizes, timestamps, and encryption state.
- `latest.json`, consumed by authenticated operational diagnostics.

Set these values per runtime:

```env
BACKUP_DIR=/app/backups
BACKUP_MIRROR_DIR=/app/backups-mirror
BACKUP_RETENTION_DAYS=30
BACKUP_INTERVAL_HOURS=24
BACKUP_MAX_AGE_HOURS=30
BACKUP_REQUIRED=true
BACKUP_ENCRYPTION_KEY=<unique secret of at least 32 characters>
BACKUP_REQUIRE_ENCRYPTION=true
BACKUP_OFFSITE_REQUIRED=true
BACKUP_OFFSITE_PROTECTED=false
BACKUP_S3_MEDIA_PROTECTED=true
BACKUP_ALERT_WEBHOOK_URL=https://monitor.example.com/hooks/codey
BACKUP_ALERT_WEBHOOK_TOKEN=<optional bearer token>
```

`BACKUP_MIRROR_DIR` must be mounted on independent storage or synchronized off-host. A second volume on the same server is not a complete disaster-recovery strategy and is reported as **Local only** under **Settings > Updates**. After the external copy and a restore test are working, set `BACKUP_OFFSITE_PROTECTED=true`. CodeY reports protection only when that confirmation is present and the latest backup was successfully mirrored.

For S3-compatible media, enable and test bucket versioning, replication, or an independent object backup before setting `BACKUP_S3_MEDIA_PROTECTED=true`. The database dump does not copy S3 objects.

Run one backup manually after provisioning:

```bash
pnpm runtime:backup
```

The failure webhook receives `codey.backup.failed`. A mirror failure is reported as failed but does not delete a completed local backup.

## Restore Procedure

1. Put the site into maintenance mode and stop public writes.
2. Verify the target runtime, database, and storage prefix.
3. Locate the matching `.manifest.json`, database archive, and media archive.
4. Restore the database and optional local media:

```bash
ALLOW_PRODUCTION_RESTORE=true \
RESTORE_MEDIA=true \
RESTORE_REPLACE_MEDIA=true \
BACKUP_ENCRYPTION_KEY=<matching-key> \
pnpm runtime:restore -- /path/to/runtime-....manifest.json
```

5. For S3 media, use the bucket versioning or replication recovery workflow recorded in the manifest.
6. Run `pnpm db:deploy` and start the runtime.
7. Check public `/api/v1/health/ready`, then authenticated `/api/v1/health/diagnostics`.
8. Smoke test login, public pages, media, forms, and shop workflows before disabling maintenance mode.

The restore command verifies manifest checksums and sizes, encrypted-file authentication, PostgreSQL archive structure, and media archive paths and entry types before modifying the target. Media archives containing links or special files are rejected. The command also supports legacy plain SQL dumps. Production restore is blocked unless `ALLOW_PRODUCTION_RESTORE=true`.

## Recovery Rules

- Keep `BACKUP_ENCRYPTION_KEY`, `CMS_CREDENTIAL_ENCRYPTION_KEY`, and runtime secrets in a separate secret manager backup.
- Test a restore into an isolated database at least quarterly and after backup-script changes.
- Alert when `latest.json` reports failure or exceeds `BACKUP_MAX_AGE_HOURS`.
- Reconcile paid orders with Stripe or PayPal after restoring shop data.
- Do not claim a recovery target until a timed restore test proves it.
