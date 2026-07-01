import { createHmac, timingSafeEqual } from "node:crypto";
import type { PaymentProvider } from "@prisma/client";
import type { Request } from "express";
import { AppError } from "../../core/errors/app-error.js";
import type { ModuleContext } from "../../core/types/module.js";

function secretsMatch(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function hmacSha256(secret: string, payload: string | Buffer) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function rawRequestBody(req: Request) {
  if (req.rawBody) return req.rawBody;
  return Buffer.from(JSON.stringify(req.body ?? {}));
}

function assertTimestampWithinTolerance(timestampSeconds: number, toleranceSeconds: number) {
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (Math.abs(nowSeconds - timestampSeconds) > toleranceSeconds) {
    throw new AppError(
      401,
      "stale_payment_webhook_signature",
      "Payment webhook signature timestamp is outside the allowed tolerance."
    );
  }
}

function assertLegacySecret(context: ModuleContext, providedSecret: string | undefined) {
  const configuredSecret = context.config.payments.webhookSecret;

  if (!configuredSecret) {
    throw new AppError(
      409,
      "payment_webhook_not_configured",
      "Payment webhook secret is not configured."
    );
  }

  if (!providedSecret || !secretsMatch(providedSecret, configuredSecret)) {
    throw new AppError(401, "invalid_payment_webhook_secret", "Invalid payment webhook secret.");
  }
}

function parseStripeSignature(signatureHeader: string | undefined) {
  if (!signatureHeader) return null;

  const parts = signatureHeader.split(",").map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = parts
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3))
    .filter(Boolean);

  if (!timestamp || signatures.length === 0) return null;

  return {
    timestamp: Number(timestamp),
    signatures
  };
}

function assertStripeSignature(context: ModuleContext, req: Request) {
  const secret = context.config.payments.stripeWebhookSecret;

  if (!secret) {
    assertLegacySecret(context, req.get("x-payment-webhook-secret"));
    return;
  }

  const parsed = parseStripeSignature(req.get("stripe-signature"));

  if (!parsed || !Number.isInteger(parsed.timestamp)) {
    throw new AppError(
      401,
      "invalid_payment_webhook_signature",
      "Invalid Stripe webhook signature."
    );
  }

  assertTimestampWithinTolerance(parsed.timestamp, context.config.payments.webhookToleranceSeconds);

  const expectedSignature = hmacSha256(secret, `${parsed.timestamp}.${rawRequestBody(req).toString("utf8")}`);
  const hasValidSignature = parsed.signatures.some((signature) => secretsMatch(signature, expectedSignature));

  if (!hasValidSignature) {
    throw new AppError(
      401,
      "invalid_payment_webhook_signature",
      "Invalid Stripe webhook signature."
    );
  }
}

function assertPaypalSignature(context: ModuleContext, req: Request) {
  const secret = context.config.payments.paypalWebhookSecret;

  if (!secret) {
    assertLegacySecret(context, req.get("x-payment-webhook-secret"));
    return;
  }

  const transmissionId = req.get("paypal-transmission-id");
  const transmissionTime = req.get("paypal-transmission-time");
  const signature = req.get("paypal-transmission-sig") ?? req.get("x-paypal-webhook-signature");

  if (!transmissionId || !transmissionTime || !signature) {
    throw new AppError(
      401,
      "invalid_payment_webhook_signature",
      "Invalid PayPal webhook signature."
    );
  }

  const timestampSeconds = Math.floor(Date.parse(transmissionTime) / 1000);

  if (!Number.isInteger(timestampSeconds)) {
    throw new AppError(
      401,
      "invalid_payment_webhook_signature",
      "Invalid PayPal webhook signature."
    );
  }

  assertTimestampWithinTolerance(timestampSeconds, context.config.payments.webhookToleranceSeconds);

  const signedPayload = `${transmissionId}.${transmissionTime}.${rawRequestBody(req).toString("utf8")}`;
  const expectedSignature = hmacSha256(secret, signedPayload);

  if (!secretsMatch(signature, expectedSignature)) {
    throw new AppError(
      401,
      "invalid_payment_webhook_signature",
      "Invalid PayPal webhook signature."
    );
  }
}

export function assertPaymentWebhookSignature(
  context: ModuleContext,
  req: Request,
  provider: PaymentProvider
) {
  if (provider === "STRIPE") {
    assertStripeSignature(context, req);
    return;
  }

  if (provider === "PAYPAL") {
    assertPaypalSignature(context, req);
    return;
  }

  assertLegacySecret(context, req.get("x-payment-webhook-secret"));
}
