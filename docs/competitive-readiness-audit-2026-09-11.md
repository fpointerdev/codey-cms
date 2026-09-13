# Competitive Readiness Audit

Reviewed 10-11 September 2026. Scope: CodeY CMS and its CodeY integration for
agency delivery, nontechnical ownership, business operations, and agent access.
This is a source and contract review with focused execution, not a complete
production security assessment or an independent aesthetic benchmark.

## Baselines

- CMS: v1.5.0, `019f1c9eae403b3fee0695ff34c5c6ae57fb708f`.
- CodeY: v0.1.29, `3b8ac4c285b352aa6aa2bb6a61f75714f28b7ceb`, plus existing
  uncommitted template-publication feedback changes. Those changes were preserved.
- Public CodeY readiness returned HTTP 200, `ready`, v0.1.29, and that exact SHA.
- Public `/llms.txt` and `/docs/codey-cms` returned HTTP 200.
- Public `/mcp` returned HTTP 404 for both GET and MCP initialization POST.

## Existing Foundations

Do not rebuild these capabilities as though they were missing:

- CMS visual/backend editing, revisions, reusable sections, structured collections,
  owner-managed provider settings, public SSR, signed updates, and backup tooling.
- CMS buyer history, cancellation/support/refund requests and canonical commerce.
- CodeY client review links and artifact-bound approvals, private agency kits,
  operations views, immutable accepted exports, and copied-runtime qualification.
- CodeY authored-design preservation, reduced-motion handling, browser verification,
  and a benchmark corpus/evaluator. Fixtures do not establish real design quality.

## Findings

### P1: The repair-to-publication workflow cannot refresh a stale template draft

CodeY `src/platform/platform-marketplace.ts:383` rejects a new source artifact
while the latest version is draft/review. Listing edits keep the old
`websiteSpecSnapshot`. The local feedback improvement explains this, but still
directs the creator to support when the snapshot must be replaced
(`apps/platform/template-publication-feedback.js:139`).

Owner: CodeY. Add a deliberate "Update draft from latest verified preview" action
for editable drafts. Preserve compatible listing and rights data; request rights
for changed assets; invalidate previous qualification; requalify the exact new
artifact. Keep published/purchased versions immutable. In-review versions need
an explicit withdrawal flow. Use expected revision/content hash checks so a
concurrent review cannot approve replaced content. A retry must not require a
new paid generation when a valid accepted preview already exists.

Cross-project review found that content hash alone is insufficient:
`marketplaceVersionHash` at line 1229 excludes source artifact/runtime identity;
`saveTemplateQualification` at line 623 checks the target version's draft status
and content hash but not the template's latest version or a qualification
revision. `reviewMarketplaceTemplate` at line 702 resolves the latest version
without binding the moderator's decision to the version they viewed. Bind
qualification and moderation to exact version ID, source identity, and a
monotonic draft/review revision. Test artifact-only refresh and identical-content
withdrawal/resubmission races. Carry asset rights by unchanged asset identity,
not merely a reused media key, and preserve submission rate-limit history.

### P1 Product Gap: Client editing is not design-locked

CMS `prisma/seed.ts:671` grants `client_editor` create/update CMS permissions.
`src/modules/cms/cms.routes.ts:307` accepts whole-page updates under `update:cms`;
the same permission permits publishing, adding sections, and revision restores.
`src/modules/cms/cms.service.ts:856` can replace all sections from such an update.
The dashboard hides administration but does not enforce content-only fields.

This is not an authentication bypass. It means the proposed promise that clients
can edit without changing an approved design is not yet an enforced contract.

Owner: CMS, with CodeY integration. Introduce an explicit, backward-compatible
content-editing policy separating copy/media/catalog updates from layout,
custom code, structural deletion, and publishing approval where required. Enforce
it in API services as well as the UI. Test direct API attempts, role variants,
stale concurrent edits, and approved-design preservation across frontend/backend
editing. Do not silently change permissions for existing installations.

### P1 Product Gap: Managed CMS/shop delivery remains unavailable

CodeY `docs/platform-infrastructure-strategy.md` explicitly limits the real SFTP
adapter to static presentation sites. Dynamic Docker hosting is still a later
adapter. A valid downloadable package is not one-click nontechnical hosting.

