import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "../../src/infrastructure/database/prisma.js";

test("protected client editing preserves design on desktop and mobile and rejects stale saves", async ({ browser, request }, testInfo) => {
  test.setTimeout(90_000);
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const slug = `content-policy-${suffix}`;
  const email = `${slug}@example.com`;
  const password = "ContentPolicyBrowser123!";
  const site = await prisma.site.findUniqueOrThrow({ where: { slug: "default" } });
  const setting = await prisma.moduleSetting.findUnique({ where: { siteId_moduleId_key: { siteId: site.id, moduleId: "config", key: "site" } } });
  let userId = "";
  let roleId = "";
  try {
    const login = await request.post("/api/v1/auth/login", { data: {
      email: process.env.INTEGRATION_ADMIN_EMAIL || "integration-owner@example.com",
      password: process.env.INTEGRATION_ADMIN_PASSWORD || "IntegrationOwner123!"
    } });
    expect(login.ok()).toBeTruthy();
    const owner = { authorization: `Bearer ${(await login.json()).data.tokens.accessToken}` };
    const config = (await (await request.get("/api/v1/config/admin", { headers: owner })).json()).data;
    const policy = await request.patch("/api/v1/config/site-settings", { headers: owner, data: { ...config.siteSettings, editingPolicy: "protected" } });
    expect(policy.ok()).toBeTruthy();
    const permissions = await prisma.permission.findMany({ where: { subject: "cms", action: { in: ["read", "update", "create", "publish"] } } });
    const role = await prisma.role.create({ data: { name: slug, permissions: { create: permissions.map((permission) => ({ permissionId: permission.id })) } } });
    roleId = role.id;
    const user = await prisma.user.create({ data: { email, name: "Content editor", status: "ACTIVE", passwordHash: await bcrypt.hash(password, 4), roles: { create: { roleId } } } });
    userId = user.id;
    const created = await request.post("/api/v1/cms/pages", { headers: owner, data: {
      slug, title: "Client website", status: "PUBLISHED", sections: [{
        key: "hero", label: "Hero", settings: { style: { radius: 12, backgroundColor: "#f2f6f8" } },
        blocks: [{ key: "headline", label: "Headline", type: "TEXT", value: "Original headline", settings: { customCss: "max-width: 720px" } }]
      }]
    } });
    expect(created.ok()).toBeTruthy();
    const originalSettings = (await created.json()).data.page.sections[0].settings;

    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport, baseURL: testInfo.project.use.baseURL || "http://127.0.0.1:4173" });
      const page = await context.newPage();
      try {
        await page.goto("/cy-admin");
        await page.getByLabel("Email", { exact: true }).fill(email);
        await page.getByLabel("Password", { exact: true }).fill(password);
        await page.getByRole("button", { name: "Sign in" }).click();
        await expect(page).toHaveURL(/\/dashboard/);
        await page.goto(`/dashboard/pages/${slug}/builder`);
        await expect(page.locator("[data-content-only-editor]")).toBeVisible();
        await expect(page.getByRole("button", { name: "Add container", exact: true })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Duplicate", exact: true })).toHaveCount(0);
        await page.getByRole("button", { name: "Edit content", exact: true }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog.getByRole("tab", { name: "Style", exact: true })).toHaveCount(0);
        await dialog.getByLabel("Text", { exact: true }).fill(`Client headline ${viewport.width}`);
        await dialog.getByRole("button", { name: "Save content", exact: true }).click();
        await expect(page.locator(".builder-block-preview")).toContainText(`Client headline ${viewport.width}`);
        const after = (await (await request.get(`/api/v1/cms/pages/${slug}`, { headers: owner })).json()).data.page;
        expect(after.sections[0].settings).toEqual(originalSettings);
        expect(after.sections[0].blocks[0].settings).toEqual({ customCss: "max-width: 720px" });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
        await page.screenshot({ path: testInfo.outputPath(`content-editor-${viewport.width}.png`), fullPage: true });

        await page.getByRole("button", { name: "Edit content", exact: true }).click();
        await dialog.getByLabel("Text", { exact: true }).fill("Stale browser text");
        const concurrent = await request.patch(`/api/v1/cms/pages/${slug}/blocks/headline`, { headers: owner, data: { value: "Newer owner text", expectedUpdatedAt: after.updatedAt } });
        expect(concurrent.ok()).toBeTruthy();
        const conflict = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes("/blocks/headline"));
        await dialog.getByRole("button", { name: "Save content", exact: true }).click();
        expect((await conflict).status()).toBe(409);
        await expect(dialog.getByRole("alert")).toContainText("Someone else changed this content");
        await expect(dialog.getByLabel("Text", { exact: true })).toHaveValue("Stale browser text");
        await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
        const html = await (await request.get(`/${slug}`)).text();
        expect(html).toContain("Newer owner text");
        expect(html).not.toContain("Stale browser text");

        await page.goto(`/${slug}?edit=1`);
        await expect(page.getByRole("toolbar", { name: "Page content editor" })).toBeVisible();
        await expect(page.locator("[data-visual-delete-section]")).toHaveCount(0);
        await expect(page.locator("[data-visual-duplicate-block]")).toHaveCount(0);
      } finally {
        await context.close();
      }
    }
  } finally {
    await prisma.cmsPage.deleteMany({ where: { slug } });
    if (userId) await prisma.user.delete({ where: { id: userId } });
    if (roleId) await prisma.role.delete({ where: { id: roleId } });
    if (setting) await prisma.moduleSetting.update({ where: { id: setting.id }, data: { value: setting.value as object } });
    else await prisma.moduleSetting.deleteMany({ where: { siteId: site.id, moduleId: "config", key: "site" } });
    await prisma.$disconnect();
  }
});
