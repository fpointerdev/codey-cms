import assert from "node:assert/strict";
import test from "node:test";
import { EmailSettingsService } from "../src/infrastructure/email/email-settings.service.js";
import {
  assertSafeEmailEndpoint,
  isPublicEmailAddress,
  parseEmailEndpoint
} from "../src/infrastructure/email/http-email.js";
import { assertRecentSensitiveAuthentication } from "../src/modules/auth/auth.middleware.js";
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

test("email endpoints reject URL credentials and fragments", async () => {
  assert.throws(
    () => parseEmailEndpoint("https://user:password@mailer.example.com/send"),
    /URL credentials/i
  );
  assert.throws(
    () => parseEmailEndpoint("https://mailer.example.com/send#token"),
    /fragment/i
  );

  const harness = emailSettingsHarness();
  await assert.rejects(
    harness.service.update({ httpEndpoint: "https://mailer.example.com/send#token" }),
    /fragment/i
  );
});

test("production email endpoints resolve only to public addresses", async () => {
  assert.equal(isPublicEmailAddress("127.0.0.1"), false);
  assert.equal(isPublicEmailAddress("::1"), false);
  assert.equal(isPublicEmailAddress("10.20.30.40"), false);
  assert.equal(isPublicEmailAddress("169.254.169.254"), false);
  assert.equal(isPublicEmailAddress("2606:4700:4700::1111"), true);

  await assert.rejects(
    assertSafeEmailEndpoint("https://127.0.0.1/send", { requireHttps: true }),
    /public address/i
  );
  await assert.rejects(
    assertSafeEmailEndpoint("https://[::1]/send", { requireHttps: true }),
    /public address/i
  );
  await assert.rejects(
    assertSafeEmailEndpoint("https://mailer.example.com/send", {
      requireHttps: true,
      lookup: async () => [{ address: "10.10.0.4", family: 4 }]
    }),
    /public addresses/i
  );
  const endpoint = await assertSafeEmailEndpoint("https://mailer.example.com/send", {
    requireHttps: true,
    lookup: async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 }
    ]
  });
  assert.equal(endpoint.toString(), "https://mailer.example.com/send");
});

test("secret changes require recent authentication at the service boundary", async () => {
  const now = Date.now();
  const baseUser = {
    id: "user-1",
    email: "owner@example.com",
    name: "Owner",
    roles: ["owner"],
    permissions: [{ action: "manage", subject: "all" }]
  };
  assert.doesNotThrow(() => assertRecentSensitiveAuthentication({
    ...baseUser,
    mfaEnabled: false,
    authenticatedAt: new Date(now - 60_000)
  }, now));
  assert.throws(() => assertRecentSensitiveAuthentication({
    ...baseUser,
    mfaEnabled: false,
    authenticatedAt: new Date(now - 16 * 60_000)
  }, now), /Sign in again/i);
  assert.doesNotThrow(() => assertRecentSensitiveAuthentication({
    ...baseUser,
    mfaEnabled: true,
    authenticatedAt: new Date(now - 60_000),
    mfaVerifiedAt: new Date(now - 60_000)
  }, now));
  assert.throws(() => assertRecentSensitiveAuthentication({
    ...baseUser,
    mfaEnabled: true,
    authenticatedAt: new Date(now - 60_000),
    mfaVerifiedAt: null
  }, now), /two-step verification/i);
});

