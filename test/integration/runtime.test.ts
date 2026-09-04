import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { config } from "../../src/config/index.js";
import { createApp } from "../../src/core/app.js";
import { AppError } from "../../src/core/errors/app-error.js";
import { prisma } from "../../src/infrastructure/database/prisma.js";
import { EmailSettingsService } from "../../src/infrastructure/email/email-settings.service.js";
import { logger } from "../../src/infrastructure/logging/logger.js";
import { createTotpCode } from "../../src/modules/auth/mfa.js";
import { CommerceAbuseService } from "../../src/modules/orders/commerce-abuse.service.js";
import { deliverQueuedOrderEmails } from "../../src/modules/orders/order-email.service.js";
import { hashOrderLookupToken } from "../../src/modules/orders/order-lookup.js";
import {
  paymentProviderConfigRevision,
  PaymentProviderConfigService
} from "../../src/modules/payments/payment-provider-config.service.js";
import { runtimeVersion } from "../../src/runtime/release.js";

type ApiEnvelope = {
  success: boolean;
  data?: Record<string, any>;
  error?: { code?: string; message?: string };
};

async function responseJson(response: Response) {
  return await response.json() as ApiEnvelope;
}

function cookieFrom(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const value = headers.getSetCookie?.()[0] ?? headers.get("set-cookie");
  assert.ok(value, "Expected a refresh-token cookie.");
  return value.split(";", 1)[0];
}

