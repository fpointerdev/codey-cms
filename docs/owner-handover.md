# Owner Handover

## For The Website Owner

1. Open the private setup link supplied by your hosting provider. Choose your
   website name and create your own owner account. Do not send your password to
   the designer. There is no CMS version to select.
2. Open **Website setup and handover** on the dashboard. Each unfinished check
   links to the relevant settings or account-security screen.
3. Connect and test your email provider, then enable account recovery. Enable
   two-step verification in your profile and keep recovery codes somewhere safe.
4. Edit a real headline and image, publish the change, and check the public page
   on a phone. Ask the designer to demonstrate restoring the previous revision.
5. Open **Backups and updates**. Choose **Create backup** and wait for completion.
   A completed local backup is not off-site protection. The hosting provider
   must supply an independent copy and demonstrate recovery on another instance.
6. Download the handover report from Website setup. It records configuration
   checks, not a guarantee that hosting, delivery, or recovery has been tested.

If installation succeeds but automatic sign-in fails, setup offers **Sign in**
without asking you to install again. Use the account you just created. If a
request was interrupted, setup checks whether installation already completed
before attempting login. It never creates a second owner to recover an error.

**Check now** verifies the latest signed stable update. **Install update** stages
that verified release for the supervisor; it is not a version selector. A failed
candidate must preserve or restore the previous working release. Keep independent
backups even when automatic updates are enabled.

## For The Hosting Provider

Before handing over a public site, record evidence for the exact delivered
release and customer site:

- Public DNS, HTTPS certificate, public SSR and actual media/form interactions.
- The owner's first login, intended role, edit, publish, and revision recovery.
- A verified signed update, failure rollback, and unchanged customer content.
- Recovery of encrypted database and media on an isolated instance, followed by
  login, edited public content, and media checks. Object-storage recovery requires
  its own versioning/replication test; database restoration does not restore R2/S3.
- Secure custody of installation/encryption keys, tested account recovery, and a
  support contact. Do not put credentials or private tokens in evidence reports.

Use the existing signed exported-site qualifier for automated package evidence.
Human task completion and actual target-host evidence are separate requirements;
neither can be inferred from a successful package test or an owner's checkbox.

## Machine Contract

Discover `ownerHandover.version: "1.0"` in the generation contract. Read
`GET /api/v1/config/launch-readiness` with `manage:modules`. It returns
`data.runtime` and `data.readiness` with `version`, `scope`, `checkedAt`,
`status`, `target`, `summary`, `checks`, and `nextAction`. The scope is
`installation-configuration`; even `status: "ready"` means configuration only.
`evidence.externalReachabilityVerified`, `ownerJourneyVerified`, and
`restoreDrillVerified` are false. The caller must supply separate measured
delivery evidence, never overwrite these fields to assert unperformed checks.

The dashboard downloads `{contract: "codey-cms.owner-handover", version: "1.0",
runtime, readiness}`. No customer credentials or internal diagnostic paths are
included in this report.

`GET /api/v1/config/backup` returns `data.control` and `data.health` for the same
administrator. `POST` to that path with an empty JSON object queues an encrypted
backup and returns HTTP 202. No paths, shell commands, or restore flags are
accepted. Control status has `version: "1.0"`, `available`, `busy`, `status`,
`requestId`, `requestedAt`, `completedAt`, and `backupId`; GET also has
`canRequest`. States are `idle`, `queued`, `running`, `succeeded`, `failed`, and
`unavailable`. Follow the same request ID to completion and inspect `health` for
off-site protection. A provider connection or successful local snapshot is not
proof of a restore drill.

Requests require a worker heartbeat newer than 30 seconds and an installed
encryption key. Missing worker returns 503, missing encryption returns 409,
and another request within one minute of the previous request returns 429.
Concurrent/pending requests reuse the same requested job. If a scheduled backup
is already running, the encrypted request queues behind it with its own ID;
completion of that scheduled snapshot does not complete the request. Creation requests are
audited. Restoring over a live database is deliberately not a browser endpoint.

## Compatibility

These capabilities are introduced in CodeY CMS 1.6.0. WebsiteSpec and exported-site acceptance remain 1.0. No database migration or
new environment variables are required. The new readiness detail endpoint is
management-only; read-only designers use the generation discovery contract.
Older CMS releases do not advertise `ownerHandover` and lack the backup action.

The updated backup worker must be running as well as the updated API. Automatic
application-only updates do not replace an older standalone backup container.
To adopt this feature, the operator must refresh the signed self-host package
and recreate its backup service while preserving the existing Compose project
name, configuration, and named volumes. Until then, the dashboard reports the worker as
unavailable rather than accepting a job that cannot run. Never delete volumes
or repeat owner setup to upgrade the worker.
