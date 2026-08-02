# Self-Hosted Installation

CodeY CMS is distributed as a signed release and runs on infrastructure controlled by the site owner. Docker Desktop or Docker Engine with Compose v2 is the supported installation target.

## Local Installation

1. Download `codey-cms-<version>.zip` from the latest GitHub release.
2. Verify the ZIP against `SHA256SUMS` when installing it on behalf of someone else.
3. Extract the ZIP.
4. Run `start-codey.cmd` on Windows or `./start-codey.sh` on macOS and Linux.
5. Complete the setup page opened by the launcher.

For headless automation, run `./start-codey.sh --no-open` or set
`CODEY_NO_OPEN=true`. The launcher starts the same packaged Docker services but
prints the one-time setup URL instead of opening a browser.

The launcher starts PostgreSQL and CodeY CMS, generates strong secrets, and places the one-time installation token in the URL fragment. URL fragments are not sent in HTTP requests. Setup creates the first owner, initial roles, selected modules, site settings, home page, and main navigation in one database transaction. It then locks permanently.

On a headless Linux server, the launcher prints the one-time setup URL when it cannot open a browser. Open it privately, complete installation, and do not retain the token in shared terminal logs.

Docker volumes preserve:

- PostgreSQL data
- installation and encryption secrets
- uploaded media
- local encrypted backups
- backup mirror
- verified runtime releases and rollback state

Running the launcher again reuses these values. It does not rotate secrets or create another owner.

## Public Domain With Automatic HTTPS

Point the domain's DNS A/AAAA records to the server, allow inbound ports 80 and 443, then run:

```bash
./start-codey.sh --domain www.example.com
```

On Windows, use:

```bat
start-codey.cmd --domain www.example.com
```

The launcher adds the packaged Caddy service, obtains and renews the TLS certificate, configures the HTTPS public URL and CORS origin, and trusts exactly one proxy hop. The direct CodeY port binds only to localhost; PostgreSQL, runtime volumes, and Docker control access remain private. Certificate issuance requires correct public DNS and reachable ports 80 and 443.

Existing reverse-proxy installations can continue setting `APP_PUBLIC_URL`, `CORS_ORIGINS`, `CODEY_ALLOW_LOCAL_SETUP_HTTP=false`, and an exact `TRUST_PROXY` hop count in their environment or Compose override without using `--domain`.

Do not run a production site with the default localhost URL. Do not expose the installation token in chat, screenshots, logs, query parameters, or server configuration.

## Operations

```bash
# Status
docker compose -f docker-compose.selfhost.yml ps

# Logs
docker compose -f docker-compose.selfhost.yml logs -f backend

# Stop without deleting data
docker compose -f docker-compose.selfhost.yml down

# Start existing installation
docker compose -f docker-compose.selfhost.yml up -d --wait
```

For an automatic HTTPS installation, add `-f docker-compose.public.yml` and set `CODEY_DOMAIN` when running Compose commands directly.

Never add `-v` to `docker compose down` unless the database, secrets, uploads, backups, and runtime history are intentionally being deleted.

## Backup Requirement

The default package immediately writes encrypted backups to two local Docker volumes. This keeps first setup automatic, but **Settings > Updates** reports **Local only** until the mirror is stored somewhere independent.

Before production handoff, mount `/app/backups-mirror` from both `backend` and `backup` onto a NAS, removable drive, or cloud-synchronized directory with `docker-compose.override.yml`. Test a restore, then add `BACKUP_OFFSITE_PROTECTED=true` to the installation `.env`. A backup on the same disk is not disaster recovery, and CodeY will not report it as protected.

Example override, using an independently protected host directory:

```yaml
services:
  backend:
    volumes:
      - /absolute/path/to/codey-offsite:/app/backups-mirror
  backup:
    volumes:
      - /absolute/path/to/codey-offsite:/app/backups-mirror
```

```env
BACKUP_OFFSITE_REQUIRED=true
BACKUP_OFFSITE_PROTECTED=true
```

Run and inspect a manual backup:

```bash
docker compose -f docker-compose.selfhost.yml exec backend \
  node scripts/run-with-runtime-secrets.mjs -- node scripts/backup-runtime.mjs
```

Test restore procedures on an isolated test installation before relying on them. See `docs/backup-disaster-recovery.md`.

## Advanced Installation

Operators who do not use the self-host Compose package can configure `.env.production.example`, run Prisma migrations, and start `scripts/start-production.mjs`. They must provide PostgreSQL, persistent media, backup encryption, the installation claim token, the release public key, and an external runtime supervisor. Automatic in-place updates are supported only by the self-host supervisor package.
