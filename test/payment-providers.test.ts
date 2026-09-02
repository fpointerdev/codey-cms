import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { AppError } from "../src/core/errors/app-error.js";
import type { AuthenticatedUser } from "../src/modules/auth/auth.types.js";
import {
  decryptPaymentCredentials,
  encryptPaymentCredentials
} from "../src/modules/payments/payment-credentials.js";
import {
  createPayPalRefund,
  createPayPalOrder,
  normalizePayPalWebhook,
  payPalOrderReferenceForCapture,
  retrievePayPalCapture,
  testPayPalConnection
} from "../src/modules/payments/paypal-provider.js";
import {
  createPaymentRefundSchema,
  createPaymentIntentSchema,
  updatePaymentProviderConfigSchema
} from "../src/modules/payments/payments.schemas.js";
import {
  paymentProviderConfigRevision,
  PaymentProviderConfigService
} from "../src/modules/payments/payment-provider-config.service.js";
import { assertSensitivePaymentProviderAccess } from "../src/modules/payments/payments.routes.js";
import {
  createStripeRefund,
  createStripePaymentIntent,
  normalizeStripeWebhook,
  retrieveStripePaymentIntent,
  verifyStripeWebhook
} from "../src/modules/payments/stripe-provider.js";

const encryptionKey = "test-payment-encryption-key-with-32-characters";

test("payment credentials are encrypted and authenticated", () => {
  const credentials = {
    secretKey: "sk_test_private",
    webhookSecret: "whsec_private"
  };
  const encrypted = encryptPaymentCredentials(encryptionKey, credentials);

  assert.equal(encrypted.includes(credentials.secretKey), false);
  assert.deepEqual(decryptPaymentCredentials(encryptionKey, encrypted), credentials);
  assert.throws(
    () => decryptPaymentCredentials(`${encryptionKey}-wrong`, encrypted),
    (error) => error instanceof AppError && error.code === "payment_credentials_unavailable"
  );
});

test("Stripe webhook signatures use the raw body and reject expired events", () => {
  const event = {
    id: "evt_123",
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: "pi_123",
        amount: 2599,
        currency: "eur",
        metadata: { paymentId: "payment_123" }
      }
    }
  };
  const rawBody = Buffer.from(JSON.stringify(event));
  const timestamp = 1_750_000_000;
  const webhookSecret = "whsec_test";
  const signature = createHmac("sha256", webhookSecret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest("hex");
  const verified = verifyStripeWebhook({
    rawBody,
    signatureHeader: `t=${timestamp},v1=${signature}`,
    webhookSecret,
    now: timestamp + 30
  });

  assert.equal(verified.id, event.id);
  assert.deepEqual(normalizeStripeWebhook(verified), {
    provider: "STRIPE",
    eventType: "payment.succeeded",
    providerEventId: "evt_123",
    providerReference: "pi_123",
    paymentId: "payment_123",
    amountCents: 2599,
    currency: "EUR",
    fullRefund: false,
    refundAmountIsCumulative: false,
    payload: event
  });
  assert.throws(
    () => verifyStripeWebhook({
      rawBody,
      signatureHeader: `t=${timestamp},v1=${signature}`,
      webhookSecret,
      now: timestamp + 301
    }),
    (error) => error instanceof AppError && error.code === "stripe_signature_expired"
  );
});

test("a failed Stripe attempt keeps the reusable PaymentIntent active", () => {
  assert.equal(normalizeStripeWebhook({
    id: "evt_failed_attempt",
    type: "payment_intent.payment_failed",
    data: {
      object: {
        id: "pi_retryable",
        status: "requires_payment_method"
      }
    }
  }), null);
});

test("Stripe intent requests preserve minor units and idempotency", async () => {
  let called = false;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    called = true;
    assert.equal(String(input), "https://api.stripe.com/v1/payment_intents");
    assert.equal(init?.method, "POST");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer sk_test_private");
    assert.equal(headers.get("idempotency-key"), "payment_123");
    const body = init?.body as URLSearchParams;
    assert.equal(body.get("amount"), "2599");
    assert.equal(body.get("currency"), "eur");
    assert.equal(body.get("metadata[orderId]"), "order_123");

    return new Response(JSON.stringify({
      id: "pi_123",
      object: "payment_intent",
      amount: 2599,
      currency: "eur",
      client_secret: "pi_123_secret_value",
      status: "requires_payment_method"
    }), { status: 200 });
  }) as typeof fetch;

  const intent = await createStripePaymentIntent({
    secretKey: "sk_test_private",
    paymentId: "payment_123",
    orderId: "order_123",
    orderNumber: "CY-1001",
    amountCents: 2599,
    currency: "EUR",
    fetchImpl
  });

  assert.equal(called, true);
  assert.equal(intent.id, "pi_123");
});

