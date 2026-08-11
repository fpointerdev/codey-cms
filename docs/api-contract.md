# API Contract

Codey freezes `/api/v1/*` as the first stable runtime API contract. Generated sites, dashboard screens, and the later selling/deployment platform should treat this version as stable.

Breaking changes require a new version prefix such as `/api/v2`. Do not silently change request shapes, response shapes, required permissions, pagination semantics, or public visibility behavior under `/api/v1`.

## Response Envelope

Successful responses use one envelope:

```json
{
  "success": true,
  "data": {},
  "error": null,
  "meta": null
}
```

Failed responses use the same envelope:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "validation_failed",
    "message": "Request validation failed.",
    "details": {}
  },
  "meta": {
    "requestId": "request-id"
  }
}
```

`meta.requestId` should be present on errors so support can trace logs. List endpoints should put pagination in `meta.pagination`.

## Standard Errors

Use stable error codes so generated sites and admin screens can render useful messages:

- `validation_failed`: request params, query, or body failed Zod validation.
- `unauthorized`: the request is missing a valid session or access token.
- `forbidden`: the user is authenticated but lacks the required permission.
- `not_found`: a record or route does not exist.
- `conflict`: a unique constraint or business conflict blocked the request.
- `rate_limited`: request rate limit was exceeded.
- `maintenance_mode`: runtime is intentionally unavailable.
- `internal_error`: unexpected server failure.

Do not expose raw Prisma errors, database connection strings, secrets, provider tokens, or stack traces to clients.

## Pagination

Paginated endpoints should accept positive integer `page` and `limit` query params. `limit` should have a defensive maximum, usually `100`.

Responses should include:

```json
{
  "meta": {
    "pagination": {
      "page": 1,
      "limit": 50,
      "total": 120,
      "totalPages": 3
    }
  }
}
```

## Auth

Auth uses JWT access tokens and rotating refresh tokens. Generated sites should assume:

- Login returns a short-lived access token and stores the refresh token in a strict HttpOnly cookie.
- Browser code keeps access tokens in memory and never stores credentials in local storage.
- Refresh rotates the HttpOnly refresh cookie and invalidates the previous token.
- Logout revokes the current refresh cookie.
- Password changes and session revocation invalidate all access and refresh tokens through the user's session version.
- Password reset and email verification tokens are delivered through the configured recovery delivery mode.
- Production never returns password reset or email verification tokens in API responses.
- Authenticated administrators can receive a manual invite URL when transactional email is unavailable.
- Accounts without two-step verification keep the existing login request. Enabled accounts receive `mfa_required` until login is repeated with the optional `mfaCode` field.
- `/auth/mfa`, `/auth/mfa/setup`, and `/auth/mfa/confirm` are additive account-security endpoints; enabling or disabling MFA revokes older sessions.
- Repeated failures are delayed by persistent account and IP throttles. Clients should display `login_temporarily_delayed` without retry loops.

## RBAC

Mutating dashboard, CMS, shop, module, and user endpoints must require explicit permissions. Stable permission failures use `forbidden`.

Core permissions include:

- `manage:all`
- `read:users`
- `update:users`
- `invite:users`
- `read:roles`
- `create:roles`
- `update:roles`
- `read:cms`
- `create:cms`
- `update:cms`
- `publish:cms`
- `read:products`
- `create:products`
- `update:products`
- `read:orders`
- `update:orders`
- `read:payments`
- `update:payments`
- `read:modules`
- `manage:modules`
- `manage:secrets`
- `read:audit`

## Public Visibility

Public endpoints must never expose drafts or archived records to anonymous users:

- CMS pages and posts return only published, currently visible content.
- Products return only active public catalog records.
- Preview and draft reads require authentication and the matching read permission.

## Endpoint Families

Stable `/api/v1` endpoint families:

- `auth`: register, login, refresh, logout, password changes, session revocation, password reset, email verification, invites, current user.
- `users`: user list, detail, profile, status updates.
- `roles`: role and permission metadata.
- `config`: runtime config, modules, domains, audit logs, generation contract.
- `cms`: pages, posts, sections, blocks, revisions, menus, redirects, media, forms, sitemap, robots.
- `products`: catalog, product media, options, variants, and public storefront settings.
- `orders`: orders, carts, checkout, shipping, tax, coupons, order notifications.
- `payments`: site payment-provider configuration, public provider discovery, Stripe intents, PayPal orders/capture, manual settlement, and verified idempotent webhooks.
- `health`: minimal public liveness/readiness plus authenticated operational diagnostics and metrics.

Runtime configuration is split by audience:

```text
GET /api/v1/config        # public rendering contract
GET /api/v1/config/admin  # authenticated dashboard contract
```

The public contract is limited to app identity, public feature flags, localization, public
site settings, the public media base URL, and responsive image widths. Environment names,
proxy settings, storage locations, module lifecycle metadata, deployment profiles, update
configuration, and builder compatibility internals are available only through authenticated
administrative endpoints.

Transactional email configuration is site-owned:

```text
GET   /api/v1/config/email
PATCH /api/v1/config/email
POST  /api/v1/config/email/test
```

The email provider API key is write-only and encrypted at rest. Endpoint or credential changes require `manage:secrets` and a recent authenticated session; MFA-enabled accounts must have completed MFA recently. Resend and Postmark use native request contracts; a generic HTTP adapter remains available. Production generic endpoints connect only to the public addresses approved during validation and cannot redirect. Owners can enable account recovery in the same dashboard form. The test endpoint records provider success or failure for readiness checks.

Stripe and PayPal configuration and connection tests also require `update:payments`, `manage:secrets`, and recent authentication. Manual-payment instructions require only `update:payments`. Connection-test results are applied only when the tested configuration revision is still current.

Storefront customization is site-owned and public rendering reads the same validated settings:

```text
GET   /api/v1/products/settings
PATCH /api/v1/products/settings  # update:products
```

The settings contract covers catalog copy, default sorting, listing and product-detail presentation, uploaded hero media and CTA, page size, and category, attribute, description, SKU, and stock visibility.
`GET /api/v1/products` accepts `sort=newest|name|price-low|price-high`; public catalog navigation sends the saved default so client-rendered and server-rendered listings keep the same stable order.

Public order lookup uses a bearer credential returned once at checkout and included in the
confirmation email:

```text
POST /api/v1/orders/lookup
{ "orderNumber": "ORD-...", "lookupToken": "..." }
```

The database stores only the SHA-256 token hash. Confirmation-email retries keep the raw
token in an authenticated encrypted envelope and clear that envelope after delivery. The
public response is a dedicated customer-safe order projection without database IDs,
metadata, payment details, notification records, or token hashes. Orders created before
the secure lookup migration have no anonymous fallback; they remain available to
authenticated administrators and can only gain a public token through a future verified
reissue workflow.

## Contract Source

`docs/openapi-v1.json` is a generated OpenAPI 3.1 route inventory with source locations for every module endpoint. `pnpm api:check` fails when route additions, removals, or version changes are not regenerated. Express route files and their referenced Zod schemas remain authoritative for request and response details; the inventory deliberately does not invent schema guarantees that are not generated from those validators.

## Compatibility Checklist

Before changing an existing `/api/v1` endpoint, verify:

- Request path, method, params, query, and body shape remain compatible.
- Response envelope stays `{ success, data, error, meta }`.
- Pagination metadata stays compatible on list endpoints.
- Auth and permission requirements are unchanged or explicitly documented.
- Public visibility rules still block drafts, archived records, and private data.
- Generated-site contract docs are updated when CMS, media, shop, config, or auth behavior changes.
- `pnpm validate` passes, including backend TypeScript linting and critical-module coverage ratchets, and focused route/service tests cover the changed behavior.
- Existing route/contract tests either stay green or the change moves to `/api/v2`.

## Contract Tests

Keep contract tests close to the module route tests. The minimum base coverage is:

- Auth: login, refresh, logout, password reset, email verification, invites.
- Users/RBAC: list users, update user, role permissions, forbidden access.
- CMS: public visibility, pages, posts, menus, media, revisions, contact submissions.
- Shop: products, carts, orders, stock reservation, webhook idempotency.
- Config: modules, site settings, domains, audit logs, generation contract.

Any `/api/v1` change should either keep these tests green or intentionally introduce a `/api/v2` contract.
