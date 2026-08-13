import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import type { PrismaClient } from "@prisma/client";
import {
  normalizePublicMediaStorageKey,
  registerPublicMediaRoutes
} from "../src/core/public-media-router.js";
import { normalizeAllowedOrigin } from "../src/core/security-middleware.js";
import { AuthEmailService } from "../src/modules/auth/auth-email.service.js";
import { AuthService } from "../src/modules/auth/auth.service.js";
import { hashToken, parseDurationToSeconds } from "../src/modules/auth/auth-token.js";
import { detectContactSpam } from "../src/modules/cms/contact-submission.service.js";
import {
  normalizeRedirectSource,
  normalizeRedirectTarget
} from "../src/modules/cms/redirect.service.js";

test("security origins normalize without preserving paths", () => {
  assert.equal(normalizeAllowedOrigin("https://cms.example.com/admin/"), "https://cms.example.com");
  assert.equal(normalizeAllowedOrigin("custom-origin///"), "custom-origin");
  assert.equal(normalizeAllowedOrigin(undefined), undefined);
});

test("public media keys stay inside the configured prefix", () => {
  assert.equal(
    normalizePublicMediaStorageKey("sites/default/media/photo.png", "sites/default"),
    "sites/default/media/photo.png"
  );
  assert.equal(normalizePublicMediaStorageKey("sites/other/photo.png", "sites/default"), "");
  assert.equal(normalizePublicMediaStorageKey("sites/default/%2e%2e/secret", "sites/default"), "");
  assert.equal(normalizePublicMediaStorageKey("%E0%A4%A", "sites/default"), "");
});

test("dashboard cloud storage remains reachable after local bootstrap", async () => {
  const localRoot = await mkdtemp(path.join(tmpdir(), "codey-local-bootstrap-"));
  const app = express();
  const runtimeStorage = {
    driver: "s3",
    keyPrefix: "sites/default",
    imageVariantWidths: [320],
    signedUrlTtlSeconds: 900
  };
  const adapter = {
    enabled: true,
    createDownloadUrl: async () => ({ url: "data:image/png,cloud-media" })
  };
  const config = {
    storage: {
      driver: "local",
      keyPrefix: "sites/default",
      imageVariantWidths: [320]
    }
  };

  registerPublicMediaRoutes(app, config as never, localRoot, {
    adapter: adapter as never,
    getRuntimeConfig: () => runtimeStorage as never
  });
  const server = app.listen(0, "127.0.0.1");

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    assert(address && typeof address === "object");
    const response = await fetch(
      `http://127.0.0.1:${address.port}/uploads/sites/default/media/new.png`
    );
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "cloud-media");
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
    await rm(localRoot, { recursive: true, force: true });
  }
});

test("contact spam rules remain independent from CMS page persistence", () => {
  const base = {
    formKey: "contact",
    name: "Ada",
    email: "ada@example.com",
    message: "Hello"
  };
  assert.equal(detectContactSpam({ ...base, website: "https://spam.example" }), "honeypot");
  assert.equal(detectContactSpam({ ...base, startedAt: new Date(9_000) }, new Date(10_000)), "too_fast");
  assert.equal(
    detectContactSpam({ ...base, message: "http://a.test http://b.test http://c.test http://d.test" }),
    "too_many_links"
  );
  assert.equal(detectContactSpam(base), null);
});

test("redirect normalization preserves the existing local and external contract", () => {
  assert.throws(() => normalizeRedirectSource("//docs"), /local path/);
  assert.equal(normalizeRedirectSource("/docs/"), "/docs");
  assert.equal(normalizeRedirectTarget("docs?q=1#start"), "/docs?q=1#start");
  assert.equal(normalizeRedirectTarget("https://example.com/docs"), "https://example.com/docs");
  assert.throws(() => normalizeRedirectTarget("javascript:alert(1)"), /local path or an HTTP URL/);
});

test("auth token utilities and manual invite delivery keep their public behavior", () => {
  assert.equal(parseDurationToSeconds("15m"), 900);
  assert.equal(hashToken("token"), hashToken("token"));
  assert.notEqual(hashToken("token"), "token");

  const email = new AuthEmailService({} as PrismaClient, {
    app: { name: "CodeY", publicUrl: "https://cms.example.com" },
    auth: { recoveryTokenDelivery: "email" },
    isProduction: true
  } as never);
  assert.deepEqual(email.inviteDelivery("secret token", false), {
    delivery: "manual",
    inviteUrl: "https://cms.example.com/auth/invite?token=secret%20token"
  });
  assert.equal(email.exposeSensitiveToken("secret token"), undefined);
});

test("the auth facade preserves registration policy before delegating use cases", async () => {
  const service = new AuthService({} as PrismaClient, {
    auth: { allowRegistration: false }
  } as never);

  await assert.rejects(
    service.register({ email: "user@example.com", password: "StrongPass123!" }, {}),
    (error: unknown) => Boolean(
      error && typeof error === "object" && "code" in error && error.code === "registration_disabled"
    )
  );
});