The delivery certification also currently fails: the tracked nontechnical
self-host evidence has `status: "pending"` and no runs.

Owner: CodeY for hosting, shared for onboarding. First qualify one supported
delivery path: staged immutable signed runtime, isolated DB/media/credentials,
owner setup, DNS/TLS, candidate verification, activation, two-version rollback,
backup/restore, and export to a different host. Preserve the last working site
when provisioning or an update fails. Keep dynamic publish controls unavailable
until that path is real; do not substitute static hosting for CMS/shop.

### P2: Operations confuses a failed deployment attempt with a site outage

CodeY `src/platform/platform-site-operations.ts:203` picks the newest deployment;
`resolveSiteStatus` at line 416 derives availability from that attempt. A fixture
with a live project, an older live deployment, an active domain, and a newer
failed candidate reports `offline` while also saying the previous website is
protected. The stale-runtime warning is skipped because it only runs for `live`.

Owner: CodeY. Separate active release/observed availability from latest attempt.
Test failed candidates, queued replacements, successful rollback, genuine outage,
and missing/stale observations. Do not infer observed health merely from an old
successful deployment record.

### P2: Shop sellability incorrectly includes sandbox-only checkout

CMS `apps/web/web/admin-views.js:730` counts any public payment provider as checkout
ready, ignoring `mode`; line 789 renders "Ready to sell". A render probe with one
active stocked product and only Stripe SANDBOX reproduces that label. Public
provider responses legitimately include sandbox providers and their mode.

Owner: CMS. Distinguish catalog completeness, test checkout, and live checkout.
Keep quote-only and explicitly enabled manual-payment shops supported. Do not
claim provider settlement, email delivery, or whole-site launch readiness merely
from saved settings. Add cases for SANDBOX-only, LIVE, mixed, manual, quote-only,
and provider/configuration failures.

### P2 Distribution Gap: The advertised future remote connector is not deployed

CMS `docs/ai-agent-integration.md` already defines a read-only public discovery
connector. `docs/agent-directory-submission.md:17` correctly conditions the
`https://usecodey.com/mcp` endpoint on deployment. It still returns 404.

Owner: CodeY deployment. Deploy and route the existing package, then verify MCP
initialization, tool listing, validation calls, host allowlisting, rate limits,
and public monitoring externally. Do not duplicate the connector in platform
code. Installed-site management is a separate future authenticated connector:
scoped short-lived credentials, explicit write approval, audit and conflict
handling are required. Never add customer writes to anonymous discovery.

## Evidence Still Needed

- Five real customer briefs compared with the same content/assets and bounded
  generation budgets. Judge complete sites, mobile layouts, real interactions,
  targeted edits, and design preservation, not hero screenshots alone.
- Five nontechnical users completing content/image/price edits, publication and
  mistake recovery without developer assistance. Record task success, time,
  errors and support interventions. Five is an initial pilot, not market proof.
- The existing full benchmark's required provider runs, independent reviews,
  artifact parity, and reconciled costs before a certified quality/savings claim.
- Production email, off-site recovery and deployment drills, and the remaining
  launch checklist evidence. This review does not certify these externally.
- Paid-pilot willingness-to-pay and support-cost evidence. The checked-in pricing
  evidence CSV currently contains its header only.

The benchmark release command was blocked by the dirty CodeY checkout before
evaluating results. That is not evidence of poor visual output, nor a pass.

## Initial Baseline Verification

- CMS `pnpm run validate`: passed, including lint, container pins, browser bundle
  freshness, extension catalog, 203-operation API inventory, types, coverage
  ratchets, schema validation, build, and MCP package build. 369 unit tests passed.
- The initial sandboxed unit run had one loopback-listen EPERM; the full suite
  passed with local network permission. No assertion was weakened.
- CodeY focused source suite: 64/64 passed across agency kits, client review,
  generation contract, authored design, marketplace, and publication feedback.
- CodeY delivery certification: six repository checks passed; nontechnical
  usability evidence failed as described above. Invoked its Node entrypoint
  directly after the package-manager launcher encountered a network fetch error.