test("Stripe refund requests preserve amount, reason, metadata, and idempotency", async () => {
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), "https://api.stripe.com/v1/refunds");
    assert.equal(init?.method, "POST");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer sk_test_private");
    assert.equal(headers.get("idempotency-key"), "refund_123");
    const body = init?.body as URLSearchParams;
    assert.equal(body.get("payment_intent"), "pi_123");
    assert.equal(body.get("amount"), "500");
    assert.equal(body.get("reason"), "requested_by_customer");
    assert.equal(body.get("metadata[paymentId]"), "payment_123");
    assert.equal(body.get("metadata[refundId]"), "refund_123");

    return new Response(JSON.stringify({
      id: "re_123",
      object: "refund",
      amount: 500,
      currency: "eur",
      payment_intent: "pi_123",
      status: "succeeded"
    }), { status: 200 });
  }) as typeof fetch;

  const refund = await createStripeRefund({
    secretKey: "sk_test_private",
    paymentIntentId: "pi_123",
    paymentId: "payment_123",
    refundId: "refund_123",
    amountCents: 500,
    reason: "requested_by_customer",
    fetchImpl
  });

  assert.equal(refund.id, "re_123");
});

test("Stripe payment intent lookup encodes provider references", async () => {
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), "https://api.stripe.com/v1/payment_intents/pi_test%2Fencoded");
    assert.equal(init?.method, "GET");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer sk_test_private");
    return new Response(JSON.stringify({
      id: "pi_test/encoded",
      object: "payment_intent",
      amount: 500,
      currency: "eur",
      status: "processing"
    }), { status: 200 });
  }) as typeof fetch;

  const intent = await retrieveStripePaymentIntent({
    secretKey: "sk_test_private",
    providerReference: "pi_test/encoded",
    fetchImpl
  });

  assert.equal(intent.status, "processing");
});

test("Stripe refund requests omit an unspecified provider reason", async () => {
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = init?.body as URLSearchParams;
    assert.equal(body.has("reason"), false);
    return new Response(JSON.stringify({
      id: "re_without_reason",
      object: "refund",
      amount: 500,
      currency: "eur",
      payment_intent: "pi_123",
      status: "pending"
    }), { status: 200 });
  }) as typeof fetch;

  const refund = await createStripeRefund({
    secretKey: "sk_test_private",
    paymentIntentId: "pi_123",
    paymentId: "payment_123",
    refundId: "refund_without_reason",
    amountCents: 500,
    fetchImpl
  });

  assert.equal(refund.status, "pending");
});

test("Stripe partial refund webhooks use the cumulative refunded amount", () => {
  const normalized = normalizeStripeWebhook({
    id: "evt_partial_refund",
    type: "charge.refunded",
    data: {
      object: {
        id: "ch_123",
        payment_intent: "pi_123",
        amount: 2599,
        amount_refunded: 500,
        refunded: false,
        currency: "eur",
        metadata: { paymentId: "payment_123" },
        refunds: {
          data: [{
            id: "re_partial_123",
            metadata: { refundId: "cm1234567890123456789012" }
          }]
        }
      }
    }
  });

  assert.equal(normalized?.eventType, "payment.refunded");
  assert.equal(normalized?.amountCents, 500);
  assert.equal(normalized?.fullRefund, false);
  assert.equal(normalized?.refundAmountIsCumulative, true);
  assert.equal(normalized?.refundReference, undefined);
  assert.equal(normalized?.refundRecordId, undefined);
});

