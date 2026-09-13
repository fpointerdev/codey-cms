# Managed Hosting Contract

This is the operator contract for CodeY or another host running the canonical
signed CMS package. It does not declare managed hosting implemented or qualified.
WebsiteSpec and exported-site acceptance remain 1.0. Read the capabilities of the
actual signed release; unreleased source is not a capability of v1.5.0.

## Signed Package And Identity

1. Resolve the latest stable feed automatically, without a customer version choice.
2. Verify its nested manifest with an independently trusted Ed25519 public key.
   Do not establish trust from a key downloaded alongside an untrusted artifact.
3. Verify signed source SHA, archive size/hash, self-host ZIP, SBOM and immutable
   base-image references before extraction or executing any package script.
4. Extract only safe entries under `codey-cms-<version>/`. Build the packaged
   Dockerfile and record the resulting immutable image ID as well as the signed
   source/archive identity. A locally built tag alone is not release evidence.
5. Use the trusted matching checkout's `pnpm run release:qualify -- --release-dir
   /absolute/signed-assets --website-spec /absolute/spec.json --report
   /absolute/new-report.json` for disposable package acceptance. Verify the
   assets against the independent key before invoking the package qualifier.
   Reject `passed-local-unsigned` for delivery.

The published baseline checked on 13 September 2026 is v1.5.0, source
`019f1c9eae403b3fee0695ff34c5c6ae57fb708f`, key ID `01494cb9854948b8`.
Its ZIP SHA-256 is
`aa5ca539025ecf83946936de3b0526b639f6fb6519bf32fd45d62b1fbedda166`;
runtime archive SHA-256 is
`7d48781e9f337815570c98c8553f2daeb633e1037d4c3e345bf34d4b36bd79f2`.
This records a baseline, not a new pin or permission to bypass future verification.

## Per-Site Resources

The package entrypoint is `sh start-codey.sh --no-open` in the extracted root.
For automation, capture its output privately: even with `--no-open` it prints
the one-time `/install#token=...` URL. Never put that token in deployment logs,
reports, public URLs, shell command arguments, or support transcripts.

Set a unique allowlisted `COMPOSE_PROJECT_NAME` for every isolated deployment;
the YAML's default `name: codey-cms-selfhost` is not suitable for multiple sites.
Use a reserved loopback `API_PORT`, unique immutable-build image tag, and a
host-owned `CODEY_COMPOSE_OVERRIDE_FILE`. Reject caller-controlled Compose YAML,
arbitrary commands, bind mounts, Docker socket mounts and environment files.

The canonical services are `secrets`, `postgres`, `backend`, and `backup`.
Keep ownership labels and preserve these named volumes:

| Volume | Purpose |
| --- | --- |
| `postgres_data` | Customer PostgreSQL data |
| `codey_secrets` | Generated database, session, credential, backup and setup keys |
| `codey_uploads` | Local customer media and export marker |
| `codey_backups` | Encrypted snapshots, manifests and backup-worker control |
| `codey_backup_mirror` | Mirror copy; not off-host merely because it is another volume |
| `codey_runtime` | Installed releases, `current` link and update state |

Do not share these resources between sites or between live and candidate
deployments. Never run `down --volumes`, `db push --force-reset`, or owner setup
as an upgrade. Restored data requires its original credential/backup encryption
keys; generating replacement keys does not decrypt old customer settings.
Object storage needs separate versioning/replication and recovery evidence.

On a shared host, do not pass `--domain`: that starts the packaged Caddy service
on global ports 80/443. Use the platform-owned proxy, exact `APP_PUBLIC_URL` and
`CORS_ORIGINS`, `CODEY_ALLOW_LOCAL_SETUP_HTTP=false`, and an exact `TRUST_PROXY`
matching the actual topology. Keep the backend port loopback-only. The proxy
must restrict routing to the verified customer domain and candidate identity.

For platform-orchestrated updates, set `CODEY_AUTO_UPDATE=false` and override
`CODEY_UPDATES_ENABLED` to `"false"` in the backend environment. The base Compose
file hardcodes the latter to true. There must be one update owner, not both an
independent CMS updater and the platform. Do not alter signature verification.

## Candidate And Cutover