- CodeY benchmark release preflight: blocked by preserved local changes.
- Deterministic source/render probes reproduced the two status-label defects.
- Public read-only probes verified the production version and missing MCP route.
- CodeY `git diff --check`: passed.

At the initial audit stage, CMS database integration/browser/restore suites and
migration shadow diff were not rerun because the checkout had no dedicated test
database. The implementation follow-up below subsequently used an isolated
disposable PostgreSQL database for these checks. No production writes, paid AI
calls, commits, releases or deployments were performed.

## Recommended Sequence

1. Finish reviewing the existing publication-feedback changes. Repair draft
   refresh and operations status with focused source/browser regressions.
2. Coordinate CMS content-only editing and accurate commerce readiness. Keep
   WebsiteSpec 1.0 and signed runtime compatibility; update integration tests.
3. Qualify one nontechnical CMS delivery path and an exact client handover.
4. Deploy public discovery separately from any future management connector.
5. Run a budget-approved five-brief/five-user pilot. Fix measured failures, then
   complete broader certification before making superiority claims.

## Coordinated Implementation Follow-Up

The findings above describe the reviewed release baseline, not the following
unreleased changes. The CodeY task subsequently requested implementation of the
CMS-owned editing and commerce fixes as part of the user-approved sequence.

Implemented in this CMS working tree:

- An opt-in `protected` page/post editing policy, with separate `design:cms` and
  `publish:cms` checks in the canonical service. Standard installations retain
  their existing access model. Existing roles are not silently upgraded.
- Atomic `expectedUpdatedAt` checks, including parent-page version advancement
  for block/section writes. The protected editor keeps failed submissions in
  the form, and cross-editor refresh does not discard dirty page settings.
- A smaller content-only dashboard and on-page editor preserving existing
  collection items and unknown design configuration. Live changes still happen
  immediately and need publishing access; there is no separate live review draft.
- Honest loaded-catalog configuration states: empty, catalog, quote, test, live,
  manual, mixed, and unknown. Connection settings are not proof of settlement,
  receipts, tax, shipping, fulfillment, or whole-site launch readiness.
- Additive `contentEditing.version: "1.0"` and `commerceReadiness.version: "1.0"`
  discovery. WebsiteSpec 1.0, signed update enforcement, schema, and environment
  requirements are unchanged. See `generated-site-contract.md` for exact behavior.

The separate CodeY task reports its draft refresh/withdrawal, revision-bound
qualification/moderation, operations status, and mobile navigation fixes are
locally verified: 1,085 source tests passed, 14 expected opt-in skips, and 48
Creator/Operations browser cases passed. These are that task's reported results,
not a second independent execution by the CMS task. It preserved the signed
v1.5.0 CMS pin and did not deploy or run paid generation.

The CMS task independently verified the published `codey-cms-mcp@0.1.1` tarball
checksum, npm registry signature, and provenance. The source binding and exact
artifact identity are recorded in `ai-agent-integration.md`. CodeY then reports
that its isolated, non-root/read-only container passed discovery, validation,
unknown-write rejection, and forged-Host tests. This does not establish a live
public deployment; the connector is still a separate operator-approved action.

Still required before stronger market claims:

1. Review, merge, and qualify a new signed CMS release; only then update CodeY's
   immutable pin and capability-driven client editor. Do not pin a working tree.
2. Finish a real nontechnical owner handover and recovery drill. Managed dynamic
   CMS hosting remains distinct from the already-supported static SFTP path.
3. Deploy and externally verify the existing read-only MCP service, with explicit
   operator approval, limits, and monitoring. Do not add anonymous management.
4. Run the budget-approved five-brief/five-user pilot and record task completion,
   design preservation, support time, cost, and willingness to pay. Complete the
   broader benchmark before claiming superiority over established builders.

No production changes, paid AI calls, commits, pushes, new tags, or releases were
made by this CMS task. The published CMS identity remains v1.5.0.

Use the existing agency tools. More element variants are not the priority until
these workflows succeed with real customers and an affordable support burden.

## Initial CMS Verification

The final implementation passed `pnpm run test:release` against disposable local
PostgreSQL and shadow databases, using `E2E_PORT=4186` to avoid an unrelated local
server. No customer database or production provider was used.