test("Stripe refund events correlate one exact provider refund and expose failures", () => {
  const succeeded = normalizeStripeWebhook({
    id: "evt_refund_created",
    type: "refund.created",
    data: {
      object: {
        id: "re_exact_123",
        payment_intent: "pi_123",
        amount: 500,
        currency: "eur",
        status: "succeeded",
        metadata: {
          paymentId: "payment_123",
          refundId: "cm1234567890123456789012"
        }
      }
    }
  });
  const failed = normalizeStripeWebhook({
    id: "evt_refund_failed",
    type: "refund.failed",
    data: {
      object: {
        id: "re_failed_123",
        payment_intent: "pi_123",
        amount: 500,
        currency: "eur",
        status: "failed",
        failure_reason: "expired_or_canceled_card",
        metadata: { paymentId: "payment_123" }
      }
    }
  });

  assert.equal(succeeded?.eventType, "payment.refunded");
  assert.equal(succeeded?.refundReference, "re_exact_123");
  assert.equal(succeeded?.refundRecordId, "cm1234567890123456789012");
  assert.equal(succeeded?.refundAmountIsCumulative, false);
  assert.equal(failed?.eventType, "payment.refund_failed");
  assert.equal(failed?.failureMessage, "expired_or_canceled_card");
});

test("Stripe refund updates preserve pending state and require correlation", () => {
  const pending = normalizeStripeWebhook({
    id: "evt_refund_pending",
    type: "refund.updated",
    data: {
      object: {
        id: "re_pending_123",
        amount: 500,
        currency: "eur",
        status: "pending",
        metadata: { refundId: "cm1234567890123456789012" }
      }
    }
  });
  const failedWithoutReason = normalizeStripeWebhook({
    id: "evt_refund_failed_without_reason",
    type: "refund.failed",
    data: {
      object: {
        id: "re_failed_without_reason",
        amount: 500,
        currency: "eur",
        status: "canceled",
        metadata: { paymentId: "payment_123" }
      }
    }
  });
  const uncorrelated = normalizeStripeWebhook({
    id: "evt_refund_uncorrelated",
    type: "refund.updated",
    data: {
      object: {
        id: "re_uncorrelated",
        amount: 500,
        currency: "eur",
        status: "pending",
        metadata: []
      }
    }
  });

  assert.equal(pending?.eventType, "payment.refund_pending");
  assert.equal(pending?.providerReference, undefined);
  assert.equal(pending?.refundRecordId, "cm1234567890123456789012");
  assert.equal(failedWithoutReason?.eventType, "payment.refund_failed");
  assert.equal(failedWithoutReason?.failureMessage, "Stripe reported that the refund failed.");
  assert.equal(uncorrelated, null);
});

test("PayPal order requests require buyer return URLs", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "token_123" }), { status: 200 });
    }

    return new Response(JSON.stringify({
      id: "PAYPAL-ORDER-1",
      status: "CREATED",
      links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=1" }]
    }), { status: 201 });
  }) as typeof fetch;

  const order = await createPayPalOrder({
    mode: "SANDBOX",
    clientId: "client-id",
    clientSecret: "client-secret",
    paymentId: "payment_123",
    orderId: "order_123",
    orderNumber: "CY-1001",
    amountCents: 2599,
    currency: "EUR",
    returnUrl: "https://shop.example.com/payment/return",
    cancelUrl: "https://shop.example.com/payment/cancel",
    fetchImpl
  });

  assert.equal(order.id, "PAYPAL-ORDER-1");
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /api-m\.sandbox\.paypal\.com\/v1\/oauth2\/token$/);
  const createBody = JSON.parse(String(requests[1].init?.body)) as Record<string, unknown>;
  assert.equal((createBody.purchase_units as Array<{ amount: { value: string } }>)[0].amount.value, "25.99");
  assert.equal(
    ((createBody.payment_source as { paypal: { experience_context: { return_url: string } } }).paypal.experience_context.return_url),
    "https://shop.example.com/payment/return"
  );
});

test("PayPal refund requests target the completed capture and preserve idempotency", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "token_123" }), { status: 200 });
    }

    return new Response(JSON.stringify({
      id: "REFUND-1",
      status: "COMPLETED",
      amount: { value: "5.00", currency_code: "EUR" }
    }), { status: 201 });
  }) as typeof fetch;

  const refund = await createPayPalRefund({
    mode: "SANDBOX",
    clientId: "client-id",
    clientSecret: "client-secret",
    captureId: "CAPTURE-1",
    refundId: "refund_123",
    amountCents: 500,
    currency: "EUR",
    fetchImpl
  });

  assert.equal(refund.id, "REFUND-1");
  assert.match(requests[1]?.url || "", /\/v2\/payments\/captures\/CAPTURE-1\/refund$/);
  const headers = new Headers(requests[1]?.init?.headers);
  assert.equal(headers.get("paypal-request-id"), "refund_123");
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
    amount: { currency_code: "EUR", value: "5.00" }
  });
});