test("runtime API, media policy, SSR routing, and redirects work together", { timeout: 60_000 }, async () => {
  const app = await createApp();
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const pageSlug = `integration-page-${runId}`;
  const redirectPath = `/integration-old-${runId}`;
  const managedUserEmail = `integration-member-${runId}@example.com`;
  const adminEmail = process.env.INTEGRATION_ADMIN_EMAIL || "integration-owner@example.com";
  const adminPassword = process.env.INTEGRATION_ADMIN_PASSWORD || "IntegrationOwner123!";
  let uploadedAssetId: string | undefined;
  let managedUserId: string | undefined;
  let reusableTemplateId: string | undefined;
  let commerceOrderId: string | undefined;
  let commerceCartId: string | undefined;
  const defaultSite = await prisma.site.findUniqueOrThrow({
    where: { slug: "default" },
    select: { id: true }
  });
  const existingSiteSetting = await prisma.moduleSetting.findFirst({
    where: { moduleId: "config", key: "site", site: { slug: "default" } },
    select: { id: true, value: true }
  });
  const existingEmailSetting = await prisma.moduleSetting.findFirst({
    where: { moduleId: "config", key: "email", site: { slug: "default" } },
    select: { id: true, value: true }
  });
  const existingManualProvider = await prisma.paymentProviderConfig.findUnique({
    where: {
      siteId_provider: {
        siteId: defaultSite.id,
        provider: "MANUAL"
      }
    }
  });

  async function request(pathname: string, options: RequestInit = {}) {
    const headers = new Headers(options.headers);
    if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    return fetch(`${baseUrl}${pathname}`, { ...options, headers });
  }

  try {
    const readiness = await request("/api/v1/health/ready");
    const readinessBody = await responseJson(readiness);
    assert.equal(readiness.status, 200);
    assert.equal(readinessBody.data?.status, "ready");
    assert.deepEqual(Object.keys(readinessBody.data || {}), ["status"]);

    const publicDiagnostics = await request("/api/v1/health/diagnostics");
    assert.equal(publicDiagnostics.status, 401);
    const publicMetrics = await request("/api/v1/health/metrics");
    assert.equal(publicMetrics.status, 401);

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const failedLogin = await request("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: adminEmail, password: "IncorrectPassword123!" })
      });
      assert.equal(failedLogin.status, 401);
    }
    const delayedLogin = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: adminEmail, password: adminPassword })
    });
    const delayedLoginBody = await responseJson(delayedLogin);
    assert.equal(delayedLogin.status, 429);
    assert.equal(delayedLoginBody.error?.code, "login_temporarily_delayed");
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    const login = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: adminEmail, password: adminPassword })
    });
    const loginBody = await responseJson(login);
    assert.equal(login.status, 200);
    assert.equal(typeof loginBody.data?.tokens.accessToken, "string");
    assert.equal("refreshToken" in loginBody.data?.tokens, false);
    const loginCookie = cookieFrom(login);

    const refresh = await request("/api/v1/auth/refresh", {
      method: "POST",
      headers: { cookie: loginCookie },
      body: "{}"
    });
    const refreshBody = await responseJson(refresh);
    assert.equal(refresh.status, 200);
    assert.equal(typeof refreshBody.data?.tokens.accessToken, "string");
    assert.equal("refreshToken" in refreshBody.data?.tokens, false);
    const refreshCookie = cookieFrom(refresh);
    const accessToken = String(refreshBody.data?.tokens.accessToken);
    const authorization = { authorization: `Bearer ${accessToken}` };

    const secondaryLogin = await request("/api/v1/auth/login", {
      method: "POST",
      headers: { "user-agent": "CodeY integration secondary device" },
      body: JSON.stringify({ email: adminEmail, password: adminPassword })
    });
    const secondaryLoginBody = await responseJson(secondaryLogin);
    assert.equal(secondaryLogin.status, 200, JSON.stringify(secondaryLoginBody));
    const secondaryLoginCookie = cookieFrom(secondaryLogin);

    const sessionInventory = await request("/api/v1/auth/sessions", {
      headers: { ...authorization, cookie: refreshCookie }
    });
    const sessionInventoryBody = await responseJson(sessionInventory);
    const activeSessions = sessionInventoryBody.data?.sessions as Array<Record<string, unknown>>;
    assert.equal(sessionInventory.status, 200, JSON.stringify(sessionInventoryBody));
    assert.equal(activeSessions.filter((session) => session.current).length, 1);
    assert.equal(activeSessions.some((session) => "tokenHash" in session), false);
    const secondarySession = activeSessions.find((session) => (
      session.userAgent === "CodeY integration secondary device"
    ));
    assert.equal(typeof secondarySession?.id, "string");

    const revokeSecondarySession = await request(
      `/api/v1/auth/sessions/${encodeURIComponent(String(secondarySession?.id))}`,
      {
        method: "DELETE",
        headers: { ...authorization, cookie: refreshCookie }
      }
    );
    const revokeSecondarySessionBody = await responseJson(revokeSecondarySession);
    assert.equal(revokeSecondarySession.status, 200, JSON.stringify(revokeSecondarySessionBody));
    assert.equal(revokeSecondarySessionBody.data?.current, false);

    const revokedSecondaryRefresh = await request("/api/v1/auth/refresh", {
      method: "POST",
      headers: { cookie: secondaryLoginCookie },
      body: "{}"
    });
    assert.equal(revokedSecondaryRefresh.status, 401);

    const generation = await request("/api/v1/config/generation/contract", { headers: authorization });
    const generationBody = await responseJson(generation);
    const generationWorkflow = generationBody.data?.automation.workflow as Array<Record<string, unknown>>;
    assert.equal(generation.status, 200, JSON.stringify(generationBody));
    assert.equal(generationBody.data?.name, "codey-cms.website-generation");
    assert.equal(generationBody.data?.automation.version, "1.0");
    assert.equal(generationBody.data?.websiteSpec.example.version, "1.0");
    assert.equal(
      generationWorkflow.find((operation) => operation.id === "apply")?.atomic,
      true
    );

    const diagnostics = await request("/api/v1/health/diagnostics", { headers: authorization });
    const diagnosticsBody = await responseJson(diagnostics);
    assert.equal(diagnostics.status, 200, JSON.stringify(diagnosticsBody));
    assert.equal(diagnosticsBody.data?.runtime.status, "ready");
    assert.equal(diagnosticsBody.data?.runtime.checks.database.status, "pass");
    assert.equal(diagnosticsBody.data?.operations.backup.blocking, false);
    assert.equal(diagnosticsBody.data?.operations.inventory.status, "pass");
    assert.equal(typeof diagnosticsBody.data?.metrics.uptimeSeconds, "number");

    const metrics = await request("/api/v1/health/metrics", { headers: authorization });
    assert.equal(metrics.status, 200, JSON.stringify(await responseJson(metrics)));

    const replayedRefresh = await request("/api/v1/auth/refresh", {
      method: "POST",
      headers: { cookie: loginCookie },
      body: "{}"
    });
    assert.equal(replayedRefresh.status, 401, JSON.stringify(await responseJson(replayedRefresh)));
    const revokedFamilyRefresh = await request("/api/v1/auth/refresh", {
      method: "POST",
      headers: { cookie: refreshCookie },
      body: "{}"
    });
    assert.equal(revokedFamilyRefresh.status, 401, JSON.stringify(await responseJson(revokedFamilyRefresh)));

    const me = await request("/api/v1/auth/me", { headers: authorization });
    const meBody = await responseJson(me);
    assert.equal(me.status, 200);
    assert.equal(meBody.data?.user.email, adminEmail);

    const replayAudit = await request(
      "/api/v1/config/audit-logs?action=refresh_token.replay_detected",
      { headers: authorization }
    );
    const replayAuditBody = await responseJson(replayAudit);
    assert.equal(replayAudit.status, 200, JSON.stringify(replayAuditBody));
    assert.equal(replayAuditBody.data?.auditLogs[0]?.outcome, "DENIED");
    assert.equal(replayAuditBody.data?.auditLogs[0]?.integrity, "valid");

    const emailCredential = `integration-email-secret-${runId}`;
    const emailUpdate = await request("/api/v1/config/email", {
      method: "PATCH",
      headers: authorization,
      body: JSON.stringify({
        enabled: false,
        provider: "generic",
        recoveryEnabled: false,
        from: "notifications@example.com",
        httpEndpoint: "https://mailer.example.com/send",
        bearerToken: emailCredential
      })
    });
    const emailUpdateBody = await responseJson(emailUpdate);
    assert.equal(emailUpdate.status, 200, JSON.stringify(emailUpdateBody));
    assert.equal(emailUpdateBody.data?.email.bearerTokenConfigured, true);
    assert.doesNotMatch(JSON.stringify(emailUpdateBody), new RegExp(emailCredential));

    const emailAudit = await request(
      "/api/v1/config/audit-logs?action=email.settings.update",
      { headers: authorization }
    );
    const emailAuditBody = await responseJson(emailAudit);
    assert.equal(emailAudit.status, 200, JSON.stringify(emailAuditBody));
    assert.equal(emailAuditBody.data?.auditLogs[0]?.action, "email.settings.update");
    assert.equal(emailAuditBody.data?.auditLogs[0]?.metadata?.endpointHostname, "mailer.example.com");
    assert.equal("httpEndpoint" in emailAuditBody.data?.auditLogs[0]?.metadata, false);
    assert.doesNotMatch(JSON.stringify(emailAuditBody), new RegExp(emailCredential));

    const invite = await request("/api/v1/auth/invites", {
      method: "POST",
      headers: authorization,
      body: JSON.stringify({ email: managedUserEmail, roleNames: ["user"] })
    });
    const inviteBody = await responseJson(invite);
    assert.equal(invite.status, 201);
    const inviteToken = new URL(String(inviteBody.data?.inviteUrl), baseUrl).searchParams.get("token");
    assert.ok(inviteToken);

    const acceptInvite = await request("/api/v1/auth/invites/accept", {
      method: "POST",
      body: JSON.stringify({
        token: inviteToken,
        password: "IntegrationMember123!",
        name: "Integration Member"
      })
    });
    const acceptedBody = await responseJson(acceptInvite);
    assert.equal(acceptInvite.status, 201);
    managedUserId = acceptedBody.data?.user.id;
    assert.equal(typeof managedUserId, "string");
    const managedAccessToken = String(acceptedBody.data?.tokens.accessToken);

    const limitedDiagnostics = await request("/api/v1/health/diagnostics", {
      headers: { authorization: `Bearer ${managedAccessToken}` }
    });
    assert.equal(limitedDiagnostics.status, 403);

    const users = await request(`/api/v1/users?search=${encodeURIComponent(managedUserEmail)}`, {
      headers: authorization
    });
    const usersBody = await responseJson(users);
    assert.equal(users.status, 200);
    assert.equal(usersBody.data?.users.length, 1);
    assert.equal(usersBody.data?.users[0].id, managedUserId);

    const userDetail = await request(`/api/v1/users/${managedUserId}`, { headers: authorization });
    const userDetailBody = await responseJson(userDetail);
    assert.equal(userDetail.status, 200);
    assert.equal(userDetailBody.data?.user.email, managedUserEmail);

    const updateUser = await request(`/api/v1/users/${managedUserId}`, {
      method: "PATCH",
      headers: authorization,
      body: JSON.stringify({ name: "Updated Integration Member", status: "SUSPENDED" })
    });
    const updateUserBody = await responseJson(updateUser);
    assert.equal(updateUser.status, 200);
    assert.equal(updateUserBody.data?.user.name, "Updated Integration Member");
    assert.equal(updateUserBody.data?.user.status, "SUSPENDED");

    const suspendedSession = await request("/api/v1/auth/me", {
      headers: { authorization: `Bearer ${managedAccessToken}` }
    });
    assert.equal(suspendedSession.status, 401);

    const deleteUser = await request(`/api/v1/users/${managedUserId}`, {
      method: "DELETE",
      headers: authorization,
      body: "{}"
    });
    assert.equal(deleteUser.status, 200, JSON.stringify(await responseJson(deleteUser)));
    managedUserId = undefined;

    const deletedUser = await request(`/api/v1/users/${acceptedBody.data?.user.id}`, {
      headers: authorization
    });
    assert.equal(deletedUser.status, 404);

    const unsafeUpload = await request("/api/v1/cms/media/upload", {
      method: "POST",
      headers: authorization,
      body: JSON.stringify({
        filename: "payload.png",
        mimeType: "image/png",
        kind: "IMAGE",
        dataBase64: Buffer.from("<script>alert(1)</script>").toString("base64")
      })
    });
    const unsafeUploadBody = await responseJson(unsafeUpload);
    assert.equal(unsafeUpload.status, 422);
    assert.equal(unsafeUploadBody.error?.code, "media_signature_mismatch");

    const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const upload = await request("/api/v1/cms/media/upload", {
      method: "POST",
      headers: authorization,
      body: JSON.stringify({
        filename: `pixel-${runId}.png`,
        mimeType: "image/png",
        kind: "IMAGE",
        altText: "Integration pixel",
        dataBase64: pngBase64
      })
    });
    const uploadBody = await responseJson(upload);
    assert.equal(upload.status, 201);
    uploadedAssetId = uploadBody.data?.asset.id;
    assert.equal(typeof uploadedAssetId, "string");

    const publicMedia = await request(String(uploadBody.data?.asset.url));
    assert.equal(publicMedia.status, 200);
    assert.match(publicMedia.headers.get("content-type") ?? "", /^image\/png/);
    assert.equal(publicMedia.headers.get("x-content-type-options"), "nosniff");
    assert.match(publicMedia.headers.get("content-security-policy") ?? "", /sandbox/);

    const deleteMedia = await request(`/api/v1/cms/media/${uploadedAssetId}`, {
      method: "DELETE",
      headers: authorization,
      body: "{}"
    });
    assert.equal(deleteMedia.status, 200, JSON.stringify(await responseJson(deleteMedia)));
    uploadedAssetId = undefined;

    const deletedMedia = await request(String(uploadBody.data?.asset.url));
    assert.equal(deletedMedia.status, 404);

    const createPage = await request("/api/v1/cms/pages", {
      method: "POST",
      headers: authorization,
      body: JSON.stringify({
        title: "Integration published page",
        slug: pageSlug,
        excerpt: "Rendered on the server for resilient public delivery.",
        content: {},
        status: "PUBLISHED",
        sections: [{
          key: "content",
          label: "Content",
          blocks: [{
            key: "body",
            type: "RICH_TEXT",
            label: "Body",
            value: "<p>Server-rendered integration content.</p><script>window.compromised=true</script>"
          }]
        }]
      })
    });
    assert.equal(createPage.status, 201, JSON.stringify(await responseJson(createPage)));

    const createdPage = await request(`/api/v1/cms/pages/${pageSlug}`, { headers: authorization });
    const createdPageBody = await responseJson(createdPage);
    assert.equal(createdPage.status, 200, JSON.stringify(createdPageBody));
    assert.equal(createdPageBody.data?.page.title, "Integration published page");
    assert.equal(createdPageBody.data?.page.sections?.[0]?.blocks?.[0]?.key, "body");

    const createTemplate = await request("/api/v1/cms/templates", {
      method: "POST",
      headers: authorization,
      body: JSON.stringify({
        name: `Integration hero ${runId}`,
        description: "Shared by integration coverage.",
        type: "SECTION",
        content: {
          section: {
            key: "integration-reusable-hero",
            label: "Reusable hero",
            blocks: [{
              key: "integration-reusable-heading",
              type: "RICH_TEXT",
              value: "<h2>Reusable integration heading</h2>"
            }]
          }
        }
      })
    });
    const createTemplateBody = await responseJson(createTemplate);
    assert.equal(createTemplate.status, 201, JSON.stringify(createTemplateBody));
    reusableTemplateId = createTemplateBody.data?.template.id;
    assert.equal(typeof reusableTemplateId, "string");

    const unauthorizedTemplates = await request("/api/v1/cms/templates");
    assert.equal(unauthorizedTemplates.status, 401, JSON.stringify(await responseJson(unauthorizedTemplates)));

    const updateTemplate = await request(`/api/v1/cms/templates/${reusableTemplateId}`, {
      method: "PATCH",
      headers: authorization,
      body: JSON.stringify({ description: "Updated reusable section." })
    });
    const updateTemplateBody = await responseJson(updateTemplate);
    assert.equal(updateTemplate.status, 200, JSON.stringify(updateTemplateBody));
    assert.equal(updateTemplateBody.data?.template.description, "Updated reusable section.");

    const templates = await request("/api/v1/cms/templates?type=SECTION", { headers: authorization });
    const templatesBody = await responseJson(templates);
    assert.equal(templates.status, 200);
    assert.ok(templatesBody.data?.templates.some((template: { id: string }) => template.id === reusableTemplateId));

    const configResponse = await request("/api/v1/config");
    const configBody = await responseJson(configResponse);
    assert.equal(configResponse.status, 200, JSON.stringify(configBody));
    assert.deepEqual(Object.keys(configBody.data ?? {}), [
      "app",
      "features",
      "localization",
      "siteSettings",
      "storage"
    ]);
    assert.equal(configBody.data?.env, undefined);
    assert.equal(configBody.data?.api, undefined);
    assert.equal(configBody.data?.modules, undefined);
    assert.equal(configBody.data?.installedModules, undefined);
    assert.equal(configBody.data?.storage?.driver, undefined);
    assert.equal(configBody.data?.storage?.bucket, undefined);
    assert.equal(configBody.data?.storage?.keyPrefix, undefined);
    const currentSiteSettings = configBody.data?.siteSettings;
    const unauthorizedAdminConfig = await request("/api/v1/config/admin");
    assert.equal(unauthorizedAdminConfig.status, 401);
    const adminConfig = await request("/api/v1/config/admin", { headers: authorization });
    const adminConfigBody = await responseJson(adminConfig);
    assert.equal(adminConfig.status, 200, JSON.stringify(adminConfigBody));
    assert.equal(adminConfigBody.data?.env, config.env);
    assert.ok(adminConfigBody.data?.modules?.cms);
    assert.ok(Array.isArray(adminConfigBody.data?.installedModules));
    const compatibility = await request("/api/v1/config/compatibility", { headers: authorization });
    const compatibilityBody = await responseJson(compatibility);
    assert.equal(compatibility.status, 200, JSON.stringify(compatibilityBody));
    assert.equal(compatibilityBody.data?.baseVersion, runtimeVersion);
    const updateSiteDesign = await request("/api/v1/config/site-settings", {
      method: "PATCH",
      headers: authorization,
      body: JSON.stringify({
        ...currentSiteSettings,
        design: {
          ...currentSiteSettings.design,
          preset: "custom",
          colors: {
            ...currentSiteSettings.design.colors,
            primary: "#c0264f"
          }
        }
      })
    });
    assert.equal(updateSiteDesign.status, 200, JSON.stringify(await responseJson(updateSiteDesign)));

    const publicPage = await request(`/${pageSlug}`);
    const publicHtml = await publicPage.text();
    assert.equal(publicPage.status, 200);
    assert.match(publicHtml, /Server-rendered integration content/);
    assert.doesNotMatch(publicHtml, /window\.compromised|<script>window\.compromised/);
    assert.match(publicHtml, /data-site-design-system/);
    assert.match(publicHtml, /--accent: #c0264f/);

    const deleteTemplate = await request(`/api/v1/cms/templates/${reusableTemplateId}`, {
      method: "DELETE",
      headers: authorization,
      body: "{}"
    });
    assert.equal(deleteTemplate.status, 200, JSON.stringify(await responseJson(deleteTemplate)));
    reusableTemplateId = undefined;

    const updateShopSettings = await request("/api/v1/products/settings", {
      method: "PATCH",
      headers: authorization,
      body: JSON.stringify({
        catalogTitle: "Integration Catalog",
        catalogDescription: "Server-rendered storefront settings.",
        catalogLayout: "editorial",
        cardStyle: "technical",
        detailLayout: "immersive",
        detailStyle: "premium",
        productsPerPage: 16,
        showCategories: true,
        showAttributes: true,
        showSku: false,
        showStock: true
      })
    });
    const updateShopSettingsBody = await responseJson(updateShopSettings);
    assert.equal(updateShopSettings.status, 200, JSON.stringify(updateShopSettingsBody));
    assert.equal(updateShopSettingsBody.data?.settings.catalogTitle, "Integration Catalog");

    const publicShopSettings = await request("/api/v1/products/settings");
    const publicShopSettingsBody = await responseJson(publicShopSettings);
    assert.equal(publicShopSettings.status, 200);
    assert.equal(publicShopSettingsBody.data?.settings.cardStyle, "technical");

    const shop = await request("/shop");
    const shopHtml = await shop.text();
    assert.equal(shop.status, 200);
    assert.match(shopHtml, /Starter Product/);
    assert.match(shopHtml, /Integration Catalog/);
    assert.match(shopHtml, /shop-layout-editorial shop-card-technical/);
    assert.match(shopHtml, /data-server-rendered="true"/);

    const buyerAccount = await request("/account/orders");
    const buyerAccountHtml = await buyerAccount.text();
    assert.equal(buyerAccount.status, 200);
    assert.match(buyerAccountHtml, /data-commerce-account-root/);
    assert.match(buyerAccountHtml, /Purchases on this device/);
    assert.match(buyerAccountHtml, /name="robots" content="noindex, nofollow"/);

    const product = await request("/product/starter-product");
    const productHtml = await product.text();
    assert.equal(product.status, 200);
    assert.match(productHtml, /Starter Product/);
    assert.match(productHtml, /Starter product image/);
    assert.match(productHtml, /shop-detail-layout-immersive shop-detail-style-premium/);
    assert.match(productHtml, /name="variantId"/);

    const starterProduct = await prisma.product.findUniqueOrThrow({
      where: { locale_slug: { locale: "en", slug: "starter-product" } },
      include: { variants: { where: { active: true }, take: 1 } }
    });
    const shippingRate = await prisma.shippingRate.findFirstOrThrow({
      where: { active: true, zone: { active: true } },
      orderBy: { priceCents: "asc" }
    });
    const createCart = await request("/api/v1/orders/carts", {
      method: "POST",
      body: "{}"
    });
    const createCartBody = await responseJson(createCart);
    const cartToken = String(createCartBody.data?.cart.sessionToken);
    commerceCartId = String(createCartBody.data?.cart.id);
    assert.equal(createCart.status, 201, JSON.stringify(createCartBody));
    const addCartItem = await request(`/api/v1/orders/carts/${cartToken}/items`, {
      method: "POST",
      body: JSON.stringify({
        productId: starterProduct.id,
        variantId: starterProduct.variants[0]?.id,
        quantity: 1
      })
    });
    assert.equal(addCartItem.status, 200, JSON.stringify(await responseJson(addCartItem)));

    const checkoutBody = JSON.stringify({
      customerEmail: `commerce-${runId}@example.com`,
      customerName: "Commerce Integration",
      shippingCountry: "US",
      shippingAddress: {
        line1: "1 Integration Way",
        city: "New York",
        region: "NY",
        postalCode: "10001"
      },
      shippingRateId: shippingRate.id
    });
    const checkoutResponses = await Promise.all([
      request(`/api/v1/orders/carts/${cartToken}/checkout`, { method: "POST", body: checkoutBody }),
      request(`/api/v1/orders/carts/${cartToken}/checkout`, { method: "POST", body: checkoutBody })
    ]);
    assert.deepEqual(
      checkoutResponses.map((response) => response.status).sort((left, right) => left - right),
      [201, 404]
    );
    const completedCheckout = checkoutResponses.find((response) => response.status === 201)!;
    const completedCheckoutBody = await responseJson(completedCheckout);
    assert.equal(completedCheckoutBody.data?.order.items.length, 1);
    assert.equal(completedCheckoutBody.data?.order.shippingCents, shippingRate.priceCents);
    const orderId = String(completedCheckoutBody.data?.order.id);
    const orderNumber = String(completedCheckoutBody.data?.order.orderNumber);
    const lookupToken = String(completedCheckoutBody.data?.order.lookupToken);
    const buyerCookie = cookieFrom(completedCheckout);
    commerceOrderId = orderId;
    assert.match(lookupToken, /^[A-Za-z0-9_-]{43}$/);
    const storedLookup = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { notifications: true }
    });
    assert.equal(storedLookup.lookupTokenHash, hashOrderLookupToken(lookupToken));
    assert.equal(JSON.stringify(storedLookup).includes(lookupToken), false);

    const emptyBuyerOrders = await request("/api/v1/orders/buyer/orders");
    const emptyBuyerOrdersBody = await responseJson(emptyBuyerOrders);
    assert.equal(emptyBuyerOrders.status, 200);
    assert.deepEqual(emptyBuyerOrdersBody.data?.orders, []);

    const buyerOrders = await request("/api/v1/orders/buyer/orders", {
      headers: { cookie: buyerCookie }
    });
    const buyerOrdersBody = await responseJson(buyerOrders);
    assert.equal(buyerOrders.status, 200, JSON.stringify(buyerOrdersBody));
    assert.equal(buyerOrdersBody.data?.orders.length, 1);
    assert.equal(buyerOrdersBody.data?.orders[0].orderNumber, orderNumber);
    assert.equal(JSON.stringify(buyerOrdersBody).includes("customerEmail"), false);

    const isolatedSupportCase = await request(`/api/v1/orders/buyer/orders/${orderNumber}/cases`, {
      method: "POST",
      headers: { cookie: `codey_buyer_session=${"x".repeat(43)}` },
      body: JSON.stringify({
        type: "COMPLAINT",
        subject: "Must stay private",
        message: "A different browser must not access this order."
      })
    });
    assert.equal(isolatedSupportCase.status, 404);

    const createSupportCase = await request(`/api/v1/orders/buyer/orders/${orderNumber}/cases`, {
      method: "POST",
      headers: { cookie: buyerCookie },
      body: JSON.stringify({
        type: "COMPLAINT",
        subject: "Delivery preference",
        message: "Please leave the parcel with the building reception."
      })
    });
    const createSupportCaseBody = await responseJson(createSupportCase);
    assert.equal(createSupportCase.status, 201, JSON.stringify(createSupportCaseBody));

    const validLookup = await request("/api/v1/orders/lookup", {
      method: "POST",
      body: JSON.stringify({ orderNumber, lookupToken })
    });
    const validLookupBody = await responseJson(validLookup);
    assert.equal(validLookup.status, 200, JSON.stringify(validLookupBody));
    assert.deepEqual(Object.keys(validLookupBody.data?.order), [
      "orderNumber",
      "status",
      "checkoutStatus",
      "currency",
      "subtotalCents",
      "discountCents",
      "shippingCents",
      "taxCents",
      "totalCents",
      "createdAt",
      "items"
    ]);
    assert.deepEqual(Object.keys(validLookupBody.data?.order.items[0]), [
      "productName",
      "variantName",
      "quantity",
      "unitPriceCents"
    ]);

    const invalidTokenLookup = await request("/api/v1/orders/lookup", {
      method: "POST",
      body: JSON.stringify({ orderNumber, lookupToken: "x".repeat(43) })
    });
    const invalidTokenLookupBody = await responseJson(invalidTokenLookup);
    const unknownOrderLookup = await request("/api/v1/orders/lookup", {
      method: "POST",
      body: JSON.stringify({ orderNumber: `UNKNOWN-${runId}`, lookupToken })
    });
    const unknownOrderLookupBody = await responseJson(unknownOrderLookup);
    assert.equal(invalidTokenLookup.status, 404);
    assert.equal(unknownOrderLookup.status, 404);
    assert.deepEqual(invalidTokenLookupBody.error, unknownOrderLookupBody.error);

    const adminOrders = await request("/api/v1/orders", { headers: authorization });
    const adminOrdersBody = await responseJson(adminOrders);
    assert.equal(adminOrders.status, 200, JSON.stringify(adminOrdersBody));
    assert.equal(JSON.stringify(adminOrdersBody).includes("lookupTokenHash"), false);
    assert.equal(JSON.stringify(adminOrdersBody).includes("secretEnvelope"), false);
    const adminOrder = adminOrdersBody.data?.orders.find((order: { id: string }) => order.id === orderId);
    assert.equal(adminOrder.supportCases.length, 1);
    assert.equal("id" in (createSupportCaseBody.data?.supportCase ?? {}), false);
    const updateTracking = await request(`/api/v1/orders/${orderId}/tracking`, {
      method: "PATCH",
      headers: authorization,
      body: JSON.stringify({
        status: "IN_TRANSIT",
        carrier: "CodeY Parcel",
        trackingNumber: `TRACK-${runId}`,
        trackingUrl: "https://tracking.example/order",
        note: "Expected this week."
      })
    });
    assert.equal(updateTracking.status, 200, JSON.stringify(await responseJson(updateTracking)));
    const updateSupportCase = await request(
      `/api/v1/orders/cases/${String(adminOrder.supportCases[0].id)}`,
      {
        method: "PATCH",
        headers: authorization,
        body: JSON.stringify({
          status: "IN_REVIEW",
          merchantResponse: "The delivery note was added for the fulfillment team."
        })
      }
    );
    assert.equal(updateSupportCase.status, 200, JSON.stringify(await responseJson(updateSupportCase)));

    const trackedBuyerOrders = await request("/api/v1/orders/buyer/orders", {
      headers: { cookie: buyerCookie }
    });
    const trackedBuyerOrdersBody = await responseJson(trackedBuyerOrders);
    assert.equal(trackedBuyerOrdersBody.data?.orders[0].tracking.carrier, "CodeY Parcel");
    assert.equal(trackedBuyerOrdersBody.data?.orders[0].supportCases.length, 1);
    assert.equal(
      trackedBuyerOrdersBody.data?.orders[0].supportCases[0].merchantResponse,
      "The delivery note was added for the fulfillment team."
    );
    const selectedVariant = starterProduct.variants[0];
    const inventoryBeforePayment = selectedVariant
      ? await prisma.productVariant.findUniqueOrThrow({ where: { id: selectedVariant.id } })
      : await prisma.product.findUniqueOrThrow({ where: { id: starterProduct.id } });
    const reservedBeforePayment = inventoryBeforePayment.reservedQuantity;
    assert.ok(reservedBeforePayment <= inventoryBeforePayment.stockQuantity);

    const enableManualPayments = await request("/api/v1/payments/providers/manual", {
      method: "PUT",
      headers: authorization,
      body: JSON.stringify({
        enabled: true,
        instructions: "Use the order number when arranging payment."
      })
    });
    assert.equal(enableManualPayments.status, 200, JSON.stringify(await responseJson(enableManualPayments)));

    const firstIntent = await request("/api/v1/payments/intent", {
      method: "POST",
      body: JSON.stringify({
        orderId,
        provider: "MANUAL",
        idempotencyKey: `manual-failure-${runId}`
      })
    });
    const firstIntentBody = await responseJson(firstIntent);
    assert.equal(firstIntent.status, 201, JSON.stringify(firstIntentBody));
    const firstPaymentId = String(firstIntentBody.data?.payment.id);
    const inventoryAfterFirstIntent = selectedVariant
      ? await prisma.productVariant.findUniqueOrThrow({ where: { id: selectedVariant.id } })
      : await prisma.product.findUniqueOrThrow({ where: { id: starterProduct.id } });
    assert.equal(inventoryAfterFirstIntent.stockQuantity, inventoryBeforePayment.stockQuantity);
    assert.equal(inventoryAfterFirstIntent.reservedQuantity, reservedBeforePayment + 1);
    const reservedProductResponse = await request("/api/v1/products/starter-product");
    const reservedProductBody = await responseJson(reservedProductResponse);
    assert.equal(reservedProductResponse.status, 200, JSON.stringify(reservedProductBody));
    const reservedProduct = reservedProductBody.data?.product;
    if (selectedVariant) {
      const publicVariant = reservedProduct?.variants.find((variant: { id: string }) =>
        variant.id === selectedVariant.id
      );
      assert.equal(publicVariant.reservedQuantity, reservedBeforePayment + 1);
      assert.equal(publicVariant.availableStock, inventoryBeforePayment.stockQuantity - reservedBeforePayment - 1);
    } else {
      assert.equal(reservedProduct?.reservedQuantity, reservedBeforePayment + 1);
      assert.equal(reservedProduct?.availableStock, inventoryBeforePayment.stockQuantity - reservedBeforePayment - 1);
    }
    const reservedProductPage = await request("/product/starter-product");
    const reservedProductHtml = await reservedProductPage.text();
    assert.equal(reservedProductPage.status, 200);
    assert.match(
      reservedProductHtml,
      new RegExp(`data-stock="${inventoryBeforePayment.stockQuantity - reservedBeforePayment - 1}"`)
    );

    const duplicateIntent = await request("/api/v1/payments/intent", {
      method: "POST",
      body: JSON.stringify({
        orderId,
        provider: "MANUAL",
        idempotencyKey: `manual-failure-${runId}`
      })
    });
    assert.equal(duplicateIntent.status, 200, JSON.stringify(await responseJson(duplicateIntent)));
    const inventoryAfterDuplicate = selectedVariant
      ? await prisma.productVariant.findUniqueOrThrow({ where: { id: selectedVariant.id } })
      : await prisma.product.findUniqueOrThrow({ where: { id: starterProduct.id } });
    assert.equal(inventoryAfterDuplicate.reservedQuantity, reservedBeforePayment + 1);

    const failPayment = await request(`/api/v1/payments/manual/${firstPaymentId}/action`, {
      method: "POST",
      headers: authorization,
      body: JSON.stringify({ action: "FAIL" })
    });
    assert.equal(failPayment.status, 200, JSON.stringify(await responseJson(failPayment)));
    const inventoryAfterFailure = selectedVariant
      ? await prisma.productVariant.findUniqueOrThrow({ where: { id: selectedVariant.id } })
      : await prisma.product.findUniqueOrThrow({ where: { id: starterProduct.id } });
    assert.equal(inventoryAfterFailure.stockQuantity, inventoryBeforePayment.stockQuantity);
    assert.equal(inventoryAfterFailure.reservedQuantity, reservedBeforePayment);

    const retryIntent = await request("/api/v1/payments/intent", {
      method: "POST",
      body: JSON.stringify({
        orderId,
        provider: "MANUAL",
        idempotencyKey: `manual-success-${runId}`
      })
    });
    const retryIntentBody = await responseJson(retryIntent);
    assert.equal(retryIntent.status, 201, JSON.stringify(retryIntentBody));
    const retryPaymentId = String(retryIntentBody.data?.payment.id);
    const succeedPayment = await request(`/api/v1/payments/manual/${retryPaymentId}/action`, {
      method: "POST",
      headers: authorization,
      body: JSON.stringify({ action: "SUCCEED" })
    });
    assert.equal(succeedPayment.status, 200, JSON.stringify(await responseJson(succeedPayment)));
    const inventoryAfterSuccess = selectedVariant
      ? await prisma.productVariant.findUniqueOrThrow({ where: { id: selectedVariant.id } })
      : await prisma.product.findUniqueOrThrow({ where: { id: starterProduct.id } });
    assert.equal(inventoryAfterSuccess.stockQuantity, inventoryBeforePayment.stockQuantity - 1);
    assert.equal(inventoryAfterSuccess.reservedQuantity, reservedBeforePayment);

    const refundRequest = await request(`/api/v1/orders/buyer/orders/${orderNumber}/cases`, {
      method: "POST",
      headers: { cookie: buyerCookie },
      body: JSON.stringify({
        type: "REFUND",
        subject: "Item arrived damaged",
        message: "The item cannot be used in its delivered condition.",
        requestedRefundCents: 1
      })
    });
    const refundRequestBody = await responseJson(refundRequest);
    assert.equal(refundRequest.status, 201, JSON.stringify(refundRequestBody));
    assert.equal(refundRequestBody.data?.supportCase.requestedRefundCents, 1);
    const ordersWithRefundRequest = await request("/api/v1/orders", { headers: authorization });
    const ordersWithRefundRequestBody = await responseJson(ordersWithRefundRequest);
    const refundCase = ordersWithRefundRequestBody.data?.orders
      .find((order: { id: string }) => order.id === orderId)
      ?.supportCases.find((supportCase: { type: string }) => supportCase.type === "REFUND");
    assert.ok(refundCase?.id);
    const approveRefundRequest = await request(`/api/v1/orders/cases/${String(refundCase.id)}`, {
      method: "PATCH",
      headers: authorization,
      body: JSON.stringify({
        status: "APPROVED",
        merchantResponse: "Approved. The refund will now be issued."
      })
    });
    assert.equal(
      approveRefundRequest.status,
      200,
      JSON.stringify(await responseJson(approveRefundRequest))
    );

    const partialRefund = await request(`/api/v1/payments/${retryPaymentId}/refunds`, {
      method: "POST",
      headers: authorization,
      body: JSON.stringify({
        amountCents: 1,
        reason: "CUSTOMER_REQUEST",
        note: "Integration refund",
        idempotencyKey: `manual-refund-${runId}`,
        supportCaseId: String(refundCase.id)
      })
    });
    const partialRefundBody = await responseJson(partialRefund);
    assert.equal(partialRefund.status, 201, JSON.stringify(partialRefundBody));
    assert.equal(partialRefundBody.data?.refund.status, "SUCCEEDED");
    assert.equal(partialRefundBody.data?.refund.amountCents, 1);

    const duplicateRefund = await request(`/api/v1/payments/${retryPaymentId}/refunds`, {
      method: "POST",
      headers: authorization,
      body: JSON.stringify({
        amountCents: 1,
        reason: "CUSTOMER_REQUEST",
        note: "Integration refund",
        idempotencyKey: `manual-refund-${runId}`,
        supportCaseId: String(refundCase.id)
      })
    });
    assert.equal(duplicateRefund.status, 200, JSON.stringify(await responseJson(duplicateRefund)));
    assert.equal(await prisma.paymentRefund.count({ where: { paymentId: retryPaymentId } }), 1);
    const reopenPaidRefundRequest = await request(`/api/v1/orders/cases/${String(refundCase.id)}`, {
      method: "PATCH",
      headers: authorization,
      body: JSON.stringify({ status: "APPROVED" })
    });
    const reopenPaidRefundRequestBody = await responseJson(reopenPaidRefundRequest);
    assert.equal(reopenPaidRefundRequest.status, 409, JSON.stringify(reopenPaidRefundRequestBody));
    assert.equal(reopenPaidRefundRequestBody.error?.code, "refund_request_already_paid");
    const refundedBuyerOrders = await request("/api/v1/orders/buyer/orders", {
      headers: { cookie: buyerCookie }
    });
    const refundedBuyerOrdersBody = await responseJson(refundedBuyerOrders);
    assert.equal(refundedBuyerOrdersBody.data?.orders[0].refundedCents, 1);
    const buyerRefundCase = refundedBuyerOrdersBody.data?.orders[0].supportCases
      .find((supportCase: { type: string }) => supportCase.type === "REFUND");
    assert.equal(buyerRefundCase?.status, "RESOLVED");

    const cancellationRequest = await request(`/api/v1/orders/buyer/orders/${orderNumber}/cancel`, {
      method: "POST",
      headers: { cookie: buyerCookie },
      body: JSON.stringify({ reason: "The paid order is no longer needed." })
    });
    const cancellationRequestBody = await responseJson(cancellationRequest);
    assert.equal(cancellationRequest.status, 200, JSON.stringify(cancellationRequestBody));
    assert.equal(cancellationRequestBody.data?.cancellation.action, "requested");
    assert.equal(
      await prisma.orderSupportCase.count({ where: { orderId, type: "CANCELLATION" } }),
      1
    );

    const forgetBuyer = await request("/api/v1/orders/buyer/session", {
      method: "DELETE",
      headers: { cookie: buyerCookie }
    });
    const forgetBuyerBody = await responseJson(forgetBuyer);
    assert.equal(forgetBuyer.status, 200, JSON.stringify(forgetBuyerBody));
    assert.equal(forgetBuyerBody.data?.session.forgotten, true);
    assert.match(forgetBuyer.headers.get("set-cookie") ?? "", /codey_buyer_session=;/);
    const forgottenBuyerOrders = await request("/api/v1/orders/buyer/orders", {
      headers: { cookie: buyerCookie }
    });
    const forgottenBuyerOrdersBody = await responseJson(forgottenBuyerOrders);
    assert.deepEqual(forgottenBuyerOrdersBody.data?.orders, []);

    const createRedirect = await request("/api/v1/cms/redirects", {
      method: "POST",
      headers: authorization,
      body: JSON.stringify({
        sourcePath: redirectPath,
        targetPath: `/${pageSlug}`,
        statusCode: 308,
        preserveQuery: true,
        active: true
      })
    });
    assert.equal(createRedirect.status, 201, JSON.stringify(await responseJson(createRedirect)));

    const redirect = await request(`${redirectPath}?campaign=release`, { redirect: "manual" });
    assert.equal(redirect.status, 308);
    assert.equal(redirect.headers.get("location"), `/${pageSlug}?campaign=release`);

    const missing = await request(`/missing-${runId}`);
    const missingHtml = await missing.text();
    assert.equal(missing.status, 404);
    assert.match(missingHtml, /Page not found/);
    assert.match(missingHtml, /name="robots" content="noindex, nofollow"/);

    const malformed = await request("/%E0%A4%A");
    const malformedBody = await responseJson(malformed);
    assert.equal(malformed.status, 400);
    assert.equal(malformedBody.error?.code, "invalid_request_path");

    const mfaSetup = await request("/api/v1/auth/mfa/setup", {
      method: "POST",
      headers: authorization,
      body: JSON.stringify({ currentPassword: adminPassword })
    });
    const mfaSetupBody = await responseJson(mfaSetup);
    assert.equal(mfaSetup.status, 200, JSON.stringify(mfaSetupBody));
    const mfaSecret = String(mfaSetupBody.data?.setup.secret);
    const mfaCode = createTotpCode(mfaSecret);
    const mfaConfirm = await request("/api/v1/auth/mfa/confirm", {
      method: "POST",
      headers: authorization,
      body: JSON.stringify({ code: mfaCode })
    });
    const mfaConfirmBody = await responseJson(mfaConfirm);
    assert.equal(mfaConfirm.status, 200, JSON.stringify(mfaConfirmBody));
    assert.equal(mfaConfirmBody.data?.recoveryCodes.length, 10);

    const loginWithoutMfa = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: adminEmail, password: adminPassword })
    });
    assert.equal(loginWithoutMfa.status, 401);
    assert.equal((await responseJson(loginWithoutMfa)).error?.code, "mfa_required");

    const nextMfaCode = createTotpCode(mfaSecret, Date.now() + 30_000);
    const concurrentMfaLogins = await Promise.all([
      request("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: adminEmail, password: adminPassword, mfaCode: nextMfaCode })
      }),
      request("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: adminEmail, password: adminPassword, mfaCode: nextMfaCode })
      })
    ]);
    assert.deepEqual(
      concurrentMfaLogins.map((response) => response.status).sort(),
      [200, 401]
    );

    const olderMfaLogin = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: adminEmail, password: adminPassword, mfaCode })
    });
    assert.equal(olderMfaLogin.status, 401);
    assert.equal((await responseJson(olderMfaLogin)).error?.code, "invalid_mfa_code");

    const recoveryLogin = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: adminEmail,
        password: adminPassword,
        mfaCode: mfaConfirmBody.data?.recoveryCodes[0]
      })
    });
    const recoveryLoginBody = await responseJson(recoveryLogin);
    assert.equal(recoveryLogin.status, 200, JSON.stringify(recoveryLoginBody));
    const reusedRecoveryLogin = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: adminEmail,
        password: adminPassword,
        mfaCode: mfaConfirmBody.data?.recoveryCodes[0]
      })
    });
    assert.equal(reusedRecoveryLogin.status, 401);
    assert.equal((await responseJson(reusedRecoveryLogin)).error?.code, "invalid_mfa_code");
    const mfaAuthorization = {
      authorization: `Bearer ${String(recoveryLoginBody.data?.tokens.accessToken)}`
    };
    const disableMfa = await request("/api/v1/auth/mfa", {
      method: "DELETE",
      headers: mfaAuthorization,
      body: JSON.stringify({
        currentPassword: adminPassword,
        code: mfaConfirmBody.data?.recoveryCodes[1]
      })
    });
    assert.equal(disableMfa.status, 200, JSON.stringify(await responseJson(disableMfa)));

    const logout = await request("/api/v1/auth/logout", {
      method: "POST",
      headers: { cookie: refreshCookie },
      body: "{}"
    });
    assert.equal(logout.status, 200);
  } finally {
    if (uploadedAssetId) {
      await prisma.mediaAsset.delete({ where: { id: uploadedAssetId } }).catch(() => undefined);
    }
    if (managedUserId) {
      await prisma.user.delete({ where: { id: managedUserId } }).catch(() => undefined);
    }
    if (reusableTemplateId) {
      await prisma.cmsTemplate.deleteMany({ where: { id: reusableTemplateId } });
    }
    if (commerceOrderId) {
      await prisma.payment.deleteMany({ where: { orderId: commerceOrderId } });
      await prisma.order.deleteMany({ where: { id: commerceOrderId } });
    }
    if (commerceCartId) {
      await prisma.cart.deleteMany({ where: { id: commerceCartId } });
    }
    if (existingManualProvider) {
      await prisma.paymentProviderConfig.update({
        where: { id: existingManualProvider.id },
        data: {
          mode: existingManualProvider.mode,
          enabled: existingManualProvider.enabled,
          publishableKey: existingManualProvider.publishableKey,
          encryptedCredentials: existingManualProvider.encryptedCredentials,
          clientId: existingManualProvider.clientId,
          webhookId: existingManualProvider.webhookId,
          instructions: existingManualProvider.instructions,
          lastTestedAt: existingManualProvider.lastTestedAt,
          lastTestSucceeded: existingManualProvider.lastTestSucceeded,
          lastTestMessage: existingManualProvider.lastTestMessage,
          lastWebhookAt: existingManualProvider.lastWebhookAt
        }
      });
    } else {
      await prisma.paymentProviderConfig.deleteMany({
        where: { provider: "MANUAL", siteId: defaultSite.id }
      });
    }
    if (existingSiteSetting) {
      await prisma.moduleSetting.update({
        where: { id: existingSiteSetting.id },
        data: { value: existingSiteSetting.value }
      });
    } else {
      await prisma.moduleSetting.deleteMany({
        where: { moduleId: "config", key: "site", site: { slug: "default" } }
      });
    }
    if (existingEmailSetting) {
      await prisma.moduleSetting.update({
        where: { id: existingEmailSetting.id },
        data: { value: existingEmailSetting.value }
      });
    } else {
      await prisma.moduleSetting.deleteMany({
        where: { moduleId: "config", key: "email", site: { slug: "default" } }
      });
    }
    await prisma.userInvite.deleteMany({ where: { email: managedUserEmail } });
    await prisma.cmsRedirect.deleteMany({ where: { sourcePath: redirectPath } });
    await prisma.cmsPage.deleteMany({ where: { slug: pageSlug } });
    await prisma.moduleSetting.deleteMany({
      where: {
        moduleId: "products",
        key: "storefront",
        site: { slug: "default" }
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await prisma.$disconnect();
  }
});

test("concurrent order email workers claim a notification once", async () => {
  let requests = 0;
  const emailServer = createHttpServer((_request, response) => {
    requests += 1;
    setTimeout(() => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ messageId: "integration-email" }));
    }, 100);
  });
  await new Promise<void>((resolve) => emailServer.listen(0, "127.0.0.1", resolve));
  const emailAddress = emailServer.address() as AddressInfo;
  const site = await prisma.site.findUniqueOrThrow({ where: { slug: "default" } });
  const settingKey = {
    siteId_moduleId_key: { siteId: site.id, moduleId: "config", key: "email" }
  };
  const previousSetting = await prisma.moduleSetting.findUnique({
    where: settingKey,
    select: { value: true }
  });
  const order = await prisma.order.create({
    data: {
      orderNumber: `EMAIL-${Date.now()}`,
      customerEmail: "email-worker@example.com",
      subtotalCents: 1200,
      totalCents: 1200,
      notifications: {
        create: {
          recipient: "email-worker@example.com",
          subject: "Order received",
          body: "Your order was received."
        }
      }
    },
    include: { notifications: true }
  });

  try {
    await new EmailSettingsService(prisma, config).update({
      enabled: true,
      provider: "generic",
      from: "orders@example.com",
      httpEndpoint: `http://127.0.0.1:${emailAddress.port}`
    });
    const context = { config, prisma, logger };
    await Promise.all([
      deliverQueuedOrderEmails(context, { orderId: order.id }),
      deliverQueuedOrderEmails(context, { orderId: order.id })
    ]);

    const notification = await prisma.orderNotification.findUniqueOrThrow({
      where: { id: order.notifications[0].id }
    });
    assert.equal(requests, 1);
    assert.equal(notification.status, "SENT");
    assert.equal(notification.attempts, 1);
  } finally {
    await prisma.order.delete({ where: { id: order.id } }).catch(() => undefined);
    if (previousSetting) {
      await prisma.moduleSetting.update({ where: settingKey, data: { value: previousSetting.value } });
    } else {
      await prisma.moduleSetting.delete({ where: settingKey }).catch(() => undefined);
    }
    await new Promise<void>((resolve, reject) => emailServer.close((error) => error ? reject(error) : resolve()));
  }
});

