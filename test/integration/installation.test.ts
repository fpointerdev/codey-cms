import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createApp } from "../../src/core/app.js";
import { prisma } from "../../src/infrastructure/database/prisma.js";

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
          description: "Generated website description",
          design: { preset: "custom" },
          customCss: ".website-spec-page{--codey-dna:test-install;}"
        }
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
    const siteSettings = await prisma.moduleSetting.findUnique({
      where: {
        siteId_moduleId_key: { siteId: preparedSite.id, moduleId: "config", key: "site" }
      }
    });
    assert.deepEqual(siteSettings?.value, {
      description: "Generated website description",
      design: { preset: "custom" },
      customCss: ".website-spec-page{--codey-dna:test-install;}",
      title: "First CodeY Site",
      metaTitle: "First CodeY Site",
      siteUrl: process.env.APP_PUBLIC_URL,
      searchIndexing: false
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.$disconnect();
  }
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
