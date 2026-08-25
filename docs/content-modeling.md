# Content Modeling

Custom collections store repeated structured content without adding code or database tables by hand. Common examples are team members, locations, events, resources, testimonials, properties, and partner directories.

## Dashboard workflow

1. Open **Collections** in the dashboard.
2. Create a collection and choose a short URL name.
3. Add only the fields editors need, order them with the accessible **Up** and **Down** controls, then choose the field used as each entry's display title.
4. Add entries as drafts, publish immediately, or set a future publish time.

The generated entry form supports short and long text, sanitized rich text, validated email and web addresses, numbers, toggles, dates, date-times, uploaded images and files, choices, and relations to another collection. Optional guidance, placeholders, text lengths, and number ranges stay inside a collapsed validation panel so the primary workflow remains short. Collections and entries use existing CMS permissions, so no extra role setup is required.

## Data safety

- Collection slugs and field keys are unique and validated.
- Entry payloads are limited to 256 KB and 100 values per multiple field.
- Unknown fields are rejected instead of stored silently.
- Rich text is sanitized before persistence.
- Relation values must resolve to real entries in the same site and locale.
- Referenced entries cannot be renamed or deleted until related entries are updated.
- A model update is rejected if any existing entry would become invalid.
- Deleting a collection requires its slug and is blocked while another collection references it.
- Every entry create, update, and restore writes a revision snapshot.

## API

Collection management requires the normal `cms` permission:

```text
GET    /api/v1/cms/collections
POST   /api/v1/cms/collections
GET    /api/v1/cms/collections/:collectionSlug
PATCH  /api/v1/cms/collections/:collectionSlug
DELETE /api/v1/cms/collections/:collectionSlug
```

Published entries in a public collection are readable without authentication. Draft and archived entries require `read:cms`:

```text
GET    /api/v1/cms/collections/:collectionSlug/entries
POST   /api/v1/cms/collections/:collectionSlug/entries
GET    /api/v1/cms/collections/:collectionSlug/entries/:entrySlug
PATCH  /api/v1/cms/collections/:collectionSlug/entries/:entrySlug
DELETE /api/v1/cms/collections/:collectionSlug/entries/:entrySlug
```

Use `locale`, `q`, `page`, and `limit` on entry lists. Authenticated editors may add `includeDrafts=true`. Public responses never expose drafts, archived entries, private collections, or entries whose publish time is in the future.

Headless clients can add up to ten exact typed filters with repeated `filter=field=value` parameters. Text, email, URL, number, boolean, date, choice, and relation fields are filterable; rich text and assets are intentionally excluded. Use `sortBy=title|publishedAt|createdAt|updatedAt` and `sortOrder=asc|desc` for deterministic ordering.

## Portable content bundles

Administrators can export or import up to twenty collections and 5,000 entries through the dashboard or API:

```text
POST /api/v1/cms/collections/export
POST /api/v1/cms/collections/import
```

The `codey-cms.content-bundle` `1.0` contract is described by `docs/schemas/codey-content-bundle-1.0.schema.json`. Imports are create-only and atomic: all models are created first, entries are normalized and sanitized, cyclic and cross-collection relations are validated after every entry exists, and one failure rolls back the entire bundle. Existing collection slugs are never overwritten. Revision history starts with an `IMPORT` revision; older audit history remains available through encrypted backups rather than portable bundles.

## Scheduling and revisions

Custom entries participate in the existing `/api/v1/cms/publishing/scheduled` and `/api/v1/cms/publishing/run` workflow. Revision history is available below each entry API path and restore creates a new revision rather than erasing history.
