import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { AppError } from "../src/core/errors/app-error.js";
import {
  decryptPaymentCredentials,
  encryptPaymentCredentials
} from "../src/modules/payments/payment-credentials.js";
import {
  createPayPalOrder,
  normalizePayPalWebhook,
  testPayPalConnection
} from "../src/modules/payments/paypal-provider.js";
import {
  createPaymentIntentSchema,
  updatePaymentProviderConfigSchema
} from "../src/modules/payments/payments.schemas.js";
import {
  createStripePaymentIntent,
  normalizeStripeWebhook,
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
      supplementary_data: { related_ids: { order_id: "PAYPAL-ORDER-1" } }
    }
  });

  assert.equal(completed?.providerReference, "PAYPAL-ORDER-1");
  assert.equal(completed?.amountCents, 2599);
  assert.equal(refunded?.eventType, "payment.refunded");
  assert.equal(refunded?.amountCents, 500);
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
