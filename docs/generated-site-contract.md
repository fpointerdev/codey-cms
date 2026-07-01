# Generated Site Contract

This contract defines what a generated client site can assume from a copied Codey runtime. It is written for AI agents, generators, and developers building project-specific themes on top of Codey.

Codey is the runtime base. The later selling/deployment platform can copy this repo, set environment variables, run migrations and seed, apply a `WebsiteSpec`, and deploy the result.

## Stable Runtime Assumptions

- API base path: `/api/v1`.
- Public pages are served by the Node runtime from `apps/web/index.html` and CMS content.
- Admin login path: `/cy-admin`.
- Admin dashboard path: `/dashboard`.
- Auth uses JWT access tokens plus rotating refresh tokens.
- Modules are stored in the database through `InstalledModule` and `ModuleSetting`.
- CMS content is structured as pages, sections, blocks, posts, menus, redirects, revisions, forms, and media assets.
- Optional localization is controlled by the `localization` module and `ModuleSetting`, not by `.env`.
- Media is stored through the storage adapter and referenced by `MediaAsset`.
- Shop checkout uses server-side products, variants, shipping, coupons, tax, and order totals.
- Payment providers must call signed normalized webhook endpoints before order payment state changes.

## What A Generated Theme May Change

A generated customer theme may change:

- Public page layout and CSS.
- CMS page, section, and block content.
- Menus and footer content.
- Public renderers for posts, products, and landing pages.
- Site settings, SEO fields, and media placeholders.
- Project-specific static assets inside the copied project.

The theme should keep admin routes, auth flows, module APIs, payment trust boundaries, and Prisma migrations intact unless the change is a deliberate base-product upgrade.

## What An AI Agent Must Not Change

Do not change these without a base-product review:

- Core auth, password reset, invite, or refresh-token logic.
- RBAC middleware and permission checks.
- Payment webhook signature verification.
- Order total calculation and stock reservation.
- Prisma migrations without running migration validation.
- Public draft visibility rules.
- Storage key safety and media quota enforcement.
- `/api/v1` request or response contract.

## WebsiteSpec Flow

The platform should refine the customer prompt into a strict `WebsiteSpec`.

1. Read `GET /api/v1/config/generation/contract`.
2. Validate the spec with `POST /api/v1/config/generation/validate`.
3. Apply with `POST /api/v1/config/generation/apply`.
4. Use `dryRun: true` before writing real content.
5. Run validation and a browser smoke test before publish.

Fixture specs live in `fixtures/website-specs/`.

Run the local generation contract check before publishing generated output:

```bash
pnpm run generation:simulate
```

The simulation validates fixture specs, deployment profile selection, module resolution, navigation targets, generated block types, product references, media placeholders, SEO metadata, and gallery block shape.

Run the copied-runtime check before trusting a base change for generated client projects:

```bash
pnpm run generation:simulate:copy
```

This copies Codey to a temporary runtime, installs dependencies offline, verifies `presentation`, `cms`, and `shop` profiles, generates Prisma schema/client output, runs typecheck/build, checks matching WebsiteSpec fixtures, and runs the admin SPA smoke tests. The DB-backed deploy/seed/apply smoke also boots each copied runtime and runs HTTP plus Playwright browser smoke tests. It requires an existing PostgreSQL database source.

To include DB-backed migration/seed/apply/server/browser smoke against isolated schemas derived from an existing local test database URL:

```bash
CODEY_COPIED_RUNTIME_DB_SMOKE=true \
CODEY_COPIED_RUNTIME_DATABASE_URL_SOURCE=TEST_DATABASE_URL \
pnpm run generation:simulate:copy
```

Use `CODEY_COPIED_RUNTIME_DATABASE_URL_TEMPLATE` with `{profile}` and `{run}` placeholders when a platform or CI runner provisions separate databases per profile.

Use `CODEY_COPIED_RUNTIME_DATABASE_URL_SOURCE=DATABASE_URL` for a local development check when the dedicated test database does not exist. Do not point this at production.

Use `CODEY_COPIED_RUNTIME_BROWSER_SMOKE=false` only when browser binaries are intentionally unavailable. A release candidate should keep the browser smoke enabled.

## Builder Registry Contract

The generation contract exposes a versioned builder registry at `builder.version`, `builder.elements`, `builder.sectionPresets`, `builder.stylePresets`, and `builder.sectionPatterns`.

Generated pages must use registered elements instead of anonymous JSON structures:

