import { createHash } from "node:crypto";
import {
  Prisma,
  type Payment,
  type PaymentProvider,
  type PaymentRefund,
  type PaymentRefundReason
} from "@prisma/client";
import { AppError } from "../../core/errors/app-error.js";
import type { ModuleContext } from "../../core/types/module.js";
import { PaymentProviderConfigService } from "./payment-provider-config.service.js";
import { processPaymentEvent } from "./payment-event.service.js";
import {
  completedPayPalCapture,
  createPayPalRefund,
  retrievePayPalOrder,
  type PayPalRefund
} from "./paypal-provider.js";
import { createStripeRefund, type StripeRefund } from "./stripe-provider.js";

export type CreatePaymentRefundInput = {
  paymentId: string;
  amountCents?: number;
  reason: PaymentRefundReason;
  note?: string;
  idempotencyKey: string;
  retryRefundId?: string;
  supportCaseId?: string;
  initiatedByUserId?: string;
};

const pendingRetryAgeMs = 60_000;

function jsonRecord(value: Prisma.JsonValue | null) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function refundedAmount(payment: { amountCents: number; metadata: Prisma.JsonValue | null }) {
  const value = jsonRecord(payment.metadata).refundedCents;
  return typeof value === "number" && Number.isInteger(value)
    ? Math.min(payment.amountCents, Math.max(0, value))
    : 0;
}

function refundIdempotencyKey(paymentId: string, value: string) {
  return createHash("sha256").update(`payment-refund:v1:${paymentId}:${value}`).digest("hex");
}

function assertMatchingRetry(
  refund: PaymentRefund,
  input: CreatePaymentRefundInput
) {
  const note = input.note?.trim() || null;
  if (
    refund.paymentId !== input.paymentId ||
    (input.amountCents !== undefined && refund.amountCents !== input.amountCents) ||
    refund.reason !== input.reason ||
    refund.note !== note ||
    refund.supportCaseId !== (input.supportCaseId ?? null)
  ) {
    throw new AppError(
      409,
      "payment_refund_idempotency_conflict",
      "This refund key is already used for a different request."
    );
  }
}

async function assertNoOtherPendingRefund(
  tx: Prisma.TransactionClient,
  paymentId: string,
  refundId: string
) {
  const pending = await tx.paymentRefund.findFirst({
    where: { paymentId, status: "PENDING" }
  });
  if (pending && pending.id !== refundId) {
    throw new AppError(
      409,
      "payment_refund_in_progress",
      "Another refund for this payment is still in progress."
    );
  }
}

async function validatedRefundAmount(
  tx: Prisma.TransactionClient,
  payment: Payment,
  input: CreatePaymentRefundInput,
  persistedAmountCents?: number
) {
  if (payment.status !== "SUCCEEDED") {
    throw new AppError(
      409,
      "payment_not_refundable",
      "Only a successful payment with a remaining balance can be refunded."
    );
  }
  if (!payment.providerReference) {
    throw new AppError(
      409,
      "payment_provider_reference_missing",
      "This payment is missing its provider reference."
    );
  }

  const order = await tx.order.findUnique({ where: { id: payment.orderId! } });
  if (!order || !["PAID", "FULFILLED"].includes(order.status)) {
    throw new AppError(409, "order_not_refundable", "This order cannot be refunded.");
  }

  const remainingCents = payment.amountCents - refundedAmount(payment);
  const amountCents = persistedAmountCents ?? input.amountCents ?? remainingCents;
  if (amountCents <= 0 || amountCents > remainingCents) {
    throw new AppError(
      422,
      "payment_refund_amount_invalid",
      `Refund amount must be between 1 and ${remainingCents} cents.`
    );
  }

  if (input.supportCaseId) {
    const supportCase = await tx.orderSupportCase.findFirst({
      where: {
        id: input.supportCaseId,
        orderId: payment.orderId!,
        type: "REFUND"
      }
    });
    if (!supportCase) {
      throw new AppError(404, "refund_request_not_found", "Approved refund request was not found.");
    }
    if (supportCase.status !== "APPROVED") {
      throw new AppError(409, "refund_request_not_approved", "The refund request must be approved first.");
    }
    if (supportCase.requestedRefundCents !== amountCents) {
      throw new AppError(
        422,
        "refund_request_amount_mismatch",
        "Refund amount must match the approved request."
      );
    }
  }

  return amountCents;
}

