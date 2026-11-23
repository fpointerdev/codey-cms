import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcryptjs";
import express from "express";
import { gzipSync } from "node:zlib";
import { hashPassword, newPasswordSchema, verifyPassword } from "../src/core/security/password.js";
import { createRequestBodyParser } from "../src/core/http/body-parser.js";
import type { ModuleContext } from "../src/core/types/module.js";
import { changePasswordSchema, registerSchema, confirmPasswordResetSchema, acceptInviteSchema } from "../src/modules/auth/auth.schemas.js";
import { completeInstallationSchema } from "../src/modules/installation/installation.schemas.js";
import { updateProductSchema, updateProductCategorySchema, updateProductAttributeSchema } from "../src/modules/products/products.schemas.js";
import { updateCmsCategorySchema, updateCmsPageSchema, updateCmsPostSchema, updateMenuItemSchema, updateRedirectSchema } from "../src/modules/cms/cms.schemas.js";
import { updateContentCollectionSchema } from "../src/modules/cms/content-models.schemas.js";
import { updateRoleSchema } from "../src/modules/roles/roles.schemas.js";
import { AuthService } from "../src/modules/auth/auth.service.js";
import { AppError } from "../src/core/errors/app-error.js";

test("new passwords cannot be silently truncated, including multibyte characters", async () => {
  assert.equal(newPasswordSchema().safeParse("a".repeat(72)).success, true);
  for (const password of ["a".repeat(73), "\u00e9".repeat(37)]) {
    assert.equal(newPasswordSchema().safeParse(password).success, false);
    assert.equal(registerSchema.safeParse({ email: "test@example.com", password }).success, false);
    assert.equal(confirmPasswordResetSchema.safeParse({ token: "t".repeat(40), password }).success, false);
    assert.equal(acceptInviteSchema.safeParse({ token: "t".repeat(40), password }).success, false);
    assert.equal(changePasswordSchema.safeParse({ currentPassword: "old-password", newPassword: password }).success, false);
    assert.equal(completeInstallationSchema.safeParse({ siteName: "Test site", admin: { name: "Owner", email: "owner@example.com", password } }).success, false);
    assert.throws(() => hashPassword(password), /72 UTF-8 bytes/);
  }
  const legacy = "a".repeat(72) + "old suffix";
  const legacyHash = await bcrypt.hash(legacy, 4);
  assert.equal(await verifyPassword(legacy, legacyHash), true);
  const replacementHash = await hashPassword("A genuinely different password");
  assert.equal(await verifyPassword(legacy, replacementHash), false);
});

test("partial updates preserve omitted fields after the Zod upgrade", () => {
  for (const schema of [updateProductSchema, updateProductCategorySchema, updateProductAttributeSchema, updateCmsPageSchema, updateCmsPostSchema, updateCmsCategorySchema, updateMenuItemSchema, updateRedirectSchema]) {
    assert.deepEqual(schema.parse({}), {});
  }
  assert.equal(updateRoleSchema.safeParse({}).success, false);
  assert.equal(updateContentCollectionSchema.safeParse({}).success, false);
  assert.deepEqual(updateContentCollectionSchema.parse({ name: "Changed" }), { name: "Changed" });
  assert.deepEqual(updateProductSchema.parse({ name: "Changed" }), { name: "Changed" });
  assert.deepEqual(updateCmsPageSchema.parse({ title: "Changed" }), { title: "Changed" });
});

test("body budgets reject oversized and compressed requests before route work", async (t) => {
  t.mock.method(AuthService.prototype, "verifyAccessToken", async (token: string) => {
    if (token !== "valid") throw new AppError(401, "unauthorized", "Invalid token.");
    return { id: "test-user" };
  });
  const context = { config: { storage: { requestBodyLimit: "1mb" } } } as ModuleContext;
  const app = express();
  app.use("/api/v1", createRequestBodyParser(context));
  app.use((req, res) => res.json({ raw: Boolean(req.rawBody), parsed: Boolean(req.body) }));
  app.use((error: { status?: number; statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.statusCode || error.status || 500).end();
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const send = (route: string, body: string | Buffer, headers = {}) => fetch(`http://127.0.0.1:${address.port}${route}`, {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body
  });
  try {
    assert.equal((await send("/api/v1/auth/login", JSON.stringify({ text: "a".repeat(17_000) }))).status, 413);
    assert.equal((await send("/api/v1/orders/lookup", JSON.stringify({ text: "a".repeat(270_000) }))).status, 413);
    assert.equal((await send("/api/v1/cms/media/upload", "{}" )).status, 401);
    assert.equal((await send("/api/v1/config/generation/apply", "{}" )).status, 401);
    assert.equal((await send("/api/v1/products", "{}" )).status, 401);
    for (const authorization of ["Basic invalid", "Bearer ", "Bearer invalid"]) {
      assert.equal((await send("/api/v1/cms/media/upload", "{}", { authorization })).status, 401);
    }
    assert.equal((await send("/api/v1/config/generation/apply", JSON.stringify({ text: "a".repeat(300_000) }), { authorization: "Bearer valid" })).status, 200);
    assert.equal((await send("/api/v1/products", JSON.stringify({ text: "a".repeat(300_000) }), { authorization: "Bearer valid" })).status, 200);
    assert.equal((await send("/api/v1/cms/media/upload", JSON.stringify({ text: "a".repeat(1_100_000) }), { authorization: "Bearer valid" })).status, 413);
    assert.equal((await send("/api/v1/auth/login", gzipSync("{}"), { "content-encoding": "gzip" })).status, 415);
    const formHeaders = { "content-type": "application/x-www-form-urlencoded" };
    assert.equal((await send("/api/v1/orders/lookup", Array.from({ length: 101 }, (_, index) => `field${index}=1`).join("&"), formHeaders)).status, 413);
    assert.equal((await send("/api/v1/orders/lookup", "a[b][c][d][e][f][g]=1", formHeaders)).status, 400);
    assert.equal((await send("/api/v1/orders/lookup", "name=Alice", formHeaders)).status, 200);
    assert.equal((await send("/api/v1/payments/webhooks/stripe", JSON.stringify({ text: "a".repeat(1_100_000) }))).status, 413);
    assert.deepEqual(await (await send("/api/v1/orders/lookup", "{}")).json(), { raw: false, parsed: true });
    assert.deepEqual(await (await send("/api/v1/payments/webhooks/stripe", "{}")).json(), { raw: true, parsed: true });
    assert.deepEqual(await (await send("/api/v1/payments/webhooks/paypal", "{}")).json(), { raw: true, parsed: true });
    assert.deepEqual(await (await send("/not-an-api-route", "{}")).json(), { raw: false, parsed: false });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
