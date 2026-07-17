import assert from "node:assert/strict";
import test from "node:test";
import { EmailSettingsService } from "../src/infrastructure/email/email-settings.service.js";
import { emailSettingsSchema } from "../src/modules/config/config.schemas.js";

function emailSettingsHarness(environmentEmail: Record<string, unknown> = {}, isProduction = false) {
  let storedValue: unknown = null;
  const prisma = {
    site: {
      upsert: async () => ({ id: "site-1" })
    },
    moduleSetting: {
      findUnique: async () => storedValue ? { value: storedValue } : null,
      upsert: async (input: { update: { value: unknown } }) => {
        storedValue = input.update.value;
        return { value: storedValue };
      }
    }
  };
  const config = {
    isProduction,
    app: {
      name: "Test CMS",
      mode: "cms",
      publicUrl: "https://cms.example.com"
    },
    auth: {
      recoveryTokenDelivery: "email"
    },
    email: {
      driver: "disabled",
      timeoutMs: 1_000,
      ...environmentEmail
    },
    payments: {
      credentialEncryptionKey: "test-credential-encryption-key-32-chars"
    }
  };

  return {
    service: new EmailSettingsService(prisma as never, config as never),
    storedValue: () => storedValue
  };
}

test("email settings only accept HTTP endpoints and require HTTPS in production", async () => {
  const parsed = emailSettingsSchema.safeParse({
    enabled: true,
    from: "notifications@example.com",
    httpEndpoint: "ftp://mailer.example.com/send"
  });
  assert.equal(parsed.success, false);

  const harness = emailSettingsHarness({}, true);
  await assert.rejects(
    harness.service.update({
      enabled: true,
      from: "notifications@example.com",
      httpEndpoint: "http://mailer.example.com/send"
    }),
    /HTTPS in production/i
  );
});

test("email settings encrypt credentials and never return the bearer token", async () => {
  const harness = emailSettingsHarness();
  const status = await harness.service.update({
    enabled: true,
    from: "notifications@example.com",
    httpEndpoint: "https://mailer.example.com/send",
    bearerToken: "secret-email-token"
  });
  const stored = harness.storedValue() as Record<string, unknown>;

  assert.equal(status.configured, true);
  assert.equal(status.bearerTokenConfigured, true);
  assert.doesNotMatch(JSON.stringify(status), /secret-email-token/);
  assert.equal(typeof stored.encryptedCredentials, "string");
  assert.doesNotMatch(String(stored.encryptedCredentials), /secret-email-token/);
  assert.equal((await harness.service.resolve()).httpBearerToken, "secret-email-token");
});

test("email connection tests use saved settings and record provider health", async () => {
  const harness = emailSettingsHarness();
  await harness.service.update({
    enabled: true,
    from: "notifications@example.com",
    httpEndpoint: "https://mailer.example.com/send",
    bearerToken: "secret-email-token"
  });

  const originalFetch = globalThis.fetch;
  let requestHeaders: Headers | undefined;
  globalThis.fetch = async (_input, init) => {
    requestHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({ id: "message-1" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const result = await harness.service.test("owner@example.com");
    const status = await harness.service.getAdminStatus();

    assert.equal(result.succeeded, true);
    assert.equal(result.providerMessageId, "message-1");
    assert.equal(requestHeaders?.get("authorization"), "Bearer secret-email-token");
    assert.equal(status.lastTestSucceeded, true);
    assert.ok(status.lastTestedAt);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
