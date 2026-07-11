import { Prisma, type PaymentProvider, type PaymentStatus } from "@prisma/client";
import { AppError } from "../../core/errors/app-error.js";
import type { ModuleContext } from "../../core/types/module.js";
import {
  releaseExpiredOrderReservations,
  releaseOrderInventoryReservation
} from "../orders/checkout.service.js";
import { deliverQueuedOrderEmails, queueOrderEmail } from "../orders/order-email.service.js";

export type NormalizedPaymentEvent = {
  provider: PaymentProvider;
  eventType: "payment.succeeded" | "payment.failed" | "payment.refunded";
  providerEventId: string;
  providerReference: string;
  paymentId?: string;
  amountCents?: number;
  currency?: string;
  fullRefund?: boolean;
  refundAmountIsCumulative?: boolean;
  payload: Record<string, unknown>;
};

export function statusFromWebhook(eventType: string): PaymentStatus | undefined {
  if (eventType === "payment.succeeded") return "SUCCEEDED";
  if (eventType === "payment.failed") return "FAILED";
  if (eventType === "payment.refunded") return "REFUNDED";
  return undefined;
}

function jsonRecord(value: Prisma.JsonValue | null) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Prisma.JsonObject
    : {};
}

function assertPaymentMatchesEvent(
  payment: { id: string; provider: PaymentProvider; providerReference: string | null; amountCents: number; currency: string },
  input: NormalizedPaymentEvent
) {
  if (payment.provider !== input.provider || payment.providerReference !== input.providerReference) {
    throw new AppError(409, "payment_event_mismatch", "Payment event does not match the stored payment.");
  }

  if (input.currency && payment.currency.toUpperCase() !== input.currency.toUpperCase()) {
    throw new AppError(409, "payment_currency_mismatch", "Payment event currency does not match the order.");
  }

  if (
    input.eventType === "payment.succeeded" &&
    input.amountCents !== undefined &&
    payment.amountCents !== input.amountCents
  ) {
    throw new AppError(409, "payment_amount_mismatch", "Payment event amount does not match the order.");
  }
}

