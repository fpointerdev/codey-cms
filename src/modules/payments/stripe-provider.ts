import { createHmac, timingSafeEqual } from "node:crypto";
import type { PaymentStatus } from "@prisma/client";
import { AppError } from "../../core/errors/app-error.js";
import { providerJsonRequest, type ProviderFetch } from "./payment-provider-http.js";

const stripeApiBase = "https://api.stripe.com/v1";

type StripePaymentIntent = {
  id: string;
  object: "payment_intent";
  amount: number;
  currency: string;
  client_secret?: string | null;
  status: string;
  metadata?: Record<string, string>;
};

export type StripeRefund = {
  id: string;
  object: "refund";
  amount: number;
  currency: string;
  payment_intent?: string | null;
  status?: string | null;
  failure_reason?: string | null;
};

type StripeAccount = {
  id: string;
  business_profile?: { name?: string | null } | null;
  business_type?: string | null;
  email?: string | null;
};

export type StripeWebhookEvent = {
  id: string;
  type: string;
  data: {
    object: Record<string, unknown>;
  };
};

function stripeHeaders(secretKey: string, extra: Record<string, string> = {}) {
  return {
    authorization: `Bearer ${secretKey}`,
    ...extra
  };
}

export function paymentStatusFromStripe(status: string): PaymentStatus {
  if (status === "succeeded") return "SUCCEEDED";
  if (status === "processing") return "PENDING";
  if (status === "canceled") return "FAILED";
  return "REQUIRES_ACTION";
}

export async function createStripePaymentIntent(input: {
  secretKey: string;
  paymentId: string;
  orderId: string;
  orderNumber?: string | null;
  amountCents: number;
  currency: string;
  fetchImpl?: ProviderFetch;
}) {
  const body = new URLSearchParams({
    amount: String(input.amountCents),
    currency: input.currency.toLowerCase(),
    "automatic_payment_methods[enabled]": "true",
    "metadata[paymentId]": input.paymentId,
    "metadata[orderId]": input.orderId
  });
  if (input.orderNumber) body.set("description", `Order ${input.orderNumber}`);

  return providerJsonRequest<StripePaymentIntent>(
    "stripe",
    `${stripeApiBase}/payment_intents`,
    {
      method: "POST",
      headers: stripeHeaders(input.secretKey, {
        "content-type": "application/x-www-form-urlencoded",
        "idempotency-key": input.paymentId
      }),
      body
    },
    input.fetchImpl
  );
}

export async function retrieveStripePaymentIntent(input: {
  secretKey: string;
  providerReference: string;
  fetchImpl?: ProviderFetch;
}) {
  return providerJsonRequest<StripePaymentIntent>(
    "stripe",
    `${stripeApiBase}/payment_intents/${encodeURIComponent(input.providerReference)}`,
    {
      method: "GET",
      headers: stripeHeaders(input.secretKey)
    },
    input.fetchImpl
  );
}

export async function createStripeRefund(input: {
  secretKey: string;
  paymentIntentId: string;
  paymentId: string;
  refundId: string;
  amountCents: number;
  reason?: "duplicate" | "fraudulent" | "requested_by_customer";
  fetchImpl?: ProviderFetch;
}) {
  const body = new URLSearchParams({
    payment_intent: input.paymentIntentId,
    amount: String(input.amountCents),
    "metadata[paymentId]": input.paymentId,
    "metadata[refundId]": input.refundId
  });
  if (input.reason) body.set("reason", input.reason);

  return providerJsonRequest<StripeRefund>(
    "stripe",
    `${stripeApiBase}/refunds`,
    {
      method: "POST",
      headers: stripeHeaders(input.secretKey, {
        "content-type": "application/x-www-form-urlencoded",
        "idempotency-key": input.refundId
      }),
      body
    },
    input.fetchImpl
  );
}

export async function testStripeConnection(secretKey: string, fetchImpl?: ProviderFetch) {
  const account = await providerJsonRequest<StripeAccount>(
    "stripe",
    `${stripeApiBase}/account`,
    {
      method: "GET",
      headers: stripeHeaders(secretKey)
    },
    fetchImpl
  );

  const accountLabel = account.business_profile?.name || account.email || account.id;
  return `Connected to Stripe account ${accountLabel}.`;
}

