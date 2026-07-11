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

- Login returns access and refresh tokens only when auth succeeds.
- Refresh rotates the refresh token and invalidates the previous token.
- Logout revokes the submitted refresh token.
- Password reset, email verification, and invite tokens are delivered through the configured recovery delivery mode.
- Production must not return recovery tokens in API responses.

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
- `read:audit`

## Public Visibility

Public endpoints must never expose drafts or archived records to anonymous users:

- CMS pages and posts return only published, currently visible content.
- Products return only active public catalog records.
- Preview and draft reads require authentication and the matching read permission.

## Endpoint Families

Stable `/api/v1` endpoint families:

- `auth`: register, login, refresh, logout, password reset, email verification, invites, current user.
- `users`: user list, detail, profile, status updates.
- `roles`: role and permission metadata.
- `config`: runtime config, modules, domains, audit logs, generation contract.
- `cms`: pages, posts, sections, blocks, revisions, menus, redirects, media, forms, sitemap, robots.
- `products`: catalog, product media, options, variants.
- `orders`: orders, carts, checkout, shipping, tax, coupons, order notifications.
- `payments`: site payment-provider configuration, public provider discovery, Stripe intents, PayPal orders/capture, manual settlement, and verified idempotent webhooks.
- `health`: liveness, readiness, metrics.

## Contract Source

Express route files and their referenced Zod schemas are the current executable API contract. This repository does not currently generate or commit an OpenAPI document.

## Compatibility Checklist

Before changing an existing `/api/v1` endpoint, verify:

- Request path, method, params, query, and body shape remain compatible.
- Response envelope stays `{ success, data, error, meta }`.
- Pagination metadata stays compatible on list endpoints.
- Auth and permission requirements are unchanged or explicitly documented.
- Public visibility rules still block drafts, archived records, and private data.
- Generated-site contract docs are updated when CMS, media, shop, config, or auth behavior changes.
- `pnpm validate` passes and focused route/service tests cover the changed behavior.
- Existing route/contract tests either stay green or the change moves to `/api/v2`.

## Contract Tests

Keep contract tests close to the module route tests. The minimum base coverage is:

- Auth: login, refresh, logout, password reset, email verification, invites.
- Users/RBAC: list users, update user, role permissions, forbidden access.
- CMS: public visibility, pages, posts, menus, media, revisions, contact submissions.
- Shop: products, carts, orders, stock reservation, webhook idempotency.
- Config: modules, site settings, domains, audit logs, generation contract.

Any `/api/v1` change should either keep these tests green or intentionally introduce a `/api/v2` contract.