test("PayPal capture lookup resolves the checkout order for legacy refund webhooks", async () => {
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "token_123" }), { status: 200 });
    }
    assert.match(url, /\/v2\/payments\/captures\/CAPTURE-1$/);
    return new Response(JSON.stringify({
      id: "CAPTURE-1",
      status: "PARTIALLY_REFUNDED",
      supplementary_data: { related_ids: { order_id: "PAYPAL-ORDER-1" } }
    }), { status: 200 });
  }) as typeof fetch;

  const capture = await retrievePayPalCapture({
    mode: "SANDBOX",
    clientId: "client-id",
    clientSecret: "client-secret",
    captureId: "CAPTURE-1",
    fetchImpl
  });
  assert.equal(payPalOrderReferenceForCapture(capture), "PAYPAL-ORDER-1");
});

test("PayPal connection tests verify the configured webhook ID", async () => {
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "token_123" }), { status: 200 });
    }

    return new Response(JSON.stringify({ id: "WH-123", url: "https://shop.example.com/webhook" }), { status: 200 });
  }) as typeof fetch;

  const message = await testPayPalConnection({
    mode: "SANDBOX",
    clientId: "client-id",
    clientSecret: "client-secret",
    webhookId: "WH-123",
    fetchImpl
  });

  assert.match(message, /WH-123/);
});

test("PayPal capture and refund events correlate to the provider order", () => {
  const completed = normalizePayPalWebhook({
    id: "WH-EVENT-1",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: {
      id: "CAPTURE-1",
      amount: { value: "25.99", currency_code: "EUR" },
      supplementary_data: { related_ids: { order_id: "PAYPAL-ORDER-1" } }
    }
  });
  const refunded = normalizePayPalWebhook({
    id: "WH-EVENT-2",
    event_type: "PAYMENT.CAPTURE.REFUNDED",
    resource: {
      id: "REFUND-1",
      amount: { value: "5.00", currency_code: "EUR" },
      links: [{
        rel: "up",
        method: "GET",
        href: "https://api-m.sandbox.paypal.com/v2/payments/captures/CAPTURE-1"
      }]
    }
  });

  assert.equal(completed?.providerReference, "PAYPAL-ORDER-1");
  assert.equal(completed?.amountCents, 2599);
  assert.equal(refunded?.eventType, "payment.refunded");
  assert.equal(refunded?.amountCents, 500);
  assert.equal(refunded?.refundReference, "REFUND-1");
  assert.equal(refunded?.captureReference, "CAPTURE-1");
  assert.equal(refunded?.providerReference, undefined);
});

test("PayPal refund lifecycle webhooks preserve pending and failed provider state", () => {
  const pending = normalizePayPalWebhook({
    id: "WH-REFUND-PENDING",
    event_type: "PAYMENT.REFUND.PENDING",
    resource: {
      id: "REFUND-1",
      amount: { value: "5.00", currency_code: "EUR" },
      supplementary_data: { related_ids: { capture_id: "CAPTURE-1" } }
    }
  });
  const failed = normalizePayPalWebhook({
    id: "WH-REFUND-FAILED",
    event_type: "PAYMENT.REFUND.FAILED",
    summary: "The refund could not be settled.",
    resource: {
      id: "REFUND-1",
      amount: { value: "5.00", currency_code: "EUR" },
      supplementary_data: { related_ids: { capture_id: "CAPTURE-1" } }
    }
  });

  assert.equal(pending?.eventType, "payment.refund_pending");
  assert.equal(pending?.captureReference, "CAPTURE-1");
  assert.equal(failed?.eventType, "payment.refund_failed");
  assert.equal(failed?.failureMessage, "The refund could not be settled.");
});

