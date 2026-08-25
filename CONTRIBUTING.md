# Contributing to CodeY CMS

CodeY CMS is a self-hosted project for both nontechnical site owners and developers. Contributions should preserve simple installation, safe defaults, accessible administration, server-rendered public content, and compatibility with the generated-site contract.

## Before opening a change

- Search existing issues and pull requests.
- Use an issue for behavior changes that affect an API, migration, WebsiteSpec, or release contract.
- Report security problems privately as described in `SECURITY.md`.
- Keep platform-only code and credentials out of this repository.

## Development workflow

```bash
pnpm install
cp .env.example .env
pnpm db:push
pnpm db:seed
pnpm validate
```

Use a test-only PostgreSQL database for integration and browser tests. The test runner rejects database names that do not include `test`, `ci`, or `e2e`.

Keep pull requests focused. Add a migration for schema changes, a Zod contract for input changes, and tests at the lowest useful level. User-facing dashboard changes should be checked on desktop and mobile and remain usable with a keyboard.

## Extensions

Create declarative model packs with:

```bash
pnpm extension:create yourname.extension-name
pnpm extension:catalog
pnpm extension:validate
```

Extension manifests cannot execute code. Explain the intended editor workflow, use a narrow CMS compatibility range, include a recognized open-source license, and provide documentation and support ownership. Catalog contributions must update the checksum-pinned `extensions/catalog.json`.

## Pull request checklist

- The change preserves existing user data and includes an explicit migration when needed.
- Public draft visibility, permissions, signed updates, and secret storage are unchanged unless the pull request explicitly hardens them.
- API inventory is current with `pnpm api:generate`.
- `pnpm validate` passes.
- Relevant integration or browser tests pass.
- Documentation explains any administrator action or compatibility requirement.

By contributing, you agree that your contribution is licensed under `GPL-2.0-or-later`.
