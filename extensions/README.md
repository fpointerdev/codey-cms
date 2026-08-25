# CodeY Extension Catalog

This directory is the checksum-pinned catalog shipped with CodeY CMS. Catalog
extensions are declarative content-model packs and cannot execute server or
browser code.

## Contribute a pack

1. Run `pnpm extension:create vendor.extension-name`.
2. Keep the generated manifest focused on one editor workflow.
3. Add discoverability, documentation, support, and changelog links.
4. Run `pnpm extension:catalog` after every manifest change.
5. Run `pnpm extension:validate` and `pnpm validate`.
6. Open an extension proposal issue before adding a broadly scoped pack.

Reviewers verify naming, schema quality, accessibility of labels, compatibility,
license, support ownership, and upgrade safety. A catalog checksum mismatch fails
CI and prevents the pack from appearing as catalog verified. The complete review,
maintenance, deprecation, ownership, and security policy is in
`docs/extension-governance.md`.