test("refund requests require an idempotency key and reject invalid amounts", () => {
  assert.equal(createPaymentRefundSchema.safeParse({
    amountCents: 500,
    reason: "CUSTOMER_REQUEST",
    idempotencyKey: "refund-request-1"
  }).success, true);
  assert.equal(createPaymentRefundSchema.safeParse({
    amountCents: 0,
    idempotencyKey: "refund-request-2"
  }).success, false);
  assert.equal(createPaymentRefundSchema.safeParse({ amountCents: 500 }).success, false);
});

test("PayPal intents fail validation without return and cancel URLs", () => {
  const parsed = createPaymentIntentSchema.safeParse({
    orderId: "cm1234567890123456789012",
    provider: "PAYPAL"
  });

  assert.equal(parsed.success, false);
  if (!parsed.success) {
    assert.deepEqual(
      parsed.error.issues.map((issue) => issue.path[0]).sort(),
      ["cancelUrl", "returnUrl"]
    );
  }
});

test("provider secrets cannot be set and cleared in one request", () => {
  const parsed = updatePaymentProviderConfigSchema.safeParse({
    secretKey: "sk_test_private",
    clearSecretKey: true
  });

  assert.equal(parsed.success, false);
});

test("online payment configuration requires secret access and recent authentication", () => {
  const baseUser: AuthenticatedUser = {
    id: "payments-user",
    email: "payments@example.com",
    name: "Payments",
    roles: ["payments"],
    mfaEnabled: false,
    permissions: [{ action: "update", subject: "payments" }]
  };
  assert.throws(
    () => assertSensitivePaymentProviderAccess("STRIPE", undefined),
    (error) => error instanceof AppError && error.code === "forbidden"
  );
  assert.doesNotThrow(() => assertSensitivePaymentProviderAccess("MANUAL", baseUser));
  assert.throws(
    () => assertSensitivePaymentProviderAccess("STRIPE", baseUser),
    (error) => error instanceof AppError && error.code === "forbidden"
  );

  const secretManager = {
    ...baseUser,
    authenticatedAt: new Date(1_000),
    permissions: [...baseUser.permissions, { action: "manage", subject: "secrets" }]
  };
  assert.throws(
    () => assertSensitivePaymentProviderAccess("PAYPAL", secretManager, 16 * 60_000 + 1_000),
    (error) => error instanceof AppError && error.code === "recent_authentication_required"
  );
  assert.doesNotThrow(() => assertSensitivePaymentProviderAccess("PAYPAL", secretManager, 2_000));
  assert.doesNotThrow(() => assertSensitivePaymentProviderAccess("STRIPE", {
    ...baseUser,
    authenticatedAt: new Date(1_000),
    permissions: [{ action: "manage", subject: "all" }]
  }, 2_000));
});

test("a stale provider test cannot approve newly changed credentials", async () => {
  const testedConfig = {
    id: "stripe-config",
    siteId: "site-1",
    provider: "STRIPE" as const,
    mode: "SANDBOX" as const,
    enabled: false,
    publishableKey: "pk_test_current",
    clientId: null,
    webhookId: null,
    encryptedCredentials: "old-credentials",
    instructions: null,
    lastTestedAt: null,
    lastTestSucceeded: null,
    lastTestMessage: null,
    lastWebhookAt: null,
    createdAt: new Date(1_000),
    updatedAt: new Date(1_000)
  };
  const currentConfig = {
    ...testedConfig,
    encryptedCredentials: "new-credentials",
    updatedAt: new Date(2_000)
  };
  let lastTestSucceeded: boolean | null = null;
  const prisma = {
    site: {
      upsert: async () => ({ id: "site-1" })
    },
    paymentProviderConfig: {
      findUnique: async () => currentConfig,
      update: async (input: { data: { lastTestSucceeded: boolean } }) => {
        lastTestSucceeded = input.data.lastTestSucceeded;
        return currentConfig;
      }
    },
    $queryRaw: async () => [{ lock: "1" }],
    $transaction: async (operation: (transaction: unknown) => Promise<unknown>) => operation(prisma)
  };
  const service = new PaymentProviderConfigService({
    prisma,
    config: {
      payments: { credentialEncryptionKey: encryptionKey },
      app: { name: "CodeY", mode: "shop" }
    }
  } as never);

  assert.equal(
    await service.recordTestResult(
      "STRIPE",
      paymentProviderConfigRevision(testedConfig),
      true,
      "Connected"
    ),
    false
  );
  assert.equal(lastTestSucceeded, null);
});