test("checkout rate limits are shared and store only keyed hashes", async () => {
  const scope = "cart.create" as const;
  const rawKey = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
  await prisma.commerceRateLimit.deleteMany({ where: { scope } });
  const limitedConfig = {
    ...config,
    commerce: {
      checkout: {
        ...config.commerce.checkout,
        rateLimitMax: 2
      }
    }
  } as typeof config;
  const firstInstance = new CommerceAbuseService(prisma, limitedConfig);
  const secondInstance = new CommerceAbuseService(prisma, limitedConfig);

  try {
    await firstInstance.consumeRateLimit(scope, rawKey);
    await secondInstance.consumeRateLimit(scope, rawKey);
    await assert.rejects(
      secondInstance.consumeRateLimit(scope, rawKey),
      (error) => error instanceof AppError &&
        error.code === "checkout_rate_limit_exceeded" &&
        typeof error.details === "object" &&
        !Array.isArray(error.details) &&
        Number(error.details.retryAfterSeconds) > 0
    );

    const records = await prisma.commerceRateLimit.findMany({ where: { scope } });
    assert.equal(records.length, 1);
    assert.equal(records[0]?.requestCount, 3);
    assert.doesNotMatch(JSON.stringify(records), new RegExp(rawKey.replaceAll(".", "\\.")));

    const audit = await prisma.auditLog.findFirst({
      where: { action: "commerce.rate_limit.exceeded" },
      orderBy: { createdAt: "desc" }
    });
    assert.ok(audit);
    assert.doesNotMatch(JSON.stringify(audit), new RegExp(rawKey.replaceAll(".", "\\.")));
  } finally {
    await prisma.commerceRateLimit.deleteMany({ where: { scope } });
    await prisma.$disconnect();
  }
});