export async function processPaymentEvent(
  context: ModuleContext,
  input: NormalizedPaymentEvent
) {
  await releaseExpiredOrderReservations(context);

  const existingWebhook = await context.prisma.paymentWebhook.findUnique({
    where: { providerEventId: input.providerEventId }
  });
  if (existingWebhook) {
    return { webhook: existingWebhook, duplicate: true };
  }

  try {
    const result = await context.prisma.$transaction(async (tx) => {
      const nextStatus = statusFromWebhook(input.eventType);
      if (!nextStatus) {
        throw new AppError(422, "unsupported_payment_event", "Payment event is not supported.");
      }

      const webhook = await tx.paymentWebhook.create({
        data: {
          provider: input.provider,
          eventType: input.eventType,
          providerEventId: input.providerEventId,
          providerReference: input.providerReference,
          payload: input.payload as Prisma.InputJsonValue
        }
      });
      const candidatePayment = input.paymentId
        ? await tx.payment.findUnique({ where: { id: input.paymentId } })
        : await tx.payment.findFirst({
            where: {
              provider: input.provider,
              providerReference: input.providerReference
            }
          });

      if (!candidatePayment || !candidatePayment.orderId) {
        throw new AppError(404, "payment_not_found", "Payment was not found.");
      }
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Payment" WHERE "id" = ${candidatePayment.id} FOR UPDATE`
      );
      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: candidatePayment.id }
      });
      if (!payment.orderId) {
        throw new AppError(404, "payment_order_missing", "Payment is not linked to an order.");
      }
      assertPaymentMatchesEvent(payment, input);

      const order = await tx.order.findUnique({
        where: { id: payment.orderId },
        include: { items: true }
      });
      if (!order) {
        throw new AppError(404, "order_not_found", "Order was not found.");
      }

      let updatedPayment = payment;
      let orderId: string | undefined;
      let partialRefund = false;
      let refundedCents: number | undefined;

      if (nextStatus === "SUCCEEDED") {
        if (payment.status === "REFUNDED") {
          throw new AppError(409, "invalid_payment_transition", "A refunded payment cannot succeed again.");
        }

        if (payment.status !== "SUCCEEDED") {
          if (
            order.status !== "PENDING" ||
            !["PAYMENT_PENDING", "PAYMENT_AUTHORIZED"].includes(order.checkoutStatus)
          ) {
            throw new AppError(409, "order_not_payable", "The inventory reservation has expired or was cancelled.");
          }

          const claimedOrder = await tx.order.updateMany({
            where: {
              id: order.id,
              status: "PENDING",
              checkoutStatus: { in: ["PAYMENT_PENDING", "PAYMENT_AUTHORIZED"] }
            },
            data: {
              status: "PAID",
              checkoutStatus: "COMPLETE"
            }
          });
          if (claimedOrder.count !== 1) {
            throw new AppError(409, "order_not_payable", "The inventory reservation has expired or was cancelled.");
          }

          const claimedPayment = await tx.payment.updateMany({
            where: {
              id: payment.id,
              status: { in: ["PENDING", "REQUIRES_ACTION"] }
            },
            data: { status: "SUCCEEDED" }
          });
          if (claimedPayment.count !== 1) {
            throw new AppError(409, "invalid_payment_transition", "Payment status changed before it could be completed.");
          }

          updatedPayment = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
          const paidOrder = await tx.order.findUniqueOrThrow({
            where: { id: order.id },
            include: { items: true }
          });
          await queueOrderEmail(tx, paidOrder, { eventType: "ORDER_PAID" });
          orderId = paidOrder.id;
        }
      } else if (nextStatus === "FAILED") {
        if (["SUCCEEDED", "REFUNDED"].includes(payment.status)) {
          throw new AppError(409, "invalid_payment_transition", "A completed payment cannot be marked as failed.");
        }

        const released = await releaseOrderInventoryReservation(tx, order.id);
        const currentOrder = released
          ? null
          : await tx.order.findUniqueOrThrow({ where: { id: order.id } });
        if (!released && currentOrder?.checkoutStatus !== "ABANDONED") {
          throw new AppError(409, "invalid_payment_transition", "Order status changed before payment failure could be applied.");
        }

        const claimedPayment = await tx.payment.updateMany({
          where: {
            id: payment.id,
            status: { in: ["PENDING", "REQUIRES_ACTION", "FAILED"] }
          },
          data: { status: "FAILED" }
        });
        if (claimedPayment.count !== 1) {
          throw new AppError(409, "invalid_payment_transition", "Payment status changed before failure could be applied.");
        }

        updatedPayment = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
        if (released) {
          const cancelledOrder = await tx.order.findUniqueOrThrow({
            where: { id: order.id },
            include: { items: true }
          });
          await queueOrderEmail(tx, cancelledOrder, {
            eventType: "ORDER_STATUS_CHANGED",
            previousStatus: order.status
          });
          orderId = cancelledOrder.id;
        }
      } else {
        if (!["SUCCEEDED", "REFUNDED"].includes(payment.status)) {
          throw new AppError(409, "invalid_payment_transition", "Only a successful payment can be refunded.");
        }
        if (!["PAID", "FULFILLED", "REFUNDED"].includes(order.status)) {
          throw new AppError(409, "order_not_refundable", "This order cannot be refunded.");
        }

        const metadata = jsonRecord(payment.metadata);
        const previousRefundedCents = typeof metadata.refundedCents === "number"
          ? metadata.refundedCents
          : 0;
        if (!input.fullRefund && input.amountCents === undefined) {
          throw new AppError(422, "payment_refund_amount_missing", "Refund event amount is missing.");
        }
        refundedCents = input.fullRefund
          ? payment.amountCents
          : input.refundAmountIsCumulative
            ? Math.max(previousRefundedCents, input.amountCents ?? 0)
            : previousRefundedCents + (input.amountCents ?? 0);
        refundedCents = Math.min(payment.amountCents, refundedCents);
        partialRefund = refundedCents < payment.amountCents;

        if (partialRefund) {
          updatedPayment = await tx.payment.update({
            where: { id: payment.id },
            data: {
              metadata: {
                ...metadata,
                refundedCents
              } as Prisma.InputJsonObject
            }
          });
        } else {
          updatedPayment = payment.status === "REFUNDED"
            ? payment
            : await tx.payment.update({
                where: { id: payment.id },
                data: {
                  status: "REFUNDED",
                  metadata: {
                    ...metadata,
                    refundedCents
                  } as Prisma.InputJsonObject
                }
              });

          if (order.status !== "REFUNDED") {
            const refundedOrder = await tx.order.update({
              where: { id: order.id },
              data: { status: "REFUNDED" },
              include: { items: true }
            });
            await queueOrderEmail(tx, refundedOrder, { eventType: "ORDER_REFUNDED" });
            orderId = refundedOrder.id;
          }
        }
      }

      const processedWebhook = await tx.paymentWebhook.update({
        where: { id: webhook.id },
        data: { processedAt: new Date() }
      });

      return {
        webhook: processedWebhook,
        payment: updatedPayment,
        status: partialRefund ? updatedPayment.status : nextStatus,
        partialRefund,
        refundedCents,
        orderId
      };
    });

    if (result.orderId) {
      await deliverQueuedOrderEmails(context, { orderId: result.orderId });
    }

    return result;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const duplicate = await context.prisma.paymentWebhook.findUnique({
        where: { providerEventId: input.providerEventId }
      });
      if (duplicate) return { webhook: duplicate, duplicate: true };
    }

    throw error;
  }
}
