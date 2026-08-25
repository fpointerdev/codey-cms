# CodeY Extensions

CodeY extensions are declarative content-model packs. They expand a site without loading third-party JavaScript into the API process, changing core permissions, or bypassing signed CMS updates.

## Create an extension

```bash
pnpm extension:create yourname.extension-name
pnpm extension:catalog
pnpm extension:validate
pnpm extension:validate -- extensions/yourname-extension-name
pnpm extension:validate -- --json extensions/yourname-extension-name
```

The scaffold creates `extensions/<name>/codey-extension.json` with a `$schema` reference for editor completion and inline validation. A manifest declares identity, semantic version compatibility, license and author metadata, discoverability and support links, and one to twenty custom collections. Unknown keys and executable entry points are rejected. The validator accepts the bundled extension root, one extension directory, or one manifest file; `--json` provides a stable machine-readable result for external CI.

The dashboard lists compatible packs under **Collections > Extensions**. Editors can search manifest names, descriptions, authors, categories, and keywords, narrow the catalog by category, and open validated documentation and support links. An authorized editor can install all models in a pack atomically. Installation stops without partial writes when a collection slug conflicts or a relation target is missing.

## Lifecycle and data ownership

Each installation stores the validated manifest, version, and SHA-256 digest in PostgreSQL. Before an update, CodeY compares every current collection with its installed snapshot:

- untouched models update together in one transaction;
- incompatible entry data rolls back the complete update;
- locally customized or missing models that an update would retain pause the update instead of being overwritten;
- models removed by a newer pack become normal collections and keep all entries;
- disconnect removes only the installation receipt and never deletes collections or content;
- concurrent install or update requests are serialized by a database transaction lock.

Reusing a version number with changed manifest content is rejected. Publish every manifest change with a higher semantic version.

## Compatibility

Use a bounded CMS range such as:

```json
{
  "requires": {
    "cms": ">=1.1.0 <2.0.0"
  }
}
```

The initial contract supports exact versions and the `>`, `>=`, `<`, `<=`, `^`, and `~` comparators. Keep ranges narrow enough to communicate what was tested.

Email and URL content fields require CodeY CMS 1.1.0 or newer. URL values accept only HTTP or HTTPS addresses without embedded credentials.

## Security boundary

An extension manifest cannot declare server entry points, scripts, SQL, arbitrary HTML, secrets, network permissions, or admin JavaScript. Media fields use the normal CMS upload API and rich text uses the same sanitizer as pages and posts.

Extensions are included in self-host release archives and may also be mounted from a dedicated directory through `CODEY_EXTENSIONS_DIR`. That environment setting selects a directory only; site content and extension installation state remain in the database.

Bundled extensions are listed in `extensions/catalog.json`. The catalog pins each validated manifest by ID, version, directory, and SHA-256 digest. A mismatch fails CI and the runtime does not present the pack as verified. A mounted directory without a catalog is labeled **Operator pack** so administrators can distinguish local trust from CodeY catalog verification.

## Publishing a pack

Before proposing an extension:

1. Use a globally unique vendor-prefixed ID.
2. Include a clear license and repository URL.
3. Keep field labels understandable to nontechnical editors.
4. Validate the manifest and run `pnpm validate`.
5. Regenerate `extensions/catalog.json` after every manifest change.
6. Include tests for compatibility, field validation, lifecycle updates, and installation conflicts.

Catalog acceptance, semantic-versioning, support, deprecation, ownership-transfer, and security-response rules are defined in `docs/extension-governance.md`.