test("pending checkout limits normalize email and serialize concurrent clients", async () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `Pending-${runId}@Example.com`;
  const ipAddress = "203.0.113.42";
  const limitedConfig = {
    ...config,
    commerce: {
      checkout: {
        ...config.commerce.checkout,
        pendingOrderLimitPerEmail: 1,
        pendingOrderLimitPerIp: 1
      }
    }
  } as typeof config;
  const firstInstance = new CommerceAbuseService(prisma, limitedConfig);
  const secondInstance = new CommerceAbuseService(prisma, limitedConfig);
  const firstHashes = firstInstance.pendingOrderHashes(email, ipAddress);
  const secondHashes = secondInstance.pendingOrderHashes(email.toLowerCase(), ipAddress);

  assert.equal(firstHashes.emailHash, secondHashes.emailHash);

  try {
    await prisma.$transaction(async (tx) => {
      await firstInstance.assertPendingOrderCapacity(tx, email, firstHashes);
      await tx.order.create({
        data: {
          orderNumber: `LIMIT-${runId}`,
          customerEmail: email,
          checkoutEmailHash: firstHashes.emailHash,
          checkoutIpHash: firstHashes.ipHash,
          checkoutStatus: "PAYMENT_PENDING",
          currency: "EUR",
          subtotalCents: 1000,
          totalCents: 1000
        }
      });
    });

    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await secondInstance.assertPendingOrderCapacity(tx, email.toLowerCase(), secondHashes);
      }),
      (error) => error instanceof AppError && error.code === "pending_order_limit_exceeded"
    );
  } finally {
    await prisma.order.deleteMany({ where: { orderNumber: `LIMIT-${runId}` } });
    await prisma.$disconnect();
  }
});