test("endpoint and credential changes require sensitive authorization", async () => {
  const harness = emailSettingsHarness();
  await harness.service.update({
    enabled: true,
    provider: "generic",
    from: "notifications@example.com",
    httpEndpoint: "https://mailer.example.com/send",
    bearerToken: "email-token"
  });

  assert.equal(await harness.service.requiresSensitiveAuthorization({
    from: "accounts@example.com"
  }), false);
  assert.equal(await harness.service.requiresSensitiveAuthorization({
    httpEndpoint: "https://other-mailer.example.com/send"
  }), true);
  assert.equal(await harness.service.requiresSensitiveAuthorization({
    bearerToken: "replacement-token"
  }), true);
  assert.equal(await harness.service.requiresSensitiveAuthorization({
    clearBearerToken: true
  }), true);
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

test("changing a generic endpoint invalidates its bound credential", async () => {
  const harness = emailSettingsHarness();
  await harness.service.update({
    enabled: true,
    provider: "generic",
    from: "notifications@example.com",
    httpEndpoint: "https://mailer-a.example.com/send",
    bearerToken: "endpoint-a-token"
  });
  await harness.service.update({ enabled: false });

  const changed = await harness.service.update({
    httpEndpoint: "https://mailer-b.example.com/send"
  });
  const stored = harness.storedValue() as Record<string, unknown>;

  assert.equal(changed.enabled, false);
  assert.equal(changed.bearerTokenConfigured, false);
  assert.equal(stored.encryptedCredentials, undefined);
  assert.equal(stored.credentialsRequired, true);
  assert.equal((await harness.service.resolve()).httpBearerToken, undefined);

  const originalFetch = globalThis.fetch;
  let requests = 0;
  let requestUrl = "";
  let authorization: string | null = null;
  globalThis.fetch = async (input, init) => {
    requests += 1;
    requestUrl = String(input);
    authorization = new Headers(init?.headers).get("authorization");
    return new Response(JSON.stringify({ id: "unexpected" }), { status: 200 });
  };

  try {
    await assert.rejects(
      harness.service.test("owner@example.com"),
      /save and enable transactional email/i
    );
    await assert.rejects(
      harness.service.update({ enabled: true }),
      /new bearer token/i
    );
    assert.equal(requests, 0);

    await harness.service.update({ enabled: true, bearerToken: "endpoint-b-token" });
    await harness.service.test("owner@example.com");
    assert.equal(requests, 1);
    assert.equal(requestUrl, "https://mailer-b.example.com/send");
    assert.equal(authorization, "Bearer endpoint-b-token");
    assert.notEqual(authorization, "Bearer endpoint-a-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("equivalent endpoints and unrelated settings preserve the bound credential", async () => {
  const harness = emailSettingsHarness();
  await harness.service.update({
    enabled: true,
    provider: "generic",
    recoveryEnabled: false,
    from: "notifications@example.com",
    httpEndpoint: "https://MAILER.example.com:443/old/../send",
    bearerToken: "preserved-email-token"
  });

  const status = await harness.service.update({
    recoveryEnabled: true,
    from: "accounts@example.com",
    httpEndpoint: "https://mailer.example.com/send"
  });
  const resolved = await harness.service.resolve();

  assert.equal(status.from, "accounts@example.com");
  assert.equal(status.recoveryEnabled, true);
  assert.equal(status.httpEndpoint, "https://mailer.example.com/send");
  assert.equal(resolved.httpBearerToken, "preserved-email-token");
  assert.equal(resolved.credentialsRequired, false);
});

test("changing an established credential-free endpoint still requires a fresh binding", async () => {
  const harness = emailSettingsHarness();
  await harness.service.update({
    enabled: true,
    provider: "generic",
    from: "notifications@example.com",
    httpEndpoint: "https://mailer-a.example.com/send"
  });
  await harness.service.update({ enabled: false });

  const changed = await harness.service.update({
    httpEndpoint: "https://mailer-b.example.com/send"
  });

  assert.equal(changed.bearerTokenConfigured, false);
  assert.equal((harness.storedValue() as Record<string, unknown>).credentialsRequired, true);
  await assert.rejects(
    harness.service.update({ enabled: true }),
    /new bearer token/i
  );
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

test("generic email requests do not follow redirects or expose provider-echoed credentials", async () => {
  const harness = emailSettingsHarness();
  const credential = "redirect-secret-email-token";
  await harness.service.update({
    enabled: true,
    provider: "generic",
    from: "notifications@example.com",
    httpEndpoint: "https://mailer.example.com/send",
    bearerToken: credential
  });

  const originalFetch = globalThis.fetch;
  let redirect: RequestRedirect | undefined;
  globalThis.fetch = async (_input, init) => {
    redirect = init?.redirect;
    return new Response(credential, {
      status: 302,
      headers: { location: "https://attacker.example.com/collect" }
    });
  };

  try {
    let failure: unknown;
    try {
      await harness.service.test("owner@example.com");
    } catch (error) {
      failure = error;
    }

    assert.equal(redirect, "manual");
    assert.ok(failure);
    assert.doesNotMatch(JSON.stringify(failure), new RegExp(credential));
    assert.doesNotMatch(JSON.stringify(await harness.service.getAdminStatus()), new RegExp(credential));
    assert.doesNotMatch(JSON.stringify(harness.storedValue()), new RegExp(credential));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider message IDs cannot echo the configured credential", async () => {
  const harness = emailSettingsHarness();
  const credential = "provider-response-secret";
  await harness.service.update({
    enabled: true,
    provider: "generic",
    from: "notifications@example.com",
    httpEndpoint: "https://mailer.example.com/send",
    bearerToken: credential
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ id: `message-${credential}` }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });

  try {
    const result = await harness.service.test("owner@example.com");
    assert.equal(result.providerMessageId, undefined);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(credential));
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
