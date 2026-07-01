# Module System

Codey modules behave like controlled single-site plugins. The copied runtime owns its own database module state, and the later selling/deployment platform can decide which modules to enable for each customer project.

The source of truth for available modules is `src/modules/manifest.ts`. The source of truth for one copied runtime's active modules is the database.

## Runtime Tables

- `InstalledModule`: records whether a module is installed and enabled for the copied site.
- `ModuleSetting`: stores per-module JSON settings.
- `Site`: identifies the copied site/runtime profile.

Avoid environment-only feature control for customer-manageable modules. Environment variables can define bootstrap defaults and production safety requirements, but module enablement should be database-backed.

## Lifecycle

Supported lifecycle hooks:

- `install`: create the module row and prepare default settings.
- `enable`: make the module available to the runtime.
- `disable`: hide the module without deleting settings or data.
- `uninstall`: remove the installed module record when allowed.
- `seed`: create module starter data.
- `migrate`: reserved for module-aware migration workflows.

Required core modules cannot be disabled or uninstalled.

## Dependency Rules

Dependencies are declared in `src/modules/manifest.ts`.

Current important rules:

- `users` depends on `auth` and `roles`.
- `roles` depends on `auth`.
- `orders` depends on `products`.
- `payments` depends on `orders`.

The runtime must block:

- Enabling a module when dependencies are missing or disabled.
- Disabling a module that still has enabled dependents.
- Disabling required core modules.

The schema generator also includes required Prisma schema dependencies when a module-specific schema is requested.

## Packaging Metadata

The manifest may keep module packaging metadata for generator and platform planning:

- `plans`
- compatibility notes
- deployment profile capability totals

The legacy `monthlyEuroCents` field may still exist in the database for backward compatibility, but it is not the CodeY platform billing model. Platform customer billing is based on measured AI token expense only.

## Upgrade Strategy

Every copied runtime should expose compatibility through:

```text
GET /api/v1/config/compatibility
```

The platform should store the deployed base version and enabled module versions for every copied customer runtime. Before upgrading or enabling a module, compare:

- Runtime base version.
- Module manifest version.
- `minBaseVersion`.
- Optional `maxBaseVersion`.
- Enabled dependencies.
- Pending migrations.

If a mismatch exists, the platform should block automatic rollout and require an upgrade plan.

## Module Data Boundaries

Modules may depend on core infrastructure, but they should not silently reach across domains:

- CMS can render product-list blocks, but product data stays owned by the products/shop modules.
- Orders can reference products and variants because that dependency is explicit.
- Payments can update payment/order state through signed normalized webhooks because it depends on orders.
- Notifications can deliver module events, but each source module owns when events are queued.

## Generated Site Guidance

AI-generated themes should read module state before rendering module-specific screens.

- CMS disabled: hide pages/posts builder links and block public CMS routes.
- Products/orders disabled: hide shop navigation and checkout routes.
- Payments disabled: do not show online-payment copy.
- Contact form block requires CMS.

The dashboard should explain disabled modules with a clear empty state or upgrade/setup action instead of showing broken routes.
