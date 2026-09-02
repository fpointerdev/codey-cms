import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../src/config/index.js";
import { AppError } from "../src/core/errors/app-error.js";
import { acceptInviteSchema, listInvitesQuery } from "../src/modules/auth/auth.schemas.js";
import { AuthService } from "../src/modules/auth/auth.service.js";

type StoredInvite = {
  id: string;
  email: string;
  tokenHash: string;
  roleNames: string[];
  status: "PENDING" | "ACCEPTED" | "REVOKED";
  invitedById: string | null;
  acceptedById: string | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function createAuthHarness() {
  const roles = [{
    id: "role-editor",
    name: "client_editor",
    permissions: [{ permission: { action: "read", subject: "cms" } }]
  }];
  const invites: StoredInvite[] = [];
  const users: Array<Record<string, unknown>> = [];
  const audits: string[] = [];

  const userInvite = {
    findUnique: async ({ where }: { where: { id?: string; tokenHash?: string } }) =>
      invites.find((invite) => where.id ? invite.id === where.id : invite.tokenHash === where.tokenHash) || null,
    findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
      const invite = invites.find((item) => item.id === where.id);
      if (!invite) throw new Error("Invite not found");
      return invite;
    },
    create: async ({ data }: { data: Omit<StoredInvite, "id" | "status" | "acceptedById" | "acceptedAt" | "revokedAt" | "createdAt" | "updatedAt"> }) => {
      const now = new Date();
      const invite: StoredInvite = {
        ...data,
        id: `invite-${invites.length + 1}`,
        status: "PENDING",
        acceptedById: null,
        acceptedAt: null,
        revokedAt: null,
        createdAt: now,
        updatedAt: now
      };
      invites.push(invite);
      return invite;
    },
    updateMany: async ({ where, data }: {
      where: { id?: string; email?: string; tokenHash?: string; status?: string; revokedAt?: null; acceptedAt?: null };
      data: Partial<StoredInvite>;
    }) => {
      const matches = invites.filter((invite) =>
        (!where.id || invite.id === where.id) &&
        (!where.email || invite.email === where.email) &&
        (!where.tokenHash || invite.tokenHash === where.tokenHash) &&
        (!where.status || invite.status === where.status) &&
        (where.revokedAt !== null || invite.revokedAt === null) &&
        (where.acceptedAt !== null || invite.acceptedAt === null)
      );
      matches.forEach((invite) => Object.assign(invite, data, { updatedAt: new Date() }));
      return { count: matches.length };
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<StoredInvite> }) => {
      const invite = invites.find((item) => item.id === where.id);
      if (!invite) throw new Error("Invite not found");
      Object.assign(invite, data, { updatedAt: new Date() });
      return invite;
    }
  };
  const database = {
    site: {
      upsert: async () => ({ id: "site-default" })
    },
    moduleSetting: {
      findUnique: async () => null
    },
    user: {
      findUnique: async ({ where }: { where: { email?: string; id?: string } }) =>
        users.find((user) => where.email ? user.email === where.email : user.id === where.id) || null,
      create: async ({ data }: { data: Record<string, any> }) => {
        const assignedRoles = (data.roles?.create || []).map(({ roleId }: { roleId: string }) => ({
          role: roles.find((role) => role.id === roleId)!
        }));
        const user = {
          id: `user-${users.length + 1}`,
          email: data.email,
          name: data.name || null,
          passwordHash: data.passwordHash,
          authVersion: 1,
          status: "ACTIVE",
          roles: assignedRoles
        };
        users.push(user);
        return user;
      }
    },
    role: {
      findMany: async ({ where }: { where: { name: { in: string[] } } }) =>
        roles.filter((role) => where.name.in.includes(role.name))
    },
    userInvite,
    refreshToken: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "refresh-1", ...data })
    },
    auditLog: {
      create: async ({ data }: { data: { action: string } }) => {
        audits.push(data.action);
        return data;
      }
    }
  };
  const prisma = {
    ...database,
    $transaction: async (callback: (tx: typeof database) => Promise<unknown>) => callback(database)
  } as unknown as PrismaClient;
  const config = {
    isProduction: true,
    app: {
      name: "CodeY CMS",
      publicUrl: "https://cms.example.com"
    },
    auth: {
      accessTokenSecret: "test-access-secret-with-at-least-32-characters",
      accessTokenTtl: "15m",
      refreshTokenTtl: "30d",
      allowRegistration: false,
      requireEmailVerification: false,
      recoveryTokenDelivery: "disabled"
    },
    email: {
      driver: "disabled"
    }
  } as AppConfig;

  return {
    service: new AuthService(prisma, config),
    invites,
    users,
    audits
  };
}