- `validate`: lint, pinned containers, web bundle freshness, extension validation,
  203-operation API inventory, typecheck, schema validation, CMS/MCP builds, and
  378 unit tests passed. Coverage ratchets passed for 38 critical files; overall
  measured line coverage was 69.76%, not complete coverage.
- Migration shadow diff: no difference detected.
- Installation: 4/4 passed, including repeated WebsiteSpec 1.0 import into an
  already-protected site and rollback after an unauthorized import.
- Database/API integration: 18/18 passed, including direct permission bypass
  attempts, parent version conflicts, simultaneous publishing, and public SSR.
- Recovery: 1/1 passed for encrypted database/media backup and restoration.
- Browser: 44 passed, 4 intentional non-Chromium motion-test skips. The new
  protected-editor workflow passed in Chromium, Firefox, and WebKit at desktop
  and mobile sizes, including draft preservation after a stale save.
- `pnpm run audit`: no known production dependency vulnerabilities reported.
- `git diff --check`: passed.

These are local working-tree results, not a signed extracted-artifact qualifier,
hosted GitHub Actions result, independent penetration test, real payment
settlement, or proof of production usability. A release must still pass its
normal PR, signed-package, and hosted qualification gates before CodeY changes
its immutable CMS pin.

## CodeY Coordination

The CodeY agent independently confirmed the platform findings and the live
endpoint results. It reproduced failed, rolled-back, and queued replacement
attempts obscuring an older live release. Its existing operations tests passed
3/3 but do not cover that distinction. The concurrency details above were also
checked directly in the source during this audit.

The agreed smaller first delivery step is qualifying the existing signed
self-host package with a nontechnical owner, before adding managed Docker
hosting. Public discovery deployment should use an immutable verified package
or verified CMS source, not an unpinned latest package. This coordination is
now backed by the local implementation and verification above; paid evaluation,
production deployment, and release publication have not started.

## Owner Delivery Follow-Up

The user subsequently requested implementation of the three delivery priorities.
This follow-up is also uncommitted and unreleased.

CMS changes now include interrupted-install reconciliation, sign-in recovery
without a second installation, optional browser-storage hints, correct settings
deep links, an owner handover configuration report, and a management-only
encrypted backup request through the existing worker. Requests accept no command,
path, or restore flag. The worker verifies encryption, reports actual completion,
uses a fresh heartbeat, and shares an exclusive backup lock with scheduled and
pre-update backups. A hard crash requires an operator to check and clear a stale
lock; the software does not steal a potentially live backup's lock.

The launch checklist no longer claims configuration proves public readiness.
The updater likewise does not claim to be up to date before checking the signed
feed. All active owner accounts must have MFA for that configuration check to
pass. See `owner-handover.md` for owner steps, operator duties, exact API fields,
and the requirement to refresh an older standalone backup container after the
new feature is released. No new environment variables or database migrations
were added; existing roles and signed-update enforcement remain intact.

CodeY reports that the independently verified signed v1.5.0 CMS and shop package
qualifications passed through the canonical extracted-package installer,
login/import/edit/restart/SSR, and encrypted recovery. It also implemented MCP
candidate/external verification and sidecar rollback tooling, and tightened
dynamic worker evidence binding. These are reported platform results, not a
claim that the new CMS working tree is already signed or deployed.

The final platform follow-up reports 1,098 source tests passed, 14 expected
opt-in skips, and 26 focused deployment/MCP/qualification regressions passed.
Its final Creator/Operations browser matrix passed 12 cases across desktop,
tablet, and mobile after one unchanged tablet retry following a timeout during
concurrent validation. The earlier 48-case matrix also passed. Typecheck, build,
formatting, OpenAPI, Compose configuration, and six delivery repository checks
passed. These are the CodeY task's reported results, not independently rerun CMS
checks. Its changes are also uncommitted and have not changed the CMS release pin.

Production delivery remains unfinished:

- Both configured SSH targets rejected the platform task's authentication.
  No remote changes were made, and the owner was asked for the correct existing
  SSH alias or key path, never private-key contents.
