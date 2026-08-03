import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createApp } from "../../src/core/app.js";
import { prisma } from "../../src/infrastructure/database/prisma.js";
import { createTotpCode } from "../../src/modules/auth/mfa.js";
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
  const existingSiteSetting = await prisma.moduleSetting.findFirst({
    where: { moduleId: "config", key: "site", site: { slug: "default" } },
    select: { id: true, value: true }
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

    const diagnostics = await request("/api/v1/health/diagnostics", { headers: authorization });
    const diagnosticsBody = await responseJson(diagnostics);
    assert.equal(diagnostics.status, 200, JSON.stringify(diagnosticsBody));
    assert.equal(diagnosticsBody.data?.runtime.status, "ready");
    assert.equal(diagnosticsBody.data?.runtime.checks.database.status, "pass");
    assert.equal(diagnosticsBody.data?.operations.backup.blocking, false);
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
    const currentSiteSettings = configBody.data?.siteSettings;
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
    const mfaAuthorization = {
      authorization: `Bearer ${String(recoveryLoginBody.data?.tokens.accessToken)}`
    };
    const disableMfa = await request("/api/v1/auth/mfa", {
      method: "DELETE",
      headers: mfaAuthorization,
      body: JSON.stringify({ currentPassword: adminPassword, code: createTotpCode(mfaSecret) })
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