test("manual invitations can be accepted end to end when email delivery is disabled", async () => {
  const harness = createAuthHarness();
  const invitation = await harness.service.createInvite({
    email: "New.Editor@Example.com",
    roleNames: ["client_editor"]
  }, {
    actorUserId: "owner-1",
    actorPermissions: [{ action: "manage", subject: "all" }]
  });

  assert.equal(invitation.delivery, "manual");
  assert.equal(invitation.token, undefined);
  assert.match(invitation.inviteUrl || "", /^https:\/\/cms\.example\.com\/auth\/invite\?token=/);
  assert.equal(invitation.invite.email, "new.editor@example.com");

  const token = new URL(invitation.inviteUrl).searchParams.get("token");
  assert.ok(token);
  const accepted = await harness.service.acceptInvite({
    token,
    name: "New Editor",
    password: "StrongPass123!"
  }, {});

  assert.equal(accepted.user.email, "new.editor@example.com");
  assert.deepEqual(accepted.user.roles, ["client_editor"]);
  assert.ok(accepted.tokens.accessToken);
  assert.equal(harness.invites[0]?.status, "ACCEPTED");
  assert.deepEqual(harness.audits, ["invite.create", "invite.accept"]);

  await assert.rejects(
    () => harness.service.acceptInvite({ token, password: "StrongPass123!" }, {}),
    (error) => error instanceof AppError && error.code === "invalid_invite_token"
  );
});

test("inviters cannot grant permissions they do not hold", async () => {
  const harness = createAuthHarness();

  await assert.rejects(
    () => harness.service.createInvite({
      email: "editor@example.com",
      roleNames: ["client_editor"]
    }, {
      actorUserId: "limited-user",
      actorPermissions: [{ action: "invite", subject: "users" }]
    }),
    (error) => error instanceof AppError && error.code === "role_assignment_forbidden"
  );
});

test("resending and revoking invitations invalidate previous links", async () => {
  const harness = createAuthHarness();
  const actor = {
    actorUserId: "owner-1",
    actorPermissions: [{ action: "manage", subject: "all" }]
  };
  const initial = await harness.service.createInvite({
    email: "resend@example.com",
    roleNames: ["client_editor"]
  }, actor);
  const initialToken = new URL(initial.inviteUrl!).searchParams.get("token");
  assert.ok(initialToken);

  const resent = await harness.service.resendInvite(initial.invite.id, actor);
  const resentToken = new URL(resent.inviteUrl!).searchParams.get("token");
  assert.ok(resentToken);
  assert.notEqual(resentToken, initialToken);
  await assert.rejects(
    () => harness.service.acceptInvite({ token: initialToken, password: "StrongPass123!" }, {}),
    (error) => error instanceof AppError && error.code === "invalid_invite_token"
  );

  const revoked = await harness.service.revokeInvite(initial.invite.id, actor);
  assert.equal(revoked.status, "REVOKED");
  await assert.rejects(
    () => harness.service.acceptInvite({ token: resentToken, password: "StrongPass123!" }, {}),
    (error) => error instanceof AppError && error.code === "invalid_invite_token"
  );
  assert.deepEqual(harness.audits, ["invite.create", "invite.resend", "invite.revoke"]);
});

test("inviters cannot revoke invitations with access above their own", async () => {
  const harness = createAuthHarness();
  const invitation = await harness.service.createInvite({
    email: "protected@example.com",
    roleNames: ["client_editor"]
  }, {
    actorUserId: "owner-1",
    actorPermissions: [{ action: "manage", subject: "all" }]
  });

  await assert.rejects(
    () => harness.service.revokeInvite(invitation.invite.id, {
      actorUserId: "limited-user",
      actorPermissions: [{ action: "invite", subject: "users" }]
    }),
    (error) => error instanceof AppError && error.code === "role_assignment_forbidden"
  );
  assert.equal(harness.invites[0]?.status, "PENDING");
});

test("invite schemas apply list defaults and enforce account password rules", () => {
  assert.deepEqual(listInvitesQuery.parse({}), { page: 1, limit: 20 });
  assert.equal(acceptInviteSchema.safeParse({ token: "a".repeat(48), password: "short" }).success, false);
  assert.equal(acceptInviteSchema.safeParse({
    token: "a".repeat(48),
    password: "StrongPass123!",
    name: "Editor"
  }).success, true);
});