async function claimRefund(context: ModuleContext, input: CreatePaymentRefundInput) {
  const idempotencyKey = refundIdempotencyKey(input.paymentId, input.idempotencyKey);

  return context.prisma.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Payment" WHERE "id" = ${input.paymentId} FOR UPDATE`
    );
    const payment = await tx.payment.findUnique({ where: { id: input.paymentId } });
    if (!payment || !payment.orderId) {
      throw new AppError(404, "payment_not_found", "Payment was not found.");
    }

    if (input.retryRefundId) {
      const retry = await tx.paymentRefund.findFirst({
        where: { id: input.retryRefundId, paymentId: payment.id }
      });
      if (!retry) {
        throw new AppError(404, "payment_refund_not_found", "Refund attempt was not found.");
      }
      assertMatchingRetry(retry, input);
      if (retry.status === "SUCCEEDED") {
        return { payment, refund: retry, process: false, duplicate: true };
      }
      if (
        retry.status === "PENDING" &&
        Date.now() - retry.updatedAt.getTime() < pendingRetryAgeMs
      ) {
        return { payment, refund: retry, process: false, duplicate: true };
      }

      await validatedRefundAmount(tx, payment, input, retry.amountCents);
      await assertNoOtherPendingRefund(tx, payment.id, retry.id);
      const refund = await tx.paymentRefund.update({
        where: { id: retry.id },
        data: { status: "PENDING", failureMessage: null }
      });
      return { payment, refund, process: true, duplicate: true };
    }

    const existing = await tx.paymentRefund.findUnique({ where: { idempotencyKey } });
    if (existing) {
      assertMatchingRetry(existing, input);
      if (existing.status === "SUCCEEDED") {
        return { payment, refund: existing, process: false, duplicate: true };
      }
      if (
        existing.status === "PENDING" &&
        Date.now() - existing.updatedAt.getTime() < pendingRetryAgeMs
      ) {
        return { payment, refund: existing, process: false, duplicate: true };
      }

      await validatedRefundAmount(tx, payment, input, existing.amountCents);
      await assertNoOtherPendingRefund(tx, payment.id, existing.id);
      const refund = await tx.paymentRefund.update({
        where: { id: existing.id },
        data: {
          status: "PENDING",
          failureMessage: null
        }
      });
      return { payment, refund, process: true, duplicate: true };
    }

    const amountCents = await validatedRefundAmount(tx, payment, input);

    const pending = await tx.paymentRefund.findFirst({
      where: { paymentId: payment.id, status: "PENDING" }
    });
    if (pending) {
      throw new AppError(
        409,
        "payment_refund_in_progress",
        "Another refund for this payment is still in progress."
      );
    }

    const refund = await tx.paymentRefund.create({
      data: {
        paymentId: payment.id,
        provider: payment.provider,
        amountCents,
        currency: payment.currency,
        reason: input.reason,
        note: input.note?.trim() || null,
        idempotencyKey,
        ...(input.supportCaseId ? { supportCaseId: input.supportCaseId } : {}),
        initiatedByUserId: input.initiatedByUserId
      }
    });

    return { payment, refund, process: true, duplicate: false };
  });
}

function stripeReason(reason: PaymentRefundReason) {
  if (reason === "DUPLICATE") return "duplicate" as const;
  if (reason === "FRAUDULENT") return "fraudulent" as const;
  if (reason === "CUSTOMER_REQUEST") return "requested_by_customer" as const;
  return undefined;
}

function providerFailureMessage(provider: PaymentProvider, status?: string | null) {
  const label = provider === "PAYPAL" ? "PayPal" : provider === "STRIPE" ? "Stripe" : "Manual";
  return status
    ? `${label} returned refund status ${status}.`
    : `${label} did not confirm the refund.`;
}