- The real restricted Docker/SSH transport, target resource isolation, and
  staged activation/rollback/TLS qualification are not implemented or verified
  on the shared static hosting server. A structured agent protocol and a local
  package qualifier are prerequisites, not a functioning managed hosting service.
- An independent HTTPS check of `https://usecodey.com/mcp` still returned 404.
  The connector is not publicly deployed despite the prepared deployment tool.
- No real nontechnical customer handover or production recovery drill was
  performed. Automated tests must not be recorded as human usability evidence.

### Follow-Up Verification

The exact CMS source passed the following local checks against a disposable
PostgreSQL database and shadow database, with browser port 4186:

- `validate`: pinned containers, web freshness, lint, extensions, 205-operation
  OpenAPI inventory, typecheck, 394 unit tests, schema validation, CMS/MCP builds,
  and coverage ratchets for 39 critical files. Overall line coverage is 69.77%.
- Migration shadow diff: no difference detected.
- Installation: 4 passed. Database/API integration: 19 passed, including an
  authenticated request through the real encrypted backup command and database.
- Encrypted database and local-media recovery: 1 passed.
- Final complete browser run: 50 passed, 4 existing intentional skips, zero
  failures, across Chromium, Firefox, and WebKit. The six new owner-flow cases
  include desktop/mobile layouts and handover report downloads. Browser failure
  states are intercepted fixtures; the integration suite separately exercises
  actual API permissions, queue completion, encryption, and audit records.
- Dependency audit: no known production vulnerabilities. `git diff --check`
  passed.

The initial `test:release` command passed its non-browser stages but exited 1
after five existing browser cases timed out during concurrent cross-project
testing. All five passed unchanged in a 22.8-second isolated retry; the complete
54-case browser suite then passed in 1.9 minutes. No assertions, timeouts, or
source code were changed between these runs. This is completed component-level
release validation, not a claim that the initial command passed in one run.

The disposable database was used only for this validation. These results do not
qualify a new signed artifact, hosted CI, production hosting, a human handover,
or a public MCP deployment. The published CMS remains v1.5.0 until the normal
review, signed-release, and extracted-artifact gates pass for these changes.

## Managed Host Review: 13 September

The coordinated source review found and fixed two additional recovery gaps:

- A requested backup arriving during a scheduled snapshot could return HTTP 202
  without its own job ID. It now queues a separate encrypted job, and concurrent
  requests reuse that job rather than claiming the scheduled snapshot completed it.
- The update supervisor previously took its recovery snapshot before stopping
  application writes. An edit accepted after the snapshot could be lost during
  rollback. It now stops the runtime first, then snapshots; failure to create the
  backup restarts the unchanged previous runtime without switching or migrating.

Focused regressions passed 35/35. The full local `test:release` run passed
validation (397 unit tests, 39 coverage ratchets, typecheck/build, web freshness,
205-operation API inventory, pinned containers and extensions), migration shadow
diff, installation 4/4, database/API integration 19/19 and encrypted recovery 1/1.
The browser stage had 48 passes, 4 intentional skips and two Chromium failures:
the existing shop test did not show the signed-in identity within five seconds,
and the existing tabs test timed out during browser-context teardown. Both passed
unchanged in a 4.9-second isolated rerun. The initial full command exited 1; this
is not a claim of an uninterrupted green release run. Dependency audit and
`git diff --check` passed. Hosted browser stability remains a release gate.

[Managed hosting](managed-hosting-contract.md) now records the canonical package,
resource, secret, migration, candidate-isolation, write-fencing, cutover and
recovery contract. In particular, production startup always runs migrations;
restored shop settings can still send real email; and an old writable runtime
volume can keep old code active despite a new image tag. These are platform
integration requirements, not a newly implemented CMS hosting adapter.

The latest published release was checked on GitHub and remains v1.5.0 at
`019f1c9eae403b3fee0695ff34c5c6ae57fb708f`. The new supervisor ordering requires
refreshing the signed self-host backend package, not only its application files.
The encrypted queue likewise requires the updated standalone backup worker.
No migrations, dependencies, environment options, commits, pushes, releases or
pin changes were added by this follow-up. New signed-artifact and upgrade/forced
rollback qualification are still required before publication.