The backend command is `selfhost-supervisor.mjs`, which launches
`run-with-runtime-secrets.mjs` then `start-production.mjs`. Every production
start performs Prisma `migrate deploy` before starting the server. There is no
generic migration-free or read-only candidate startup mode.

- Never start a candidate against the live database or its runtime volume.
  The existing `codey_runtime/current` link can also keep the old code running
  even when the container image tag changes. Confirm installed runtime identity.
- Qualify on synthetic data or an isolated restored snapshot. A restored shop
  starts reservation/session cleanup and queued-email processing; DB-owned SMTP,
  HTTP email, payments and storage settings survive a restore. `APP_ENV=staging`
  and `EMAIL_DRIVER=disabled` do not neutralize those saved settings. Deny outbound
  provider access and inbound webhooks/customer traffic at the host/network layer.
  Never advertise payment/email completion based on blocked or simulated calls.
- A qualification clone that received test writes or processed queues is not the
  final customer database. Do not promote it as-is.
- Before the final snapshot, stop or fence every live writer, including backend,
  background jobs and other integration processes. Drain accepted requests and
  keep later mutations blocked. Pause the standalone backup worker to avoid
  competing snapshots while the operator takes the final encrypted backup.
- Restore that final database/media snapshot into separately owned candidate
  resources using the canonical restore command. Apply candidate migrations only
  there. Keep the previous data and deployment untouched and non-writing.
- Verify candidate readiness, installed identity, preserved customer content,
  SSR, media, intended auth/roles and required browser interactions. Atomically
  change only the owned site's proxy target after these checks pass. Verify
  public DNS/TLS and release-bound HTTPS content from outside the host.
- Before customer writes resume, a failed candidate can be replaced by the
  untouched previous deployment. After new writes are accepted, simply routing
  back to an old database loses edits/orders. Require a write-fenced, data-safe
  recovery plan; do not call a stale-database switch a successful rollback.

The standalone backup service must use the matching updated package and survive
backend restarts. Application-only automatic updates do not refresh this service.
See [Owner handover](owner-handover.md) for the 1.6.0 encrypted request queue
and heartbeat contract. Never treat configuration or a heartbeat as a restore drill.

## Install, Import And Verify

- `GET /api/v1/health/ready`: anonymous minimal runtime readiness; 200 does not
  establish installation, public reachability, backup durability or commerce.
- `GET /api/v1/install/status`: check `installed` before attempting a claim.
  If false, use `POST /api/v1/install/complete` with the private claim token and
  owner account. If true, never re-install or replace the owner to deploy content.
- `POST /api/v1/auth/login`: use the normal owner/authorized account flow and
  respect MFA. Do not persist returned credentials in WebsiteSpec or evidence.
- `GET /api/v1/config/generation/contract`: discover the installed capabilities.
  Validate, dry-run and atomically apply the exact same WebsiteSpec 1.0 payload.
  A restored populated site needs an explicit content-update policy; do not
  blindly replay the original export over later customer edits.
- Verify a real edit after restart in public HTML marked
  `data-server-rendered="true"`, plus browser/media/form/commerce interactions
  appropriate to the site. Compare the actual installed runtime, source/artifact
  identity, spec/content revision and target, not a bare `healthy: true` response.
- Detailed diagnostics and owner handover require `manage:modules`. The latter
  remains configuration-only, even when all checks pass.

Canonical recovery uses a private operator process with all writers stopped:
`node scripts/run-with-runtime-secrets.mjs -- node scripts/restore-runtime.mjs
/app/backups/<verified-manifest>.json`. Production restore requires
`ALLOW_PRODUCTION_RESTORE=true`; use `RESTORE_MEDIA=true` for local media and
explicitly authorize replacement or schema recreation only on the intended
isolated target. Keep manifest/artifact paths host-controlled. The encrypted
manifest, artifact hashes and original keys are required; there is no browser
endpoint for restoring over a live database.

## Release Boundary

Current source fixes stop the application before the pre-update snapshot so
rollback includes its last accepted writes. v1.5.0 supervisors do not contain
that fix. Refresh the signed self-host package/backend supervisor to adopt it;
an application-only update does not replace the running supervisor. The external
host must independently fence all writers regardless of supervisor version.

The host adapter, live target isolation, forced rollback, public TLS checks,
nontechnical owner trial and external read-only MCP deployment are separate
acceptance gates. Neither this document nor local package tests certify them.
