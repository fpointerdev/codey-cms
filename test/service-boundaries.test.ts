import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { normalizePublicMediaStorageKey } from "../src/core/public-media-router.js";
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