- Set `section.settings.elementId` to a valid `builder.elements[].id`.
- Only use block types allowed by that element's `blockTypes`.
- Treat `structured-content` as a fallback for unsupported generated content, not as the normal path.
- Prefer the reusable visual elements for common sections: `hero-creative`, `stats-grid`, `feature-cards`, `team-section`, `logo-grid`, `testimonials`, `pricing-cards`, `faq-accordion`, `tabs`, and `accordion`.
- Populate visual element collections with meaningful item objects. Tabs, accordions, FAQs, testimonials, and feature cards need item titles plus body text; stats need labels plus values; pricing cards need titles plus prices or metrics.
- Keep static gallery/portfolio pages on the `gallery` element and rotating media on `slider` or `carousel`.
- Prefer `builder.sectionPatterns` for common full-section layouts before assembling low-level elements manually.
- Use `builder.stylePresets` for visual direction before falling back to custom colors.
- Use the section preset list for layout intent instead of inventing unrelated container settings.
- Use safe section settings for layout and styling: `layout`, `container`, `spacing`, `align`, `verticalAlign`, `minHeight`, `style`, and `decoration`.
- Use `settings.customCss` only as an advanced escape hatch when the registered controls cannot express the design.

## Content Creation Rules

Pages:

- Create editable CMS pages, not hardcoded one-off HTML.
- Use clear slugs such as `home`, `about`, `services`, `products`, `contact`.
- Set `project.locale` in the `WebsiteSpec`; generated pages, posts, categories, and menus are written for that locale.
- Enable `modules.localization` only when the generated site needs multiple languages or localized URL prefixes.
- Put SEO title and description on every important page.
- Use sections and blocks so the dashboard builder can edit content later.
- Use `GALLERY` blocks with `settings.displayMode: "gallery"` for static gallery or portfolio pages.
- Use slider/carousel settings only when the intended UI is a rotating or navigable media component.

Posts:

- Use posts for news, articles, project stories, and updates.
- Keep post body as sanitized rich content.
- Attach categories and tags when useful.

Menus:

- Use the `main` menu for primary navigation.
- Link menu items to CMS pages when possible.
- For localized sites, create/update the menu in the same locale as the pages it links to.
- Use custom URLs only for external links, anchors, mail, and phone links.

Media:

- Create media placeholders with descriptive `altText`.
- Do not use copyrighted images from other websites.
- Use generated or client-owned assets.
- Attach images to CMS blocks or product records through `MediaAsset`.
- Gallery blocks should use `items` with image URLs, alt text, captions, and optional links.

Products:

- Use active product records only when the shop module is enabled.
- Keep prices in cents and currency as ISO 4217 codes.
- Let checkout calculate totals server-side.
- Do not trust totals submitted by frontend code.

Site settings:

- Store title, description, meta title, and meta description through settings APIs.
- Keep module configuration in the database, not in client-side code.
- Store localization settings through `/api/v1/config/modules/localization/settings`.

## Example: Presentation Site

Profile: `presentation`

Expected modules:

- CMS
- Auth/users/roles/config/health

Typical generated content:

- Home
- About
- Services
- Projects
- Contact
- Main menu
- Contact form block
- Media placeholders for hero and project images

## Example: CMS Site

Profile: `cms`

Expected modules:

- CMS
- Notifications
- Auth/users/roles/config/health

Typical generated content:

- Home
- About
- Blog index
- Contact
- Starter posts
- Categories
- Main menu
- Redirects for old URLs when provided

Optional multilingual content:

- Enable `modules.localization`.
- Create one locale at a time.
- Keep translated pages/posts linked with stable `translationGroupId` values.
- Use default-locale URLs without a prefix and non-default locale URLs such as `/sq/about`.

## Example: Shop Site

Profile: `shop`

Expected modules:

- CMS
- Products
- Orders
- Notifications
- Payments
- Auth/users/roles/config/health

Typical generated content:

- Home
- Shop
- Product detail renderer
- Cart and checkout reference flow
- Contact
- Product categories
- Starter products
- Order confirmation email settings

## Publish Readiness

Before publish:

- `/api/v1/health/ready` is ready.
- `pnpm run validate` passes.
- Public pages do not expose drafts.
- `/cy-admin` is private and usable.
- Menus resolve to pages or valid custom URLs.
- Contact forms submit without console errors.
- Shop checkout uses server-calculated totals.
- Site has canonical title and meta description.
