import { Prisma, type PaymentProvider, type PaymentStatus } from "@prisma/client";
import { AppError } from "../../core/errors/app-error.js";
import type { ModuleContext } from "../../core/types/module.js";
import { releaseExpiredOrderReservations } from "../orders/checkout.service.js";
import {
  consumeInventoryReservation,
  releaseInventoryReservation
} from "../orders/inventory-reservation.service.js";
import { deliverQueuedOrderEmails, orderAccountUrl, queueOrderEmail } from "../orders/order-email.service.js";

export type NormalizedPaymentEvent = {
  provider: PaymentProvider;
  eventType:
    | "payment.succeeded"
    | "payment.failed"
    | "payment.refunded"
    | "payment.refund_pending"
    | "payment.refund_failed";
  providerEventId: string;
  providerReference?: string;
  refundReference?: string;
  refundRecordId?: string;
  captureReference?: string;
  paymentId?: string;
  amountCents?: number;
  currency?: string;
  fullRefund?: boolean;
  refundAmountIsCumulative?: boolean;
  failureMessage?: string;
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
    ? value
    : {};
}

function assertPaymentMatchesEvent(
  payment: { id: string; provider: PaymentProvider; providerReference: string | null; amountCents: number; currency: string },
  input: NormalizedPaymentEvent
) {
  if (
    payment.provider !== input.provider ||
    (input.providerReference && payment.providerReference !== input.providerReference)
  ) {
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
      const refundState = input.eventType === "payment.refund_pending"
        ? "PENDING" as const
        : input.eventType === "payment.refund_failed"
          ? "FAILED" as const
          : undefined;
      if (!nextStatus && !refundState) {
        throw new AppError(422, "unsupported_payment_event", "Payment event is not supported.");
      }

      const webhook = await tx.paymentWebhook.create({
        data: {
          provider: input.provider,
          eventType: input.eventType,
          providerEventId: input.providerEventId,
          providerReference: input.providerReference || input.refundReference || input.captureReference,
          payload: input.payload as Prisma.InputJsonValue
        }
      });
      const referencedRefund = input.refundRecordId
        ? await tx.paymentRefund.findFirst({
            where: { id: input.refundRecordId, provider: input.provider }
          })
        : input.refundReference
          ? await tx.paymentRefund.findFirst({
              where: { provider: input.provider, providerReference: input.refundReference }
            })
          : null;
      const candidatePayment = input.paymentId
        ? await tx.payment.findUnique({ where: { id: input.paymentId } })
        : referencedRefund
          ? await tx.payment.findUnique({ where: { id: referencedRefund.paymentId } })
          : input.captureReference
            ? await tx.payment.findFirst({
                where: {
                  provider: input.provider,
                  metadata: { path: ["providerCaptureReference"], equals: input.captureReference }
                }
              })
            : input.providerReference
              ? await tx.payment.findFirst({
                  where: {
                    provider: input.provider,
                    providerReference: input.providerReference
                  }
                })
              : null;

      if (!candidatePayment || !candidatePayment.orderId) {
        throw new AppError(404, "payment_not_found", "Payment was not found.");
      }
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Payment" WHERE "id" = ${candidatePayment.id} FOR UPDATE`
      );
      let payment = await tx.payment.findUniqueOrThrow({
        where: { id: candidatePayment.id }
      });
      if (!payment.orderId) {
        throw new AppError(404, "payment_order_missing", "Payment is not linked to an order.");
      }
      assertPaymentMatchesEvent(payment, input);

      if (
        input.captureReference &&
        jsonRecord(payment.metadata).providerCaptureReference !== input.captureReference
      ) {
        payment = await tx.payment.update({
          where: { id: payment.id },
          data: {
            metadata: {
              ...jsonRecord(payment.metadata),
              providerCaptureReference: input.captureReference
            }
          }
        });
      }

      const order = await tx.order.findUnique({
        where: { id: payment.orderId! },
        include: { items: true }
      });
      if (!order) {
        throw new AppError(404, "order_not_found", "Order was not found.");
      }

      let updatedPayment = payment;
      let orderId: string | undefined;
      let partialRefund = false;
      let refundedCents: number | undefined;

      if (refundState) {
        let matchingRefund = input.refundRecordId
          ? await tx.paymentRefund.findFirst({
              where: {
                id: input.refundRecordId,
                paymentId: payment.id,
                provider: input.provider
              }
            })
          : input.refundReference
            ? await tx.paymentRefund.findFirst({
                where: {
                  paymentId: payment.id,
                  provider: input.provider,
                  providerReference: input.refundReference
                }
              })
            : null;
        if (
          input.amountCents !== undefined &&
          (!Number.isInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > payment.amountCents)
        ) {
          throw new AppError(409, "payment_refund_amount_mismatch", "Refund event amount is invalid.");
        }
        if (!matchingRefund && input.refundReference && input.amountCents !== undefined) {
          matchingRefund = await tx.paymentRefund.findFirst({
            where: {
              paymentId: payment.id,
              provider: input.provider,
              providerReference: null,
              status: "SUCCEEDED",
              amountCents: input.amountCents
            },
            orderBy: { createdAt: "desc" }
          });
        }

        let updatedRefund = matchingRefund;
        if (matchingRefund) {
          if (
            input.amountCents !== undefined && matchingRefund.amountCents !== input.amountCents ||
            input.currency && matchingRefund.currency.toUpperCase() !== input.currency.toUpperCase()
          ) {
            throw new AppError(409, "payment_refund_mismatch", "Refund event does not match the stored refund.");
          }
          if (matchingRefund.status !== "SUCCEEDED") {
            updatedRefund = await tx.paymentRefund.update({
              where: { id: matchingRefund.id },
              data: {
                status: refundState,
                ...(input.refundReference ? { providerReference: input.refundReference } : {}),
                failureMessage: refundState === "FAILED"
                  ? input.failureMessage?.slice(0, 500) || "The payment provider reported that the refund failed."
                  : null
              }
            });
          } else if (input.refundReference && !matchingRefund.providerReference) {
            updatedRefund = await tx.paymentRefund.update({
              where: { id: matchingRefund.id },
              data: { providerReference: input.refundReference }
            });
          }
        } else if (input.amountCents !== undefined) {
          updatedRefund = await tx.paymentRefund.create({
            data: {
              paymentId: payment.id,
              provider: input.provider,
              status: refundState,
              amountCents: input.amountCents,
              currency: input.currency || payment.currency,
              reason: "OTHER",
              idempotencyKey: `webhook:${input.provider}:${input.providerEventId}`,
              providerReference: input.refundReference,
              failureMessage: refundState === "FAILED"
                ? input.failureMessage?.slice(0, 500) || "The payment provider reported that the refund failed."
                : null
            }
          });
        }

        const processedWebhook = await tx.paymentWebhook.update({
          where: { id: webhook.id },
          data: { processedAt: new Date() }
        });
        return {
          webhook: processedWebhook,
          payment,
          refund: updatedRefund,
          status: payment.status,
          partialRefund: false,
          refundedCents: undefined,
          orderId: undefined
        };
      }

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

          await consumeInventoryReservation(tx, order.id);

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
          await queueOrderEmail(tx, paidOrder, {
            eventType: "ORDER_PAID",
            accountUrl: orderAccountUrl(context)
          });
          orderId = paidOrder.id;
        }
      } else if (nextStatus === "FAILED") {
        if (["SUCCEEDED", "REFUNDED"].includes(payment.status)) {
          throw new AppError(409, "invalid_payment_transition", "A completed payment cannot be marked as failed.");
        }

        await releaseInventoryReservation(tx, order.id, { reason: "payment_failed" });

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
        let matchingRefund = input.refundRecordId
          ? await tx.paymentRefund.findFirst({
              where: {
                id: input.refundRecordId,
                paymentId: payment.id,
                provider: input.provider
              }
            })
          : input.refundReference
            ? await tx.paymentRefund.findFirst({
                where: {
                  provider: input.provider,
                  providerReference: input.refundReference
                }
              })
            : null;
        if (
          matchingRefund?.providerReference &&
          input.refundReference &&
          matchingRefund.providerReference !== input.refundReference
        ) {
          throw new AppError(409, "payment_refund_mismatch", "Refund event does not match the stored refund.");
        }
        if (!input.fullRefund && input.amountCents === undefined) {
          throw new AppError(422, "payment_refund_amount_missing", "Refund event amount is missing.");
        }
        if (
          input.amountCents !== undefined &&
          (!Number.isInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > payment.amountCents)
        ) {
          throw new AppError(409, "payment_refund_amount_mismatch", "Refund event amount is invalid.");
        }
        const eventRefundedCents = input.fullRefund
          ? payment.amountCents
          : input.refundAmountIsCumulative
            ? input.amountCents ?? 0
            : previousRefundedCents + (input.amountCents ?? 0);
        if (eventRefundedCents > payment.amountCents) {
          throw new AppError(409, "payment_refund_amount_mismatch", "Refund event exceeds the payment amount.");
        }
        const eventAppliedCents = Math.max(0, eventRefundedCents - previousRefundedCents);
        if (!matchingRefund && input.refundReference && input.amountCents !== undefined) {
          matchingRefund = await tx.paymentRefund.findFirst({
            where: {
              paymentId: payment.id,
              provider: input.provider,
              providerReference: null,
              status: "SUCCEEDED",
              amountCents: input.amountCents
            },
            orderBy: { createdAt: "desc" }
          });
        }
        if (!matchingRefund && !input.refundReference && eventAppliedCents > 0) {
          matchingRefund = await tx.paymentRefund.findFirst({
            where: {
              paymentId: payment.id,
              provider: input.provider,
              status: "PENDING",
              amountCents: eventAppliedCents
            }
          });
        }
        const refundAlreadyApplied = matchingRefund?.status === "SUCCEEDED";
        refundedCents = refundAlreadyApplied
          ? previousRefundedCents
          : Math.max(previousRefundedCents, eventRefundedCents);
        partialRefund = refundedCents < payment.amountCents;
        const appliedRefundCents = Math.max(0, refundedCents - previousRefundedCents);

        if (appliedRefundCents > 0 && partialRefund) {
          updatedPayment = await tx.payment.update({
            where: { id: payment.id },
            data: {
              metadata: {
                ...metadata,
                refundedCents
              }
            }
          });
        } else if (appliedRefundCents > 0) {
          updatedPayment = payment.status === "REFUNDED"
            ? payment
            : await tx.payment.update({
                where: { id: payment.id },
                data: {
                  status: "REFUNDED",
                  metadata: {
                    ...metadata,
                    refundedCents
                  }
                }
              });

        }

        if (matchingRefund) {
          await tx.paymentRefund.update({
            where: { id: matchingRefund.id },
            data: {
              status: "SUCCEEDED",
              ...(input.refundReference ? { providerReference: input.refundReference } : {}),
              failureMessage: null,
              completedAt: matchingRefund.completedAt ?? new Date()
            }
          });
          if (matchingRefund.supportCaseId) {
            const supportCase = await tx.orderSupportCase.findUnique({
              where: { id: matchingRefund.supportCaseId }
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
        } else if (appliedRefundCents > 0) {
          await tx.paymentRefund.create({
            data: {
              paymentId: payment.id,
              provider: input.provider,
              status: "SUCCEEDED",
              amountCents: appliedRefundCents,
              currency: payment.currency,
              reason: "OTHER",
              idempotencyKey: `webhook:${input.provider}:${input.providerEventId}`,
              providerReference: input.refundReference,
              completedAt: new Date()
            }
          });
        }

        if (appliedRefundCents > 0) {
          const orderMetadata = jsonRecord(order.metadata);
          const refundedOrder = await tx.order.update({
            where: { id: order.id },
            data: {
              ...(partialRefund ? {} : { status: "REFUNDED" as const }),
              metadata: {
                ...orderMetadata,
                refundedCents
              }
            },
            include: { items: true }
          });
          await queueOrderEmail(tx, refundedOrder, {
            eventType: "ORDER_REFUNDED",
            refundedCents: appliedRefundCents,
            accountUrl: orderAccountUrl(context)
          });
          orderId = refundedOrder.id;
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