test("an email connection test cannot overwrite settings changed while it runs", async () => {
  let releaseRequest!: () => void;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  const emailServer = createHttpServer(async (_request, response) => {
    markStarted();
    await release;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ messageId: "stale-email-test" }));
  });
  await new Promise<void>((resolve) => emailServer.listen(0, "127.0.0.1", resolve));
  const emailAddress = emailServer.address() as AddressInfo;
  const site = await prisma.site.findUniqueOrThrow({ where: { slug: "default" } });
  const settingKey = {
    siteId_moduleId_key: { siteId: site.id, moduleId: "config", key: "email" }
  };
  const previousSetting = await prisma.moduleSetting.findUnique({
    where: settingKey,
    select: { value: true }
  });
  const service = new EmailSettingsService(prisma, config);

  try {
    await service.update({
      enabled: true,
      provider: "generic",
      from: "orders@example.com",
      httpEndpoint: `http://127.0.0.1:${emailAddress.port}/first`,
      bearerToken: "first-endpoint-token"
    });
    const testRequest = service.test("owner@example.com");
    await started;
    await service.update({
      httpEndpoint: `http://127.0.0.1:${emailAddress.port}/second`,
      bearerToken: "second-endpoint-token"
    });
    releaseRequest();

    await assert.rejects(
      testRequest,
      (error) => error instanceof AppError && error.code === "email_settings_test_stale"
    );
    const current = await service.resolve();
    assert.equal(current.httpEndpoint, `http://127.0.0.1:${emailAddress.port}/second`);
    assert.equal(current.httpBearerToken, "second-endpoint-token");
    assert.equal(current.lastTestedAt, undefined);
  } finally {
    releaseRequest();
    if (previousSetting) {
      await prisma.moduleSetting.update({ where: settingKey, data: { value: previousSetting.value } });
    } else {
      await prisma.moduleSetting.delete({ where: settingKey }).catch(() => undefined);
    }
    await new Promise<void>((resolve, reject) => {
      emailServer.close((error) => error ? reject(error) : resolve());
    });
    await prisma.$disconnect();
  }
});

