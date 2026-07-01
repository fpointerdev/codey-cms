import { randomBytes } from "node:crypto";
import type { Router } from "express";
import type { Payment, PaymentProvider, PaymentStatus, Prisma } from "@prisma/client";
import type { ModuleContext } from "../../core/types/module.js";
import { AppError } from "../../core/errors/app-error.js";
import { asyncHandler } from "../../core/http/async-handler.js";
import { sendCreated, sendSuccess } from "../../core/http/response.js";
import { validateRequest } from "../../core/http/validation.middleware.js";
import { deliverQueuedOrderEmails, queueOrderEmail } from "../orders/order-email.service.js";
import { assertPaymentWebhookSignature } from "./payment-webhook-signature.js";
import { createPaymentIntentSchema, paymentWebhookSchema } from "./payments.schemas.js";

function createProviderReference(provider: PaymentProvider) {
  return `${provider.toLowerCase()}_${randomBytes(12).toString("hex")}`;
}

function createProviderPayload(payment: Payment) {
  if (payment.provider === "STRIPE") {
    return {
      type: "stripe_payment_handoff",
      providerReference: payment.providerReference,
      amountCents: payment.amountCents,
      currency: payment.currency
    };
  }

  if (payment.provider === "PAYPAL") {
    return {
      type: "paypal_order",
      providerReference: payment.providerReference,
      amountCents: payment.amountCents,
      currency: payment.currency,
      approveUrl: `/payments/paypal/approve/${payment.providerReference}`
    };
  }

  return {
    type: "manual_payment",
    providerReference: payment.providerReference,
    amountCents: payment.amountCents,
    currency: payment.currency,
    instructions: "Collect payment manually, then confirm the payment through a webhook or admin flow."
  };
}

function statusFromWebhook(eventType: string): PaymentStatus | undefined {
  const normalized = eventType.toLowerCase();

  if (
    normalized.includes("succeeded") ||
    normalized.includes("completed") ||
    normalized.includes("paid")
  ) {
    return "SUCCEEDED";
  }

  if (normalized.includes("failed") || normalized.includes("denied")) {
    return "FAILED";
  }

  if (normalized.includes("refunded")) {
    return "REFUNDED";
  }

  return undefined;
}

export function registerPaymentRoutes(router: Router, context: ModuleContext) {
  router.post(
    "/intent",
    validateRequest({ body: createPaymentIntentSchema }),
    asyncHandler(async (req, res) => {
      const input = req.body as {
        orderId: string;
        provider: "STRIPE" | "PAYPAL" | "MANUAL";
        idempotencyKey?: string;
        metadata?: Record<string, unknown>;
      };

      if (input.idempotencyKey) {
        const existingPayment = await context.prisma.payment.findUnique({
          where: { idempotencyKey: input.idempotencyKey }
        });

        if (existingPayment) {
          return sendSuccess(res, {
            payment: existingPayment,
            providerPayload: createProviderPayload(existingPayment)
          });
        }
      }

      const order = await context.prisma.order.findUnique({
        where: { id: input.orderId }
      });

      if (!order) {
        throw new AppError(404, "order_not_found", "Order not found.");
      }

      if (["CANCELLED", "REFUNDED"].includes(order.status)) {
        throw new AppError(409, "order_not_payable", "This order cannot be paid.");
      }

      const payment = await context.prisma.payment.create({
        data: {
          orderId: order.id,
          provider: input.provider,
          status: input.provider === "MANUAL" ? "PENDING" : "REQUIRES_ACTION",
          amountCents: order.totalCents,
          currency: order.currency,
          idempotencyKey: input.idempotencyKey,
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
          providerReference: createProviderReference(input.provider)
        }
      });

      return sendCreated(res, {
        payment,
        providerPayload: createProviderPayload(payment)
      });
    })
  );

  router.post(
    "/webhooks",
    validateRequest({ body: paymentWebhookSchema }),
    asyncHandler(async (req, res) => {
      const input = req.body as {
        provider: PaymentProvider;
        eventType: string;
        providerEventId?: string;
        providerReference?: string;
        payload: Record<string, unknown>;
      };

      assertPaymentWebhookSignature(context, req, input.provider);

      if (input.providerEventId) {
        const existingWebhook = await context.prisma.paymentWebhook.findUnique({
          where: { providerEventId: input.providerEventId }
        });

        if (existingWebhook) {
          return sendSuccess(res, {
            webhook: existingWebhook,
            duplicate: true
          });
        }
      }

      const result = await context.prisma.$transaction(async (tx) => {
        const nextStatus = statusFromWebhook(input.eventType);
        const webhook = await tx.paymentWebhook.create({
          data: {
            provider: input.provider,
            eventType: input.eventType,
            providerEventId: input.providerEventId,
            providerReference: input.providerReference,
            payload: input.payload as Prisma.InputJsonValue
          }
        });
        const payment =
          input.providerReference && nextStatus
            ? await tx.payment.findFirst({
                where: {
                  provider: input.provider,
                  providerReference: input.providerReference
                }
              })
            : null;
        const updatedPayment = payment
          ? await tx.payment.update({
              where: { id: payment.id },
              data: { status: nextStatus }
            })
          : null;

        let orderId = updatedPayment?.orderId;

        if (updatedPayment?.orderId) {
          const orderStatus =
            nextStatus === "SUCCEEDED"
              ? "PAID"
              : nextStatus === "REFUNDED"
                ? "REFUNDED"
                : undefined;

          if (orderStatus) {
            const order = await tx.order.update({
              where: { id: updatedPayment.orderId },
              data: {
                status: orderStatus,
                checkoutStatus: nextStatus === "SUCCEEDED" ? "COMPLETE" : undefined
              },
              include: { items: true }
            });

            await queueOrderEmail(tx, order, {
              eventType: nextStatus === "SUCCEEDED" ? "ORDER_PAID" : "ORDER_REFUNDED"
            });
            orderId = order.id;
          }
        }

        const processedWebhook = await tx.paymentWebhook.update({
          where: { id: webhook.id },
          data: { processedAt: new Date() }
        });

        return {
          webhook: processedWebhook,
          payment: updatedPayment,
          status: nextStatus,
          orderId
        };
      });
      if (result.orderId) {
        await deliverQueuedOrderEmails(context, { orderId: result.orderId });
      }

      return sendSuccess(res, result);
    })
  );
}