test("frontend routes recognize invitation, verification, and user edit pages", async () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => null,
      removeItem: () => undefined,
      setItem: () => undefined
    }
  });
  const windowState = {
    location: {
      pathname: "/auth/invite",
      search: "?token=invite-token"
    }
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: windowState });
  const { adminHref, currentAdminRoute } = await import("../apps/web/web/routes.js");

  assert.deepEqual(currentAdminRoute(), { view: "invite-acceptance", token: "invite-token" });
  windowState.location.pathname = "/auth/verify-email";
  windowState.location.search = "?token=verify-token";
  assert.deepEqual(currentAdminRoute(), { view: "email-verification", token: "verify-token" });
  windowState.location.pathname = "/dashboard/users/user-123/edit";
  windowState.location.search = "";
  assert.deepEqual(currentAdminRoute(), { view: "user-edit", userId: "user-123" });
  assert.equal(adminHref("user-edit", "user-123"), "/dashboard/users/user-123/edit");
});

test("user administration views expose list, onboarding, edit, and delete controls", async () => {
  const nodes = new Map([
    ["[data-brand]", { textContent: "", href: "" }],
    ["[data-menu]", { innerHTML: "" }],
    ["[data-footer]", { innerHTML: "" }],
    ["[data-page]", { innerHTML: "" }],
    ["[data-status]", { textContent: "", classList: { toggle: () => undefined } }]
  ]);
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      title: "",
      body: { classList: { toggle: () => undefined } },
      querySelector: (selector: string) => nodes.get(selector) || null
    }
  });
  const { state } = await import("../apps/web/web/core.js");
  state.user = {
    id: "owner-1",
    email: "owner@example.com",
    permissions: [{ action: "manage", subject: "all" }]
  };
  state.config = null;
  const { renderProfilePage, renderUserEditPage, renderUsersPage } = await import("../apps/web/web/admin-views.js");
  const managedUser = {
    id: "user-2",
    email: "editor@example.com",
    name: "Editor",
    status: "ACTIVE",
    emailVerifiedAt: new Date().toISOString(),
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    roles: [{ role: { id: "role-editor", name: "client_editor", description: "Editor role" } }]
  };

  renderUsersPage([managedUser], {
    pagination: { page: 1, pages: 1, total: 1 },
    invites: [{
      id: "invite-1",
      email: "invited@example.com",
      roleNames: ["client_editor"],
      expiresAt: new Date().toISOString(),
      invitedBy: { email: "owner@example.com" }
    }],
    filters: {}
  });
  const page = nodes.get("[data-page]") as { innerHTML: string };
  assert.match(page.innerHTML, /data-user-filter-form/);
  assert.match(page.innerHTML, /\/dashboard\/users\/user-2\/edit/);
  assert.match(page.innerHTML, /data-resend-user-invite="invite-1"/);
  assert.match(page.innerHTML, /data-revoke-user-invite="invite-1"/);

  renderUserEditPage(managedUser, [{
    id: "role-editor",
    name: "client_editor",
    description: "Editor role"
  }]);
  assert.match(page.innerHTML, /data-user-edit-form/);
  assert.match(page.innerHTML, /name="roleIds"/);
  assert.match(page.innerHTML, /data-delete-user="user-2"/);

  renderProfilePage({
    id: "owner-1",
    email: "owner@example.com",
    name: "Owner",
    status: "ACTIVE",
    roles: ["owner"]
  });
  assert.match(page.innerHTML, /data-change-password-form/);
  assert.match(page.innerHTML, /data-revoke-all-sessions/);
  assert.match(page.innerHTML, /Signed-in devices/);
});

test("admin navigation hides user and settings pages from content editors", async () => {
  const { availableAdminNavItems, state } = await import("../apps/web/web/core.js");
  state.config = null;
  state.user = {
    id: "editor-1",
    email: "editor@example.com",
    permissions: [
      { action: "read", subject: "cms" },
      { action: "update", subject: "cms" }
    ]
  };

  assert.deepEqual(
    availableAdminNavItems().map((item) => item.view),
    ["dashboard", "pages", "posts", "collections", "profile"]
  );

  state.user.permissions = [{ action: "read", subject: "products" }];
  assert.equal(availableAdminNavItems().some((item) => item.view === "shop"), true);

  state.user.permissions = [{ action: "manage", subject: "all" }];
  assert.equal(availableAdminNavItems().some((item) => item.view === "users"), true);
  assert.equal(availableAdminNavItems().some((item) => item.view === "settings"), true);
});

