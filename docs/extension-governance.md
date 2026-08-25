# Extension catalog governance

The CodeY catalog is a reviewed distribution channel for declarative content-model packs. Catalog inclusion does not grant an extension executable access to the CMS, browser, database, network, secrets, or permission system.

## Acceptance

An extension proposal must have a unique vendor-prefixed ID, an open-source license compatible with distribution, a maintained repository, public documentation, a support channel, and a changelog. Its manifest must pass the catalog checksum, schema, compatibility, lifecycle, and full repository validation gates.

Reviewers also check that the pack solves a clear editor workflow, uses understandable field labels, stays within the supported content-model contract, and can upgrade without deleting or silently changing existing content. Approval is based on the extension version and digest in `extensions/catalog.json`; later changes require a new review.

## Versioning and compatibility

Extension versions follow semantic versioning:

- patch releases fix metadata or behavior without changing the stored model contract;
- minor releases may add optional fields or models;
- major releases may require an intentional content migration or a newer CMS contract.

Every release declares a bounded CodeY CMS compatibility range. Reusing a version number with different manifest content is rejected. Catalog extensions should support the latest stable CMS release and one preceding minor release when the manifest contract allows it.

## Maintenance and deprecation

Maintainers own documentation, support triage, compatibility testing, and security response for their packs. An unmaintained extension may be marked deprecated after maintainers are contacted through the published support and repository links.

Deprecation removes the pack from new-install recommendations only after a documented transition period. Existing installation receipts and collections continue to work. Removing a pack from the runtime never deletes site data, and administrators may disconnect it while preserving all collections and entries.

Ownership transfers require confirmation from the current and new maintainers, unchanged extension identity, updated repository and support metadata, and a fresh catalog review. IDs are not reassigned to unrelated projects.

## Security reports

Report catalog or CMS security issues through `SECURITY.md`, not a public issue. A compromised or misleading pack can be removed from the catalog immediately. Because extensions are declarative, removal blocks future verified installation without loading or executing third-party code; existing site content remains available for recovery and migration.

## Appeals and transparency

Catalog decisions are recorded on the extension proposal or pull request with concrete contract, maintenance, licensing, or security reasons. A maintainer can submit a revised version for review after addressing those reasons. The same manifest schema, catalog generator, and validation commands used by maintainers are public and run in CI.
