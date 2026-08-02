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

test("dashboard email settings can safely enable account recovery", async () => {
  const harness = emailSettingsHarness({}, true);
  const status = await harness.service.update({
    enabled: true,
    provider: "resend",
    recoveryEnabled: true,
    from: "notifications@example.com",
    bearerToken: "resend-api-key"
  });

  assert.equal(status.provider, "resend");
  assert.equal(status.recoveryEnabled, true);
  assert.equal(status.httpEndpoint, "");
  assert.equal((await harness.service.resolve()).httpEndpoint, "https://api.resend.com/emails");
});

test("changing a preset provider requires a fresh API key", async () => {
  const harness = emailSettingsHarness();
  await harness.service.update({
    enabled: true,
    provider: "resend",
    from: "notifications@example.com",
    bearerToken: "resend-api-key"
  });

  await assert.rejects(
    harness.service.update({ enabled: true, provider: "postmark" }),
    /new postmark API key/i
  );
});

test("saving an unchanged preset preserves its successful provider test", async () => {
  const harness = emailSettingsHarness();
  await harness.service.update({
    enabled: true,
    provider: "resend",
    recoveryEnabled: true,
    from: "notifications@example.com",
    bearerToken: "resend-api-key"
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ id: "resend-message-1" }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });

  try {
    await harness.service.test("owner@example.com");
    const tested = await harness.service.getAdminStatus();
    assert.equal(tested.lastTestSucceeded, true);

    const saved = await harness.service.update({
      enabled: true,
      provider: "resend",
      recoveryEnabled: true,
      from: "notifications@example.com"
    });
    assert.equal(saved.lastTestSucceeded, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test("Postmark preset sends the provider-native request", async () => {
  const harness = emailSettingsHarness();
  await harness.service.update({
    enabled: true,
    provider: "postmark",
    from: "notifications@example.com",
    bearerToken: "postmark-server-token"
  });

  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestHeaders: Headers | undefined;
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestHeaders = new Headers(init?.headers);
    requestBody = JSON.parse(String(init?.body || "{}"));
    return new Response(JSON.stringify({ MessageID: "postmark-message-1" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const result = await harness.service.test("owner@example.com");
    assert.equal(requestUrl, "https://api.postmarkapp.com/email");
    assert.equal(requestHeaders?.get("x-postmark-server-token"), "postmark-server-token");
    assert.equal(requestHeaders?.has("authorization"), false);
    assert.equal(requestBody.To, "owner@example.com");
    assert.equal(requestBody.MessageStream, "outbound");
    assert.equal(result.providerMessageId, "postmark-message-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Resend preset sends the provider-native request", async () => {
  const harness = emailSettingsHarness();
  await harness.service.update({
    enabled: true,
    provider: "resend",
    from: "notifications@example.com",
    bearerToken: "resend-api-key"
  });

  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestHeaders: Headers | undefined;
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestHeaders = new Headers(init?.headers);
    requestBody = JSON.parse(String(init?.body || "{}"));
    return new Response(JSON.stringify({ id: "resend-message-1" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const result = await harness.service.test("owner@example.com");
    assert.equal(requestUrl, "https://api.resend.com/emails");
    assert.equal(requestHeaders?.get("authorization"), "Bearer resend-api-key");
    assert.deepEqual(requestBody.to, ["owner@example.com"]);
    assert.equal(requestBody.from, "notifications@example.com");
    assert.equal(result.providerMessageId, "resend-message-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
