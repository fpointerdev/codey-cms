import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { config } from "../../src/config/index.js";
import { createApp } from "../../src/core/app.js";
import { prisma } from "../../src/infrastructure/database/prisma.js";
import { logger } from "../../src/infrastructure/logging/logger.js";
import { applyWebsiteSpec } from "../../src/modules/config/website-spec.service.js";

const { renderPageContent } = await import("../../apps/web/web/public-renderer.js");

const ownerEmail = "first-owner@example.com";
const ownerPassword = "FirstOwnerPassword123!";

test("an empty runtime can be claimed once and used immediately", { timeout: 60_000 }, async () => {
  const app = await createApp();
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function request(pathname: string, options: RequestInit = {}) {
    const headers = new Headers(options.headers);
    if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    return fetch(`${baseUrl}${pathname}`, { redirect: "manual", ...options, headers });
  }

  try {
    const initialStatus = await request("/api/v1/install/status");
    assert.equal(initialStatus.status, 200);
    assert.equal((await initialStatus.json()).data.installed, false);

    const adminRedirect = await request("/cy-admin", { headers: { accept: "text/html" } });
    assert.equal(adminRedirect.status, 302);
    assert.equal(adminRedirect.headers.get("location"), "/install");

    const blockedApi = await request("/api/v1/config");
    assert.equal(blockedApi.status, 503);
    assert.equal((await blockedApi.json()).error.code, "installation_required");

    const invalidClaim = await request("/api/v1/install/complete", {
      method: "POST",
      body: JSON.stringify(installationPayload("invalid-token"))
    });
    assert.equal(invalidClaim.status, 403);
    assert.equal((await invalidClaim.json()).error.code, "installation_token_invalid");

    const preparedSite = await prisma.site.upsert({
      where: { slug: "default" },
      update: {},
      create: { slug: "default", name: "Generated site", deploymentProfile: "cms" }
    });
    await prisma.moduleSetting.upsert({
      where: {
        siteId_moduleId_key: { siteId: preparedSite.id, moduleId: "config", key: "site" }
      },
      update: {},
      create: {
        siteId: preparedSite.id,
        moduleId: "config",
        key: "site",
        value: {
          title: "Generated site",
          metaTitle: "Generated site",
          description: "Generated website description",
          design: { preset: "custom" },
          generatedFrom: "websiteSpec",
          generatedCss: "body[data-codey-preview='cms']{background:#fff}",
          customCss: ".website-spec-page{--codey-dna:test-install;}"
        }
      }
    });
    const generatedHome = await prisma.cmsPage.create({
      data: {
        title: "Home",
        slug: "home",
        locale: "en",
        translationGroupId: "home",
        content: { source: "websiteSpec", hideTitle: true },
        status: "PUBLISHED",
        publishedAt: new Date()
      }
    });
    await prisma.pageSection.create({
      data: {
        pageId: generatedHome.id,
        key: "generated-hero",
        settings: { websiteSpec: { type: "hero" } }
      }
    });

    const install = await request("/api/v1/install/complete", {
      method: "POST",
      body: JSON.stringify(installationPayload(process.env.CODEY_INSTALL_TOKEN || ""))
    });
    assert.equal(install.status, 201, await install.text());

    const login = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: ownerEmail, password: ownerPassword })
    });
    assert.equal(login.status, 200, await login.text());

    const secondInstall = await request("/api/v1/install/complete", {
      method: "POST",
      body: JSON.stringify(installationPayload(process.env.CODEY_INSTALL_TOKEN || ""))
    });
    assert.equal(secondInstall.status, 409);
    assert.equal((await secondInstall.json()).error.code, "installation_complete");

    const installation = await prisma.runtimeInstallation.findUnique({ where: { id: "primary" } });
    const owner = await prisma.user.findUnique({
      where: { email: ownerEmail },
      include: { roles: { include: { role: true } } }
    });
    assert.equal(installation?.status, "COMPLETE");
    assert.equal(installation?.ownerUserId, owner?.id);
    assert.deepEqual(owner?.roles.map(({ role }) => role.name), ["owner"]);
    assert.equal(await prisma.cmsPage.count({ where: { slug: "home", status: "PUBLISHED" } }), 1);
    assert.equal(await prisma.pageSection.count({ where: { pageId: generatedHome.id } }), 1);
    assert.equal(await prisma.pageSection.count({ where: { pageId: generatedHome.id, key: "welcome" } }), 0);
    const siteSettings = await prisma.moduleSetting.findUnique({
      where: {
        siteId_moduleId_key: { siteId: preparedSite.id, moduleId: "config", key: "site" }
      }
    });
    assert.deepEqual(siteSettings?.value, {
      title: "Generated site",
      metaTitle: "Generated site",
      description: "Generated website description",
      design: { preset: "custom" },
      generatedFrom: "websiteSpec",
      generatedCss: "body[data-codey-preview='cms']{background:#fff}",
      customCss: ".website-spec-page{--codey-dna:test-install;}",
      siteUrl: process.env.APP_PUBLIC_URL,
      searchIndexing: false
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.$disconnect();
  }
});