function safeSignatureMatch(expected: string, provided: string) {
  const expectedBuffer = Buffer.from(expected, "hex");
  const providedBuffer = Buffer.from(provided, "hex");
  return expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer);
}

export function verifyStripeWebhook(input: {
  rawBody: Buffer;
  signatureHeader?: string;
  webhookSecret: string;
  now?: number;
  toleranceSeconds?: number;
}) {
  if (!input.signatureHeader) {
    throw new AppError(401, "stripe_signature_missing", "Stripe webhook signature is missing.");
  }

  const signatureParts = input.signatureHeader.split(",").map((part) => part.trim());
  const timestampValue = signatureParts.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = signatureParts
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3));
  const timestamp = Number(timestampValue);
  if (!Number.isInteger(timestamp) || signatures.length === 0) {
    throw new AppError(401, "stripe_signature_invalid", "Stripe webhook signature is invalid.");
  }

  const now = input.now ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? 300;
  if (Math.abs(now - timestamp) > tolerance) {
    throw new AppError(401, "stripe_signature_expired", "Stripe webhook signature has expired.");
  }

  const expected = createHmac("sha256", input.webhookSecret)
    .update(`${timestamp}.`)
    .update(input.rawBody)
    .digest("hex");
  if (!signatures.some((signature) => safeSignatureMatch(expected, signature))) {
    throw new AppError(401, "stripe_signature_invalid", "Stripe webhook signature is invalid.");
  }

  try {
    return JSON.parse(input.rawBody.toString("utf8")) as StripeWebhookEvent;
  } catch {
    throw new AppError(400, "stripe_webhook_invalid", "Stripe webhook body is invalid JSON.");
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

function integerValue(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function normalizeStripeWebhook(event: StripeWebhookEvent) {
  const object = event.data?.object ?? {};
  const metadata = recordValue(object.metadata);
  if (["refund.created", "refund.updated", "refund.failed"].includes(event.type)) {
    const status = stringValue(object.status);
    const eventType = event.type === "refund.failed" || ["failed", "canceled"].includes(status || "")
      ? "payment.refund_failed" as const
      : status === "succeeded"
        ? "payment.refunded" as const
        : "payment.refund_pending" as const;
    const providerReference = stringValue(object.payment_intent);
    const refundReference = stringValue(object.id);
    const refundRecordId = stringValue(metadata.refundId);
    const paymentId = stringValue(metadata.paymentId);
    if (!event.id || !refundReference || (!providerReference && !refundRecordId && !paymentId)) return null;

    return {
      provider: "STRIPE" as const,
      eventType,
      providerEventId: event.id,
      ...(providerReference ? { providerReference } : {}),
      refundReference,
      ...(refundRecordId ? { refundRecordId } : {}),
      ...(paymentId ? { paymentId } : {}),
      amountCents: integerValue(object.amount),
      currency: stringValue(object.currency)?.toUpperCase(),
      fullRefund: false,
      refundAmountIsCumulative: false,
      ...(eventType === "payment.refund_failed"
        ? { failureMessage: stringValue(object.failure_reason) || "Stripe reported that the refund failed." }
        : {}),
      payload: event as unknown as Record<string, unknown>
    };
  }

  let eventType: "payment.succeeded" | "payment.failed" | "payment.refunded" | undefined;
  let providerReference: string | undefined;

  if (event.type === "payment_intent.succeeded") {
    eventType = "payment.succeeded";
    providerReference = stringValue(object.id);
  } else if (event.type === "payment_intent.canceled") {
    eventType = "payment.failed";
    providerReference = stringValue(object.id);
  } else if (event.type === "charge.refunded") {
    eventType = "payment.refunded";
    providerReference = stringValue(object.payment_intent);
  }

  if (!eventType || !providerReference || !event.id) return null;

  return {
    provider: "STRIPE" as const,
    eventType,
    providerEventId: event.id,
    providerReference,
    paymentId: stringValue(metadata.paymentId),
    amountCents: integerValue(eventType === "payment.refunded" ? object.amount_refunded : object.amount),
    currency: stringValue(object.currency)?.toUpperCase(),
    fullRefund: eventType === "payment.refunded" && object.refunded === true,
    refundAmountIsCumulative: eventType === "payment.refunded",
    payload: event as unknown as Record<string, unknown>
  };
}
