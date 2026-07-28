# Automatic Updates

The self-host package checks the signed `stable` feed on a schedule. Users do not choose versions. `CODEY_AUTO_UPDATE=true` stages a newer verified release automatically; administrators can also use Settings > Updates.

## Update Sequence

1. Fetch `stable.json` over HTTPS.
2. Verify the Ed25519 manifest with the installed release public key.
3. Reject an older, equal, malformed, oversized, or contract-incompatible release.
4. Download the artifact into a private staging directory.
5. Verify its signed size and SHA-256 while limiting streamed bytes.
6. Validate the signed source commit, immutable container-image references, and CycloneDX SBOM metadata.
7. Enter maintenance mode and create an encrypted database/media backup.
8. Stop the current runtime.
9. Reject unsafe archive paths, links, and unexpected roots before extraction.
10. Install locked production dependencies and generate the Prisma client.
11. Switch the `current` runtime link atomically and apply migrations.
12. Require the readiness endpoint to pass.
13. Mark the exact runtime version active and retain the previous release.

If verification or preparation fails after shutdown, the supervisor restarts the previous runtime. If the new runtime was started but does not become ready, the supervisor restores the pre-update database backup, switches to the previous release, verifies readiness, and records `ROLLED_BACK`. A failed recovery is recorded as `FAILED` and requires operator attention.

## Configuration

```bash
CODEY_UPDATES_ENABLED=true
CODEY_AUTO_UPDATE=true
CODEY_RELEASE_FEED_URL=https://github.com/fpointerdev/codey-cms/releases/latest/download/stable.json
CODEY_RELEASE_PUBLIC_KEY_FILE=runtime-meta/release-public-key.pem
CODEY_UPDATE_CHECK_INTERVAL_HOURS=6
```

Official signed packages contain the public key. A source checkout without that key can build and run, but managed update checks remain deferred until an official key is supplied.

Every hardening release also publishes `codey-cms-<version>.sbom.cdx.json`. Its checksum, source commit, and pinned Node/PostgreSQL image references are covered by the Ed25519 release signature.

## Recovery

Inspect runtime state and logs:

```bash
docker compose -f docker-compose.selfhost.yml logs backend
docker compose -f docker-compose.selfhost.yml exec backend \
  node scripts/run-with-runtime-secrets.mjs -- node scripts/backup-runtime.mjs
```

Do not edit `pending-update.json`, runtime symlinks, release manifests, or database update records manually. Preserve `/runtime`, `/app/backups`, and `/app/backups-mirror` when collecting support diagnostics.