function assertStripeRefund(refund: PaymentRefund, providerRefund: StripeRefund) {
  if (!providerRefund.id || providerRefund.amount !== refund.amountCents) {
    throw new AppError(502, "stripe_refund_mismatch", "Stripe returned unexpected refund details.");
  }
  if (providerRefund.currency?.toUpperCase() !== refund.currency.toUpperCase()) {
    throw new AppError(502, "stripe_refund_mismatch", "Stripe returned an unexpected refund currency.");
  }
}

function assertPayPalRefund(refund: PaymentRefund, providerRefund: PayPalRefund) {
  const amountCents = providerRefund.amount
    ? Math.round(Number(providerRefund.amount.value) * 100)
    : refund.amountCents;
  if (!providerRefund.id || !Number.isFinite(amountCents) || amountCents !== refund.amountCents) {
    throw new AppError(502, "paypal_refund_mismatch", "PayPal returned unexpected refund details.");
  }
  if (
    providerRefund.amount?.currency_code &&
    providerRefund.amount.currency_code.toUpperCase() !== refund.currency.toUpperCase()
  ) {
    throw new AppError(502, "paypal_refund_mismatch", "PayPal returned an unexpected refund currency.");
  }
}

async function markRefundFailed(context: ModuleContext, refundId: string, error: unknown) {
  const message = error instanceof Error ? error.message.slice(0, 500) : "Refund request failed.";
  await context.prisma.paymentRefund.updateMany({
    where: { id: refundId, status: "PENDING" },
    data: { status: "FAILED", failureMessage: message }
  });
}