test("concurrent payment updates preserve each credential change and reject stale tests", async () => {
  const site = await prisma.site.findUniqueOrThrow({ where: { slug: "default" } });
  const providerKey = {
    siteId_provider: { siteId: site.id, provider: "STRIPE" as const }
  };
  const previousProvider = await prisma.paymentProviderConfig.findUnique({ where: providerKey });
  const service = new PaymentProviderConfigService({ prisma, config, logger });

  try {
    await service.updateConfig("STRIPE", {
      mode: "SANDBOX",
      publishableKey: "pk_test_initial",
      secretKey: "sk_test_initial",
      webhookSecret: "whsec_initial"
    });
    await Promise.all([
      service.updateConfig("STRIPE", { publishableKey: "pk_test_concurrent" }),
      service.updateConfig("STRIPE", { secretKey: "sk_test_concurrent" })
    ]);

    const tested = await service.resolveConfig("STRIPE");
    assert.equal(tested.config.publishableKey, "pk_test_concurrent");
    assert.equal(tested.credentials.secretKey, "sk_test_concurrent");
    const testedRevision = paymentProviderConfigRevision(tested.config);

    await service.updateConfig("STRIPE", { webhookSecret: "whsec_replaced" });
    assert.equal(await service.recordTestResult("STRIPE", testedRevision, true, "Connected"), false);
    const current = await service.resolveConfig("STRIPE");
    assert.equal(current.credentials.webhookSecret, "whsec_replaced");
    assert.equal(current.config.lastTestSucceeded, null);
  } finally {
    await prisma.paymentProviderConfig.deleteMany({
      where: { siteId: site.id, provider: "STRIPE" }
    });
    if (previousProvider) {
      await prisma.paymentProviderConfig.create({ data: previousProvider });
    }
    await prisma.$disconnect();
  }
});

test("checkout rate-limit responses use the API envelope and retry header", async () => {
  await prisma.commerceRateLimit.deleteMany({ where: { scope: "cart.create" } });
  const app = await createApp();
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
  });
  const address = server.address() as AddressInfo;
  const createdCartIds: string[] = [];

  try {
    for (let attempt = 0; attempt < config.commerce.checkout.rateLimitMax; attempt += 1) {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/orders/carts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
      const body = await responseJson(response);
      assert.equal(response.status, 201, JSON.stringify(body));
      createdCartIds.push(String(body.data?.cart.id));
    }

    const limited = await fetch(`http://127.0.0.1:${address.port}/api/v1/orders/carts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    const limitedBody = await responseJson(limited);
    assert.equal(limited.status, 429);
    assert.equal(limitedBody.success, false);
    assert.equal(limitedBody.error?.code, "checkout_rate_limit_exceeded");
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
  } finally {
    await prisma.cart.deleteMany({ where: { id: { in: createdCartIds } } });
    await prisma.commerceRateLimit.deleteMany({ where: { scope: "cart.create" } });
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await prisma.$disconnect();
  }
});