test("WebsiteSpec atomically imports custom elements that server-render publicly", { timeout: 60_000 }, async () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const pageSlug = `custom-elements-${runId}`;
  const elementValues = {
    "process-steps": {
      title: "How delivery works",
      items: [
        { title: "Plan", body: "Agree on scope." },
        { title: "Launch", body: "Publish and verify." }
      ],
      display: { columns: 2, showNumbers: true }
    },
    "comparison-table": {
      title: "Compare support",
      firstColumnTitle: "Standard",
      secondColumnTitle: "Priority",
      items: [{ title: "Response", firstValue: "2 days", secondValue: "4 hours" }]
    },
    video: {
      title: "Product tour",
      body: "A short walkthrough.",
      url: "/uploads/product-tour.mp4",
      display: { ratio: "16 / 9", preload: "none", loop: false }
    }
  };

  const result = await applyWebsiteSpec({ config, prisma, logger }, {
    version: "1.0",
    intent: "cms",
    project: {
      name: `Custom element import ${runId}`,
      slug: `custom-element-import-${runId}`,
      summary: "An atomic import of canonical custom builder elements.",
      locale: "en",
      timezone: "UTC",
      currency: "EUR"
    },
    modules: { cms: true },
    style: {
      theme: "system",
      colorPalette: { primary: "#17211b", accent: "#0f766e" }
    },
    pages: [{
      title: "Custom elements",
      slug: pageSlug,
      purpose: "content",
      sections: Object.entries(elementValues).map(([elementId, value]) => ({
        key: elementId,
        type: "custom",
        settings: { elementId, value }
      }))
    }]
  });

  const page = await prisma.cmsPage.findUniqueOrThrow({
    where: { locale_slug: { locale: "en", slug: pageSlug } },
    include: {
      sections: {
        orderBy: { sortOrder: "asc" },
        include: { blocks: { orderBy: { sortOrder: "asc" } } }
      }
    }
  });

  assert.equal(result.applied.pages, 1);
  assert.deepEqual(
    page.sections.map((section) => ({
      elementId: (section.settings as Record<string, unknown>).elementId,
      transportValueStored: Object.hasOwn(section.settings as object, "value"),
      blockElementId: (section.blocks[0]?.settings as Record<string, unknown>).elementId,
      value: section.blocks[0]?.value
    })),
    Object.entries(elementValues).map(([elementId, value]) => ({
      elementId,
      transportValueStored: false,
      blockElementId: elementId,
      value
    }))
  );

  const html = renderPageContent(page);
  assert.match(html, /<ol class="structured-process/);
  assert.match(html, /<th scope="row">Response<\/th><td>2 days<\/td><td>4 hours<\/td>/);
  assert.match(html, /<video src="\/uploads\/product-tour\.mp4" controls playsinline preload="none"/);
  assert.doesNotMatch(html, /<iframe/);
  await prisma.$disconnect();
});

test("a late WebsiteSpec failure rolls back every generated record", { timeout: 60_000 }, async () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const pageSlug = `atomic-page-${runId}`;
  const productSlugs = [`atomic-product-a-${runId}`, `atomic-product-b-${runId}`];
  const duplicateSku = `ATOMIC-${runId}`;
  const siteBefore = await prisma.site.findUniqueOrThrow({ where: { slug: "default" } });
  const settingsBefore = await prisma.moduleSetting.findUnique({
    where: {
      siteId_moduleId_key: {
        siteId: siteBefore.id,
        moduleId: "config",
        key: "site"
      }
    }
  });

  await assert.rejects(
    applyWebsiteSpec({ config, prisma, logger }, {
      version: "1.0",
      intent: "shop",
      project: {
        name: `Atomic rollback ${runId}`,
        slug: `atomic-rollback-${runId}`,
        summary: "A generated site that must roll back after a late persistence failure.",
        locale: "en",
        timezone: "UTC",
        currency: "EUR"
      },
      modules: { cms: true, shop: true },
      style: {
        theme: "system",
        colorPalette: { primary: "#17211b", accent: "#0f766e" }
      },
      pages: [{
        title: "Atomic rollback page",
        slug: pageSlug,
        purpose: "content",
        sections: [{
          key: "content",
          type: "richText",
          body: "This page must not survive the failed import."
        }]
      }],
      products: productSlugs.map((slug, index) => ({
        name: `Atomic product ${index + 1}`,
        slug,
        sku: duplicateSku,
        priceCents: 1000 + index,
        currency: "EUR",
        stockQuantity: 1
      }))
    }),
    (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );

  const [siteAfter, settingsAfter, pages, products] = await Promise.all([
    prisma.site.findUniqueOrThrow({ where: { slug: "default" } }),
    prisma.moduleSetting.findUnique({
      where: {
        siteId_moduleId_key: {
          siteId: siteBefore.id,
          moduleId: "config",
          key: "site"
        }
      }
    }),
    prisma.cmsPage.count({ where: { slug: pageSlug } }),
    prisma.product.count({ where: { slug: { in: productSlugs } } })
  ]);

  assert.equal(siteAfter.name, siteBefore.name);
  assert.deepEqual(settingsAfter?.value, settingsBefore?.value);
  assert.equal(pages, 0);
  assert.equal(products, 0);
  await prisma.$disconnect();
});

function installationPayload(claimToken: string) {
  return {
    claimToken,
    siteName: "First CodeY Site",
    profile: "cms",
    searchIndexing: false,
    admin: {
      name: "First Owner",
      email: ownerEmail,
      password: ownerPassword
    }
  };
}
