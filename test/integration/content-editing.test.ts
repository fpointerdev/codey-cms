import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import bcrypt from "bcryptjs";
import { createApp } from "../../src/core/app.js";
import { prisma } from "../../src/infrastructure/database/prisma.js";

test("protected editing enforces roles and atomic conflicts through the real API and SSR", { timeout: 60_000 }, async () => {
  const app = await createApp();
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const suffix = `${Date.now()}`;
  const slug = `protected-${suffix}`;
  const users: string[] = [];
  const roles: string[] = [];
  const site = await prisma.site.findUniqueOrThrow({ where: { slug: "default" } });
  const setting = await prisma.moduleSetting.findUnique({ where: { siteId_moduleId_key: { siteId: site.id, moduleId: "config", key: "site" } } });
  const password = "ContentPolicyTest123!";

  async function request(path: string, token: string, method = "GET", data?: unknown) {
    const response = await fetch(`${base}/api/v1${path}`, {
      method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(data === undefined ? {} : { body: JSON.stringify(data) })
    });
    return { status: response.status, body: await response.json() };
  }

  async function login(email: string, loginPassword = password) {
    const result = await request("/auth/login", "", "POST", { email, password: loginPassword });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body.data.tokens.accessToken as string;
  }

  async function account(actions: string[], name: string) {
    const permissions = await prisma.permission.findMany({ where: { subject: "cms", action: { in: actions } } });
    const role = await prisma.role.create({ data: {
      name: `policy-${name}-${suffix}`,
      permissions: { create: permissions.map((permission) => ({ permissionId: permission.id })) }
    } });
    roles.push(role.id);
    const user = await prisma.user.create({ data: {
      email: `${name}-${suffix}@example.com`, name, status: "ACTIVE",
      passwordHash: await bcrypt.hash(password, 4),
      roles: { create: { roleId: role.id } }
    } });
    users.push(user.id);
    return login(user.email);
  }

  try {
    const owner = await login(process.env.INTEGRATION_ADMIN_EMAIL || "integration-owner@example.com", process.env.INTEGRATION_ADMIN_PASSWORD || "IntegrationOwner123!");
    const config = (await request("/config/admin", owner)).body.data;
    const enable = await request("/config/site-settings", owner, "PATCH", { ...config.siteSettings, editingPolicy: "protected" });
    assert.equal(enable.status, 200, JSON.stringify(enable.body));
    const editor = await account(["read", "create", "update"], "editor");
    const designer = await account(["read", "create", "update", "design"], "designer");
    const publisher = await account(["read", "create", "update", "publish"], "publisher");
    const capability = (await request("/config/admin", editor)).body.data.builder.contentEditing;
    assert.equal(capability.policy, "protected");
    assert.equal(capability.canDesign, false);
    assert.equal(capability.canPublish, false);

    const creation = await request("/cms/pages", owner, "POST", {
      slug, title: "Protected page", status: "DRAFT", sections: [{
        key: "main", label: "Main", settings: { layout: "one-column", style: { radius: 8 } },
        blocks: [{ key: "copy", label: "Headline", type: "TEXT", value: "Original", settings: { customCss: "color: #123456" } }]
      }]
    });
    assert.equal(creation.status, 201, JSON.stringify(creation.body));
    let page = creation.body.data.page;
    const initialVersion = page.updatedAt;
    const originalSettings = page.sections[0].settings;
    const endpoint = `/cms/pages/${slug}`;
    const update = (token: string, data: unknown) => request(`${endpoint}/blocks/copy`, token, "PATCH", data);
    const missing = await update(editor, { value: "Missing version" });
    assert.equal(missing.status, 428, JSON.stringify(missing.body));
    assert.equal(missing.body.error.code, "cms_version_required");
    const saved = await update(editor, { value: "Editor copy", expectedUpdatedAt: page.updatedAt });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    page = saved.body.data.page;
    assert.notEqual(page.updatedAt, initialVersion);
    assert.deepEqual(page.sections[0].settings, originalSettings);
    const stale = await update(editor, { value: "Stale copy", expectedUpdatedAt: initialVersion });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, "cms_content_conflict");

    for (const result of [
      await update(editor, { settings: { customCss: "display: none" }, expectedUpdatedAt: page.updatedAt }),
      await request(endpoint, editor, "PATCH", { sections: [], expectedUpdatedAt: page.updatedAt }),
      await request(`${endpoint}/sections`, editor, "POST", { key: "extra", blocks: [], expectedUpdatedAt: page.updatedAt }),
      await request(`${endpoint}/publish`, designer, "POST", { expectedUpdatedAt: page.updatedAt }),
      await request("/cms/publishing/run", editor, "POST", {})
    ]) assert.equal(result.status, 403, JSON.stringify(result.body));
    assert.equal((await request(endpoint, owner)).body.data.page.updatedAt, page.updatedAt);

    const designed = await update(designer, { settings: { customCss: "color: #654321" }, expectedUpdatedAt: page.updatedAt });
    assert.equal(designed.status, 200, JSON.stringify(designed.body));
    page = designed.body.data.page;
    const published = await request(`${endpoint}/publish`, publisher, "POST", { expectedUpdatedAt: page.updatedAt });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    page = published.body.data.page;
    assert.equal((await update(editor, { value: "Not allowed live", expectedUpdatedAt: page.updatedAt })).status, 403);
    assert.equal((await update(designer, { value: "Designer cannot publish", expectedUpdatedAt: page.updatedAt })).status, 403);
    assert.equal((await update(publisher, { settings: {}, expectedUpdatedAt: page.updatedAt })).status, 403);

    const concurrent = await Promise.all([
      update(publisher, { value: "Concurrent A", expectedUpdatedAt: page.updatedAt }),
      update(publisher, { value: "Concurrent B", expectedUpdatedAt: page.updatedAt })
    ]);
    assert.deepEqual(concurrent.map((result) => result.status).sort(), [200, 409]);
    page = concurrent.find((result) => result.status === 200)!.body.data.page;
    const html = await (await fetch(`${base}/${slug}`)).text();
    assert.match(html, /data-server-rendered="true"/);
    assert.ok(html.includes(page.sections[0].blocks[0].value));
    const revisions = (await request(`${endpoint}/revisions`, owner)).body.data.revisions;
    assert.equal((await request(`${endpoint}/revisions/${revisions[0].id}/restore`, publisher, "POST", { expectedUpdatedAt: page.updatedAt })).status, 403);

    const post = await request("/cms/posts", editor, "POST", { slug, title: "Draft post", content: { body: "Draft copy", category: "News", image: null } });
    assert.equal(post.status, 201, JSON.stringify(post.body));
    const postVersion = post.body.data.post.updatedAt;
    const postPath = `/cms/posts/${slug}`;
    const postSave = await request(postPath, editor, "PATCH", { content: { body: "Revised draft", category: "News", image: null }, expectedUpdatedAt: postVersion });
    assert.equal(postSave.status, 200, JSON.stringify(postSave.body));
    assert.equal((await request(postPath, editor, "PATCH", { title: "Stale", expectedUpdatedAt: postVersion })).status, 409);
    assert.equal((await request(postPath, editor, "PATCH", { content: { layout: "wide" }, expectedUpdatedAt: postSave.body.data.post.updatedAt })).status, 403);

    const disable = await request("/config/site-settings", owner, "PATCH", { ...config.siteSettings, editingPolicy: "standard" });
    assert.equal(disable.status, 200);
    const legacy = await request(endpoint, editor, "PATCH", { sections: [], title: "Legacy edit without version" });
    assert.equal(legacy.status, 200, JSON.stringify(legacy.body));
    assert.equal(legacy.body.data.page.sections.length, 0);
  } finally {
    await prisma.cmsPage.deleteMany({ where: { slug } });
    await prisma.cmsPost.deleteMany({ where: { slug } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.role.deleteMany({ where: { id: { in: roles } } });
    if (setting) await prisma.moduleSetting.update({ where: { id: setting.id }, data: { value: setting.value as object } });
    else await prisma.moduleSetting.deleteMany({ where: { siteId: site.id, moduleId: "config", key: "site" } });
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.$disconnect();
  }
});