async function recordProviderReference(
  context: ModuleContext,
  refund: PaymentRefund,
  providerReference: string
) {
  try {
    return await context.prisma.paymentRefund.update({
      where: { id: refund.id },
      data: { providerReference }
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }

    const applied = await context.prisma.paymentRefund.findFirst({
      where: { provider: refund.provider, providerReference }
    });
    if (!applied) throw error;
    if (
      applied.paymentId !== refund.paymentId ||
      applied.amountCents !== refund.amountCents ||
      applied.currency.toUpperCase() !== refund.currency.toUpperCase()
    ) {
      throw new AppError(409, "payment_refund_mismatch", "Provider refund does not match this refund request.");
    }
    return context.prisma.$transaction(async (tx) => {
      await tx.paymentRefund.delete({ where: { id: refund.id } });
      const recordedRefund = await tx.paymentRefund.update({
        where: { id: applied.id },
        data: {
          idempotencyKey: refund.idempotencyKey,
          reason: refund.reason,
          note: refund.note,
          supportCaseId: refund.supportCaseId,
          initiatedByUserId: refund.initiatedByUserId
        }
      });
      if (recordedRefund.status === "SUCCEEDED" && recordedRefund.supportCaseId) {
        const supportCase = await tx.orderSupportCase.findUnique({
          where: { id: recordedRefund.supportCaseId }
        });
        if (supportCase?.type === "REFUND") {
          await tx.orderSupportCase.update({
            where: { id: supportCase.id },
            data: {
              status: "RESOLVED",
              merchantResponse: supportCase.merchantResponse || "Your refund has been issued.",
              resolvedAt: supportCase.resolvedAt ?? new Date()
            }
          });
        }
      }
      return recordedRefund;
    });
  }
}

async function applyRefundEvent(
  context: ModuleContext,
  payment: {
    id: string;
    provider: PaymentProvider;
    providerReference: string | null;
    amountCents: number;
    metadata: Prisma.JsonValue | null;
  },
  refund: PaymentRefund,
  providerReference: string,
  payload: Record<string, unknown>
) {
  const recordedRefund = await recordProviderReference(context, refund, providerReference);
  if (recordedRefund.id !== refund.id && recordedRefund.status === "SUCCEEDED") {
    return { refund: recordedRefund, duplicate: true };
  }

  const result = await processPaymentEvent(context, {
    provider: payment.provider,
    eventType: "payment.refunded",
    providerEventId: `${payment.provider.toLowerCase()}-refund:${providerReference}`,
    providerReference: payment.providerReference!,
    paymentId: payment.id,
    refundReference: providerReference,
    amountCents: recordedRefund.amountCents,
    currency: recordedRefund.currency,
    fullRefund: recordedRefund.amountCents === payment.amountCents - refundedAmount(payment),
    payload
  });
  const updatedRefund = await context.prisma.paymentRefund.findUniqueOrThrow({
    where: { id: recordedRefund.id }
  });

  return { ...result, refund: updatedRefund };
}

export async function createPaymentRefund(
  context: ModuleContext,
  input: CreatePaymentRefundInput
) {
  const claim = await claimRefund(context, input);
  if (!claim.process) {
    return { refund: claim.refund, duplicate: claim.duplicate };
  }

  const { payment, refund } = claim;
  try {
    if (payment.provider === "MANUAL") {
      const applied = await applyRefundEvent(
        context,
        payment,
        refund,
        `manual_${refund.id}`,
        { source: "cms_admin", refundId: refund.id }
      );
      return {
        ...applied,
        duplicate: claim.duplicate || applied.duplicate === true
      };
    }

    const providerService = new PaymentProviderConfigService(context);
    const resolved = await providerService.resolveConfig(payment.provider);
    if (payment.provider === "STRIPE") {
      const providerRefund = await createStripeRefund({
        secretKey: resolved.credentials.secretKey!,
        paymentIntentId: payment.providerReference!,
        paymentId: payment.id,
        refundId: refund.id,
        amountCents: refund.amountCents,
        reason: stripeReason(refund.reason)
      });
      assertStripeRefund(refund, providerRefund);
      if (["failed", "canceled"].includes(providerRefund.status || "")) {
        throw new AppError(
          422,
          "payment_refund_failed",
          providerFailureMessage(payment.provider, providerRefund.status || providerRefund.failure_reason)
        );
      }
      if (providerRefund.status !== "succeeded") {
        const pending = await recordProviderReference(context, refund, providerRefund.id);
        return {
          refund: pending,
          providerStatus: providerRefund.status || "pending",
          duplicate: claim.duplicate || pending.id !== refund.id
        };
      }

      const applied = await applyRefundEvent(context, payment, refund, providerRefund.id, providerRefund);
      return {
        ...applied,
        duplicate: claim.duplicate || applied.duplicate === true
      };
    }

    const paypalOrder = await retrievePayPalOrder({
      mode: resolved.config.mode,
      clientId: resolved.config.clientId!,
      clientSecret: resolved.credentials.clientSecret!,
      providerReference: payment.providerReference!
    });
    const capture = completedPayPalCapture(paypalOrder);
    if (!capture) {
      throw new AppError(409, "paypal_capture_missing", "PayPal capture details are unavailable for this payment.");
    }
    if (jsonRecord(payment.metadata).providerCaptureReference !== capture.id) {
      await context.prisma.payment.update({
        where: { id: payment.id },
        data: {
          metadata: {
            ...jsonRecord(payment.metadata),
            providerCaptureReference: capture.id
          }
        }
      });
    }
    const providerRefund = await createPayPalRefund({
      mode: resolved.config.mode,
      clientId: resolved.config.clientId!,
      clientSecret: resolved.credentials.clientSecret!,
      captureId: capture.id,
      refundId: refund.id,
      amountCents: refund.amountCents,
      currency: refund.currency
    });
    assertPayPalRefund(refund, providerRefund);
    if (["FAILED", "CANCELLED"].includes(providerRefund.status)) {
      throw new AppError(
        422,
        "payment_refund_failed",
        providerFailureMessage(payment.provider, providerRefund.status)
      );
    }
    if (providerRefund.status !== "COMPLETED") {
      const pending = await recordProviderReference(context, refund, providerRefund.id);
      return {
        refund: pending,
        providerStatus: providerRefund.status,
        duplicate: claim.duplicate || pending.id !== refund.id
      };
    }

    const applied = await applyRefundEvent(context, payment, refund, providerRefund.id, providerRefund);
    return {
      ...applied,
      duplicate: claim.duplicate || applied.duplicate === true
    };
  } catch (error) {
    await markRefundFailed(context, refund.id, error);
    throw error;
  }
}