test("settings show whether backups are protected off-site", async () => {
  const nodes = new Map([
    ["[data-brand]", { textContent: "", href: "" }],
    ["[data-menu]", { innerHTML: "" }],
    ["[data-footer]", { innerHTML: "" }],
    ["[data-page]", { innerHTML: "" }],
    ["[data-status]", { textContent: "", classList: { toggle: () => undefined } }]
  ]);
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      title: "",
      body: { classList: { toggle: () => undefined } },
      querySelector: (selector: string) => nodes.get(selector) || null
    }
  });
  const { state } = await import("../apps/web/web/core.js");
  const { renderSettingsPage } = await import("../apps/web/web/admin-views.js");
  state.user = {
    id: "owner-1",
    email: "owner@example.com",
    permissions: [{ action: "manage", subject: "all" }]
  };

  renderSettingsPage({
    app: { name: "CodeY CMS" },
    siteSettings: {
      title: "Example Studio",
      logoUrl: "/uploads/logo.webp",
      logoMode: "image-and-name",
      logoAltText: "Example Studio logo",
      logoHeight: 48,
      faviconUrl: "/uploads/favicon.png",
      socialImageUrl: "/uploads/social.webp",
      socialImageAlt: "Example Studio preview"
    },
    storage: {
      source: "dashboard",
      provider: "r2",
      configured: true,
      accountId: "0123456789abcdef0123456789abcdef",
      bucket: "example-media",
      accessKeyId: "r2-access-key",
      secretAccessKeyConfigured: true,
      keyPrefix: "sites/example",
      lastTestedAt: "2026-08-12T07:00:00.000Z"
    },
    operationsDiagnostics: {
      status: "attention",
      operations: {
        backup: {
          status: "fail",
          message: "Off-site backup protection has not been confirmed.",
          details: { offsiteProtected: false }
        }
      }
    }
  });
  const page = nodes.get("[data-page]") as { innerHTML: string };
  assert.match(page.innerHTML, /Backups need off-site protection/);
  assert.match(page.innerHTML, /Local only/);
  assert.match(page.innerHTML, /BACKUP_OFFSITE_PROTECTED=true/);
  assert.match(page.innerHTML, /Website identity/);
  assert.match(page.innerHTML, /name="logoFile"/);
  assert.match(page.innerHTML, /name="faviconFile"/);
  assert.match(page.innerHTML, /name="socialImageFile"/);
  assert.match(page.innerHTML, /src="\/uploads\/logo\.webp"/);
  assert.match(page.innerHTML, /data-clear-site-media/);
  assert.doesNotMatch(page.innerHTML, /name="(?:logo|favicon|socialImage)Url"/);
  assert.match(page.innerHTML, /settings-tab-storage/);
  assert.match(page.innerHTML, /Cloudflare R2/);
  assert.match(page.innerHTML, /name="r2AccountId" value="0123456789abcdef0123456789abcdef"/);
  assert.match(page.innerHTML, /name="r2SecretAccessKey"[^>]*value=""[^>]*placeholder="Saved credential"/);
  assert.doesNotMatch(page.innerHTML, /name="(?:localDir|storageKeyPrefix)"/);
});

test("read-only dashboard views hide mutation controls", async () => {
  const nodes = new Map([
    ["[data-brand]", { textContent: "", href: "" }],
    ["[data-menu]", { innerHTML: "" }],
    ["[data-footer]", { innerHTML: "" }],
    ["[data-page]", { innerHTML: "" }],
    ["[data-status]", { textContent: "", classList: { toggle: () => undefined } }]
  ]);
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      title: "",
      body: { classList: { toggle: () => undefined } },
      querySelector: (selector: string) => nodes.get(selector) || null
    }
  });
  const { state } = await import("../apps/web/web/core.js");
  const {
    renderPagesPage,
    renderPostsPage,
    renderShopConfigurationPage,
    renderShopOrdersPage
  } = await import("../apps/web/web/admin-views.js");
  const page = nodes.get("[data-page]") as { innerHTML: string };

  state.config = null;
  state.user = {
    id: "reader-1",
    email: "reader@example.com",
    permissions: [{ action: "read", subject: "cms" }]
  };
  renderPagesPage([{
    title: "About",
    slug: "about",
    locale: "en",
    status: "PUBLISHED",
    updatedAt: new Date().toISOString()
  }]);
  assert.doesNotMatch(page.innerHTML, /Edit visually|Edit structure/);
  assert.doesNotMatch(page.innerHTML, /\/dashboard\/pages\/about\/builder/);

  renderPostsPage([]);
  assert.doesNotMatch(page.innerHTML, />New Post</);

  state.user.permissions = [{ action: "read", subject: "orders" }];
  renderShopOrdersPage([]);
  assert.match(page.innerHTML, /\/dashboard\/shop\/orders/);
  assert.doesNotMatch(page.innerHTML, /\/dashboard\/shop\/products/);

  state.user.permissions = [
    { action: "read", subject: "modules" },
    { action: "read", subject: "payments" }
  ];
  renderShopConfigurationPage({ modules: {} }, {}, {
    providers: [
      { provider: "STRIPE", mode: "SANDBOX", publishableKey: "pk_test", secretKeyConfigured: true },
      { provider: "PAYPAL", mode: "SANDBOX", clientId: "client-id", clientSecretConfigured: true },
      { provider: "MANUAL", mode: "SANDBOX", instructions: "Pay by invoice" }
    ],
    webhookUrls: {}
  });
  assert.match(page.innerHTML, /name="publishableKey"[^>]*disabled/);
  assert.match(page.innerHTML, /name="instructions"[^>]*disabled/);
  assert.doesNotMatch(page.innerHTML, /Save Stripe|Save PayPal|Save manual payment/);

  state.user.permissions.push({ action: "update", subject: "payments" });
  renderShopConfigurationPage({ modules: {} }, {}, {
    providers: [
      { provider: "STRIPE", mode: "SANDBOX", publishableKey: "pk_test", secretKeyConfigured: true },
      { provider: "MANUAL", mode: "SANDBOX", instructions: "Pay by invoice" }
    ],
    webhookUrls: {}
  });
  assert.match(page.innerHTML, /name="publishableKey"[^>]*disabled/);
  assert.doesNotMatch(page.innerHTML, /Save Stripe/);
  assert.match(page.innerHTML, /Save manual payment/);

  state.user.permissions.push({ action: "manage", subject: "secrets" });
  renderShopConfigurationPage({ modules: {} }, {}, {
    providers: [{ provider: "STRIPE", mode: "SANDBOX", publishableKey: "pk_test", secretKeyConfigured: true }],
    webhookUrls: {}
  });
  assert.match(page.innerHTML, /Save Stripe/);

  state.user.permissions.push({ action: "read", subject: "orders" });
  renderShopConfigurationPage({ modules: {} }, {}, {}, "", {
    shippingZones: [{ id: "zone-1", name: "Europe", countries: ["DE", "FR"], rates: [] }],
    taxRules: [{ id: "tax-1", name: "VAT", country: "DE", rateBps: 1900 }],
    coupons: [{ id: "coupon-1", code: "WELCOME10", discountType: "PERCENTAGE", amount: 10, usageCount: 0 }]
  });
  assert.match(page.innerHTML, /Commerce rules|Europe|VAT|WELCOME10/);
  assert.doesNotMatch(page.innerHTML, /data-commerce-rule-form|data-delete-commerce-rule/);

  state.user.permissions.push({ action: "update", subject: "orders" });
  renderShopConfigurationPage({ modules: {} }, {}, {}, "", {
    shippingZones: [{ id: "zone-1", name: "Europe", countries: ["DE", "FR"], rates: [] }]
  });
  assert.match(page.innerHTML, /data-commerce-rule-form="shipping"/);
  assert.match(page.innerHTML, /data-delete-commerce-rule="shipping"/);
});

test("admin routes declare permissions for direct navigation", async () => {
  const { adminRoutePermissions } = await import("../apps/web/web/controller.js");

  assert.deepEqual(adminRoutePermissions({ view: "shop" }), [
    ["read", "products"],
    ["read", "orders"]
  ]);
  assert.deepEqual(adminRoutePermissions({ view: "product-editor" }), [["update", "products"]]);
  assert.deepEqual(adminRoutePermissions({ view: "shop-configuration" }), [
    ["read", "products"],
    ["read", "payments"],
    ["read", "modules"]
  ]);
  assert.deepEqual(adminRoutePermissions({ view: "page-builder" }), [["update", "cms"]]);
  assert.deepEqual(adminRoutePermissions({ view: "users" }), [["read", "users"]]);
  assert.deepEqual(adminRoutePermissions({ view: "settings" }), [["manage", "modules"]]);
});
