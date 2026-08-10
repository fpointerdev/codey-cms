import { randomBytes } from "node:crypto";
import { Prisma, type Payment, type PaymentProvider } from "@prisma/client";
import type { Request, Router } from "express";
import rateLimit from "express-rate-limit";
import type { ModuleContext } from "../../core/types/module.js";
import { AppError } from "../../core/errors/app-error.js";
import { asyncHandler } from "../../core/http/async-handler.js";
import { sendCreated, sendSuccess } from "../../core/http/response.js";
import { validateRequest } from "../../core/http/validation.middleware.js";
import { requirePermission } from "../auth/auth.middleware.js";
import { createSharedCommerceLimiter } from "../orders/commerce-rate-limit.middleware.js";
import { releaseExpiredOrderReservations } from "../orders/checkout.service.js";
import {
  assertActiveInventoryReservation,
  releaseInventoryReservation,
  reservationExpiry,
  reserveInventoryForOrder
} from "../orders/inventory-reservation.service.js";
import {
  processPaymentEvent,
  statusFromWebhook,
  type NormalizedPaymentEvent
} from "./payment-event.service.js";
import {
  PaymentProviderConfigService,
  type ResolvedPaymentProviderConfig
} from "./payment-provider-config.service.js";
import {
  centsFromPayPalAmount,
  completedPayPalCapture,
  createPayPalOrder,
  capturePayPalOrder,
  normalizePayPalWebhook,
  paymentStatusFromPayPal,
  retrievePayPalOrder,
  testPayPalConnection,
  verifyPayPalWebhook,
  type PayPalOrder,
  type PayPalWebhookEvent
} from "./paypal-provider.js";
import {
  createStripePaymentIntent,
  normalizeStripeWebhook,
  paymentStatusFromStripe,
  retrieveStripePaymentIntent,
  testStripeConnection,
  verifyStripeWebhook
} from "./stripe-provider.js";
import {
  capturePayPalOrderSchema,
  createPaymentIntentSchema,
  manualPaymentActionSchema,
  manualPaymentParamsSchema,
  paymentProviderParamsSchema,
  updatePaymentProviderConfigSchema
} from "./payments.schemas.js";

export { statusFromWebhook } from "./payment-event.service.js";

function createPaymentLimiter(context: ModuleContext) {
  return rateLimit({
    windowMs: context.config.commerce.checkout.rateLimitWindowMs,
    limit: context.config.commerce.checkout.rateLimitMax,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        success: false,
        data: null,
        error: {
          code: "payment_rate_limit_exceeded",
          message: "Too many payment requests. Please try again later."
        },
        meta: null
      });
    }
  });
}

function createManualReference() {
  return `manual_${randomBytes(12).toString("hex")}`;
}

function requestOrigin(req: Request) {
  return `${req.protocol}://${req.get("host")}`;
}

function allowedPaymentOrigins(context: ModuleContext, req: Request) {
  const origins = new Set<string>();
  if (!context.config.isProduction) origins.add(requestOrigin(req));

  for (const value of [context.config.app.publicUrl, ...context.config.cors.origins]) {
    if (!value || value === "*") continue;
    try {
      origins.add(new URL(value).origin);
    } catch {
      // Environment validation reports malformed configured URLs.
    }
  }

  return origins;
}

function assertAllowedPaymentRedirect(context: ModuleContext, req: Request, value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new AppError(422, "payment_redirect_invalid", "Payment return URLs must use HTTP or HTTPS.");
  }
  if (context.config.isProduction && url.protocol !== "https:") {
    throw new AppError(422, "payment_redirect_insecure", "Payment return URLs must use HTTPS in production.");
  }
  if (!allowedPaymentOrigins(context, req).has(url.origin)) {
    throw new AppError(
      422,
      "payment_redirect_origin_not_allowed",
      "Payment return URL origin is not allowed by this CMS deployment."
    );
  }

  return url.toString();
}

function webhookUrls(context: ModuleContext, req: Request) {
  const origin = context.config.app.publicUrl
    ? new URL(context.config.app.publicUrl).origin
    : requestOrigin(req);
  const base = `${origin}${context.config.api.prefix}/payments/webhooks`;
  return {
    stripe: `${base}/stripe`,
    paypal: `${base}/paypal`
  };
}

async function adminProviderResponse(
  service: PaymentProviderConfigService,
  context: ModuleContext,
  req: Request
) {
  return {
    providers: await service.listAdminConfigs(),
    webhookUrls: webhookUrls(context, req)
  };
}

async function providerPayload(
  context: ModuleContext,
  payment: Payment,
  resolved: ResolvedPaymentProviderConfig
) {
  if (payment.provider === "MANUAL") {
    return {
      type: "manual_payment",
      providerReference: payment.providerReference,
      amountCents: payment.amountCents,
      currency: payment.currency,
      instructions: resolved.config.instructions
    };
  }

  if (!payment.providerReference) {
    throw new AppError(409, "payment_provider_reference_missing", "Payment provider setup is not complete yet.");
  }

  if (payment.provider === "STRIPE") {
    const intent = await retrieveStripePaymentIntent({
      secretKey: resolved.credentials.secretKey!,
      providerReference: payment.providerReference
    });
    const providerStatus = paymentStatusFromStripe(intent.status);
    if (["SUCCEEDED", "FAILED"].includes(providerStatus) && payment.status !== providerStatus) {
      await processPaymentEvent(context, {
        provider: "STRIPE",
        eventType: providerStatus === "SUCCEEDED" ? "payment.succeeded" : "payment.failed",
        providerEventId: `stripe-sync:${intent.id}:${intent.status}`,
        providerReference: intent.id,
        paymentId: payment.id,
        amountCents: intent.amount,
        currency: intent.currency.toUpperCase(),
        payload: intent as unknown as Record<string, unknown>
      });
    }

    return {
      type: "stripe_payment_intent",
      providerReference: intent.id,
      clientSecret: intent.client_secret,
      publishableKey: resolved.config.publishableKey,
      status: intent.status
    };
  }

  const order = await retrievePayPalOrder({
    mode: resolved.config.mode,
    clientId: resolved.config.clientId!,
    clientSecret: resolved.credentials.clientSecret!,
    providerReference: payment.providerReference
  });
  const providerStatus = paymentStatusFromPayPal(order.status);
  if (providerStatus === "SUCCEEDED" && payment.status !== "SUCCEEDED") {
    const result = await applyCompletedPayPalOrder(context, payment, order);
    if (!result) {
      throw new AppError(502, "paypal_capture_missing", "PayPal completed the order without capture details.");
    }
  } else if (providerStatus === "FAILED" && payment.status !== "FAILED") {
    await processPaymentEvent(context, {
      provider: "PAYPAL",
      eventType: "payment.failed",
      providerEventId: `paypal-sync:${order.id}:${order.status}`,
      providerReference: order.id,
      paymentId: payment.id,
      payload: order as unknown as Record<string, unknown>
    });
  }

  return {
    type: "paypal_order",
    providerReference: order.id,
    approveUrl: order.approveUrl,
    clientId: resolved.config.clientId,
    status: order.status
  };
}

async function paymentResponse(
  context: ModuleContext,
  payment: Payment,
  resolved: ResolvedPaymentProviderConfig
) {
  const payload = await providerPayload(context, payment, resolved);
  const currentPayment = await context.prisma.payment.findUniqueOrThrow({
    where: { id: payment.id }
  });

  return {
    payment: currentPayment,
    providerPayload: payload
  };
}

async function initializeProviderPayment(input: {
  context: ModuleContext;
  payment: Payment;
  order: {
    id: string;
    orderNumber: string;
    totalCents: number;
    currency: string;
  };
  resolved: ResolvedPaymentProviderConfig;
  returnUrl?: string;
  cancelUrl?: string;
}) {
  const { context, payment, order, resolved } = input;

  if (payment.provider === "MANUAL") {
    return context.prisma.payment.update({
      where: { id: payment.id },
      data: {
        providerReference: payment.providerReference ?? createManualReference(),
        status: "PENDING"
      }
    });
  }

  if (payment.provider === "STRIPE") {
    const intent = await createStripePaymentIntent({
      secretKey: resolved.credentials.secretKey!,
      paymentId: payment.id,
      orderId: order.id,
      orderNumber: order.orderNumber,
      amountCents: order.totalCents,
      currency: order.currency
    });
    const status = paymentStatusFromStripe(intent.status);
    const updated = await context.prisma.payment.update({
      where: { id: payment.id },
      data: {
        providerReference: intent.id,
        status: ["SUCCEEDED", "FAILED"].includes(status) ? "PENDING" : status
      }
    });

    if (["SUCCEEDED", "FAILED"].includes(status)) {
      await processPaymentEvent(context, {
        provider: "STRIPE",
        eventType: status === "SUCCEEDED" ? "payment.succeeded" : "payment.failed",
        providerEventId: `stripe-create:${intent.id}:${intent.status}`,
        providerReference: intent.id,
        paymentId: updated.id,
        amountCents: intent.amount,
        currency: intent.currency.toUpperCase(),
        payload: intent as unknown as Record<string, unknown>
      });
      return context.prisma.payment.findUniqueOrThrow({ where: { id: updated.id } });
    }

    return updated;
  }

  const paypalOrder = await createPayPalOrder({
    mode: resolved.config.mode,
    clientId: resolved.config.clientId!,
    clientSecret: resolved.credentials.clientSecret!,
    paymentId: payment.id,
    orderId: order.id,
    orderNumber: order.orderNumber,
    amountCents: order.totalCents,
    currency: order.currency,
    returnUrl: input.returnUrl!,
    cancelUrl: input.cancelUrl!
  });

  const providerStatus = paymentStatusFromPayPal(paypalOrder.status);
  const updated = await context.prisma.payment.update({
    where: { id: payment.id },
    data: {
      providerReference: paypalOrder.id,
      status: ["SUCCEEDED", "FAILED"].includes(providerStatus) ? "PENDING" : providerStatus
    }
  });

  if (providerStatus === "SUCCEEDED") {
    const result = await applyCompletedPayPalOrder(context, updated, paypalOrder);
    if (!result) {
      throw new AppError(502, "paypal_capture_missing", "PayPal completed the order without capture details.");
    }
    return context.prisma.payment.findUniqueOrThrow({ where: { id: updated.id } });
  }
  if (providerStatus === "FAILED") {
    await processPaymentEvent(context, {
      provider: "PAYPAL",
      eventType: "payment.failed",
      providerEventId: `paypal-create:${paypalOrder.id}:${paypalOrder.status}`,
      providerReference: paypalOrder.id,
      paymentId: updated.id,
      payload: paypalOrder as unknown as Record<string, unknown>
    });
    return context.prisma.payment.findUniqueOrThrow({ where: { id: updated.id } });
  }

  return updated;
}

function paymentEventForManualAction(
  payment: Payment,
  action: "SUCCEED" | "FAIL" | "REFUND"
): NormalizedPaymentEvent {
  const suffix = action.toLowerCase();
  return {
    provider: "MANUAL",
    eventType: action === "SUCCEED"
      ? "payment.succeeded"
      : action === "FAIL"
        ? "payment.failed"
        : "payment.refunded",
    providerEventId: `manual:${payment.id}:${suffix}`,
    providerReference: payment.providerReference!,
    paymentId: payment.id,
    amountCents: payment.amountCents,
    currency: payment.currency,
    fullRefund: action === "REFUND",
    payload: {
      source: "cms_admin",
      action
    }
  };
}

async function applyCompletedPayPalOrder(
  context: ModuleContext,
  payment: Payment,
  paypalOrder: PayPalOrder
) {
  const capture = completedPayPalCapture(paypalOrder);
  if (!capture) return null;

  return processPaymentEvent(context, {
    provider: "PAYPAL",
    eventType: "payment.succeeded",
    providerEventId: `paypal-capture:${capture.id}`,
    providerReference: payment.providerReference!,
    paymentId: payment.id,
    amountCents: centsFromPayPalAmount(capture.amount),
    currency: capture.amount?.currency_code?.toUpperCase(),
    payload: paypalOrder as unknown as Record<string, unknown>
  });
}

async function claimPendingPayment(input: {
  context: ModuleContext;
  orderId: string;
  provider: PaymentProvider;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}) {
  return input.context.prisma.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Order" WHERE "id" = ${input.orderId} FOR UPDATE`
    );
    const order = await tx.order.findUnique({ where: { id: input.orderId } });
    if (!order) throw new AppError(404, "order_not_found", "Order not found.");
    if (order.status !== "PENDING" || order.checkoutStatus !== "PAYMENT_PENDING") {
      throw new AppError(409, "order_not_payable", "This order cannot be paid.");
    }

    const activePayment = await tx.payment.findFirst({
      where: {
        orderId: order.id,
        status: { in: ["PENDING", "REQUIRES_ACTION"] }
      },
      orderBy: { createdAt: "desc" }
    });
    if (activePayment && activePayment.provider !== input.provider) {
      throw new AppError(
        409,
        "payment_provider_switch_blocked",
        `This order already has an active ${activePayment.provider} payment.`
      );
    }

    await reserveInventoryForOrder(tx, order.id, reservationExpiry(input.context));

    if (activePayment) {
      return { order, payment: activePayment, created: false };
    }

    const payment = await tx.payment.create({
      data: {
        orderId: order.id,
        provider: input.provider,
        status: "PENDING",
        amountCents: order.totalCents,
        currency: order.currency,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata as Prisma.InputJsonValue | undefined
      }
    });

    return { order, payment, created: true };
  });
}

async function authorizePayPalCapture(context: ModuleContext, orderId: string) {
  return context.prisma.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`
    );
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order || order.status !== "PENDING") {
      throw new AppError(409, "order_not_payable", "This order cannot be paid.");
    }
    if (order.checkoutStatus === "PAYMENT_AUTHORIZED") return order;
    if (order.checkoutStatus !== "PAYMENT_PENDING") {
      throw new AppError(409, "order_reservation_expired", "The inventory reservation has expired.");
    }
    await assertActiveInventoryReservation(tx, order.id);

    return tx.order.update({
      where: { id: order.id },
      data: { checkoutStatus: "PAYMENT_AUTHORIZED" }
    });
  });
}

export function registerPaymentRoutes(router: Router, context: ModuleContext) {
  const paymentLimiter = createPaymentLimiter(context);
  const paymentIntentLimiter = createSharedCommerceLimiter(context, "payment.intent");
  const providerService = new PaymentProviderConfigService(context);

  router.get(
    "/providers/public",
    asyncHandler(async (_req, res) => {
      return sendSuccess(res, { providers: await providerService.listPublicProviders() });
    })
  );

  router.get(
    "/providers",
    requirePermission(context, "read", "payments"),
    asyncHandler(async (req, res) => {
      return sendSuccess(res, await adminProviderResponse(providerService, context, req));
    })
  );

  router.put(
    "/providers/:provider",
    requirePermission(context, "update", "payments"),
    validateRequest({
      params: paymentProviderParamsSchema,
      body: updatePaymentProviderConfigSchema
    }),
    asyncHandler(async (req, res) => {
      const provider = req.params.provider as PaymentProvider;
      const config = await providerService.updateConfig(provider, req.body);
      await providerService.writeAuditLog({
        actorUserId: req.user?.id,
        action: "payment_provider.update",
        provider,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        metadata: {
          mode: config.mode,
          enabled: config.enabled,
          publishableKeyConfigured: Boolean(config.publishableKey),
          clientIdConfigured: Boolean(config.clientId),
          webhookIdConfigured: Boolean(config.webhookId)
        }
      });

      return sendSuccess(res, await adminProviderResponse(providerService, context, req));
    })
  );

  router.post(
    "/providers/:provider/test",
    requirePermission(context, "update", "payments"),
    paymentLimiter,
    validateRequest({ params: paymentProviderParamsSchema }),
    asyncHandler(async (req, res) => {
      const provider = req.params.provider as PaymentProvider;
      if (provider === "MANUAL") {
        throw new AppError(422, "manual_provider_test_not_required", "Manual payments do not require a connection test.");
      }

      const resolved = await providerService.resolveConfig(provider);
      try {
        const message = provider === "STRIPE"
          ? await testStripeConnection(resolved.credentials.secretKey!)
          : await testPayPalConnection({
              mode: resolved.config.mode,
              clientId: resolved.config.clientId!,
              clientSecret: resolved.credentials.clientSecret!,
              webhookId: resolved.config.webhookId!
            });
        await providerService.recordTestResult(provider, true, message);
        await providerService.writeAuditLog({
          actorUserId: req.user?.id,
          action: "payment_provider.test_succeeded",
          provider,
          ipAddress: req.ip,
          userAgent: req.get("user-agent")
        });

        return sendSuccess(res, {
          message,
          ...await adminProviderResponse(providerService, context, req)
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Provider connection test failed.";
        await providerService.recordTestResult(provider, false, message);
        await providerService.writeAuditLog({
          actorUserId: req.user?.id,
          action: "payment_provider.test_failed",
          provider,
          ipAddress: req.ip,
          userAgent: req.get("user-agent")
        });
        throw error;
      }
    })
  );

  router.get(
    "/",
    requirePermission(context, "read", "payments"),
    asyncHandler(async (_req, res) => {
      const payments = await context.prisma.payment.findMany({
        orderBy: { createdAt: "desc" },
        take: 200
      });
      return sendSuccess(res, { payments });
    })
  );

  router.post(
    "/intent",
    paymentIntentLimiter,
    paymentLimiter,
    validateRequest({ body: createPaymentIntentSchema }),
    asyncHandler(async (req, res) => {
      const input = req.body as {
        orderId: string;
        provider: PaymentProvider;
        idempotencyKey?: string;
        metadata?: Record<string, unknown>;
        returnUrl?: string;
        cancelUrl?: string;
      };
      await releaseExpiredOrderReservations(context);

      if (input.idempotencyKey) {
        const existingPayment = await context.prisma.payment.findUnique({
          where: { idempotencyKey: input.idempotencyKey }
        });
        if (existingPayment) {
          if (existingPayment.orderId !== input.orderId || existingPayment.provider !== input.provider) {
            throw new AppError(
              409,
              "payment_idempotency_conflict",
              "Idempotency key is already used for a different payment."
            );
          }

          if (existingPayment.status === "FAILED" && !existingPayment.providerReference) {
            throw new AppError(
              409,
              "payment_initialization_failed",
              "The provider rejected this payment setup. Retry with a new idempotency key after correcting the request or provider settings."
            );
          }

          const resolved = await providerService.resolveConfig(existingPayment.provider);
          return sendSuccess(res, await paymentResponse(context, existingPayment, resolved));
        }
      }

      const resolved = await providerService.resolveConfig(input.provider, { requireEnabled: true });
      const returnUrl = input.returnUrl
        ? assertAllowedPaymentRedirect(context, req, input.returnUrl)
        : undefined;
      const cancelUrl = input.cancelUrl
        ? assertAllowedPaymentRedirect(context, req, input.cancelUrl)
        : undefined;
      const claimed = await claimPendingPayment({
        context,
        orderId: input.orderId,
        provider: input.provider,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata
      });
      let payment = claimed.payment;
      if (!payment.providerReference) {
        try {
          payment = await initializeProviderPayment({
            context,
            payment,
            order: claimed.order,
            resolved,
            returnUrl,
            cancelUrl
          });
        } catch (error) {
          await context.prisma.$transaction(async (tx) => {
            const failed = await tx.payment.updateMany({
              where: {
                id: payment.id,
                providerReference: null,
                status: { in: ["PENDING", "REQUIRES_ACTION"] }
              },
              data: { status: "FAILED" }
            });
            if (failed.count === 1) {
              await releaseInventoryReservation(tx, input.orderId, {
                reason: "provider_initialization_failed"
              });
            }
          });
          throw error;
        }
      }
      const response = await paymentResponse(context, payment, resolved);

      return claimed.created ? sendCreated(res, response) : sendSuccess(res, response);
    })
  );

  router.post(
    "/paypal/capture",
    paymentLimiter,
    validateRequest({ body: capturePayPalOrderSchema }),
    asyncHandler(async (req, res) => {
      await releaseExpiredOrderReservations(context);
      const payment = await context.prisma.payment.findFirst({
        where: {
          provider: "PAYPAL",
          orderId: req.body.orderId,
          providerReference: req.body.providerReference
        }
      });
      if (!payment) throw new AppError(404, "payment_not_found", "PayPal payment was not found.");
      if (payment.status === "FAILED" || payment.status === "REFUNDED") {
        throw new AppError(409, "payment_not_capturable", "This PayPal payment cannot be captured.");
      }
      if (payment.status === "SUCCEEDED") {
        return sendSuccess(res, { payment, duplicate: true });
      }
      const localOrder = await context.prisma.order.findUnique({ where: { id: payment.orderId! } });
      if (
        !localOrder ||
        localOrder.status !== "PENDING" ||
        !["PAYMENT_PENDING", "PAYMENT_AUTHORIZED"].includes(localOrder.checkoutStatus)
      ) {
        throw new AppError(409, "order_not_payable", "This order cannot be paid.");
      }

      const resolved = await providerService.resolveConfig("PAYPAL");
      const existingOrder = await retrievePayPalOrder({
        mode: resolved.config.mode,
        clientId: resolved.config.clientId!,
        clientSecret: resolved.credentials.clientSecret!,
        providerReference: payment.providerReference!
      });
      const existingCapture = await applyCompletedPayPalOrder(context, payment, existingOrder);
      if (existingCapture) return sendSuccess(res, existingCapture);
      const existingStatus = paymentStatusFromPayPal(existingOrder.status);
      if (existingStatus === "SUCCEEDED") {
        throw new AppError(502, "paypal_capture_missing", "PayPal completed the order without capture details.");
      }
      if (existingStatus === "FAILED") {
        return sendSuccess(res, await processPaymentEvent(context, {
          provider: "PAYPAL",
          eventType: "payment.failed",
          providerEventId: `paypal-capture-sync:${existingOrder.id}:${existingOrder.status}`,
          providerReference: payment.providerReference!,
          paymentId: payment.id,
          payload: existingOrder as unknown as Record<string, unknown>
        }));
      }
      if (existingOrder.status !== "APPROVED") {
        throw new AppError(
          409,
          "paypal_order_not_approved",
          "The buyer must approve this PayPal order before it can be captured."
        );
      }

      await authorizePayPalCapture(context, localOrder.id);

      const paypalOrder = await capturePayPalOrder({
        mode: resolved.config.mode,
        clientId: resolved.config.clientId!,
        clientSecret: resolved.credentials.clientSecret!,
        providerReference: payment.providerReference!,
        paymentId: payment.id
      });
      const captureResult = await applyCompletedPayPalOrder(context, payment, paypalOrder);
      if (!captureResult) {
        const status = paymentStatusFromPayPal(paypalOrder.status);
        if (status === "SUCCEEDED") {
          throw new AppError(502, "paypal_capture_missing", "PayPal completed the order without capture details.");
        }
        if (status === "FAILED") {
          return sendSuccess(res, await processPaymentEvent(context, {
            provider: "PAYPAL",
            eventType: "payment.failed",
            providerEventId: `paypal-capture-failed:${paypalOrder.id}:${paypalOrder.status}`,
            providerReference: payment.providerReference!,
            paymentId: payment.id,
            payload: paypalOrder as unknown as Record<string, unknown>
          }));
        }
        const updatedPayment = await context.prisma.payment.update({
          where: { id: payment.id },
          data: { status }
        });
        return sendSuccess(res, { payment: updatedPayment, providerStatus: paypalOrder.status });
      }

      return sendSuccess(res, captureResult);
    })
  );

  router.post(
    "/manual/:paymentId/action",
    requirePermission(context, "update", "payments"),
    validateRequest({ params: manualPaymentParamsSchema, body: manualPaymentActionSchema }),
    asyncHandler(async (req, res) => {
      const payment = await context.prisma.payment.findUnique({ where: { id: req.params.paymentId } });
      if (!payment || payment.provider !== "MANUAL" || !payment.providerReference) {
        throw new AppError(404, "payment_not_found", "Manual payment was not found.");
      }
      const action = req.body.action as "SUCCEED" | "FAIL" | "REFUND";
      const result = await processPaymentEvent(context, paymentEventForManualAction(payment, action));
      await providerService.writeAuditLog({
        actorUserId: req.user?.id,
        action: `manual_payment.${action.toLowerCase()}`,
        provider: "MANUAL",
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        metadata: { paymentId: payment.id, orderId: payment.orderId }
      });

      return sendSuccess(res, result);
    })
  );

  router.post(
    "/webhooks/stripe",
    asyncHandler(async (req, res) => {
      const resolved = await providerService.resolveConfig("STRIPE");
      if (!req.rawBody) {
        throw new AppError(400, "stripe_webhook_body_missing", "Stripe webhook body is missing.");
      }
      const event = verifyStripeWebhook({
        rawBody: req.rawBody,
        signatureHeader: req.get("stripe-signature"),
        webhookSecret: resolved.credentials.webhookSecret!
      });
      await providerService.recordWebhookReceived("STRIPE");
      const normalized = normalizeStripeWebhook(event);
      if (!normalized) return sendSuccess(res, { received: true, ignored: true });

      return sendSuccess(res, await processPaymentEvent(context, normalized));
    })
  );

  router.post(
    "/webhooks/paypal",
    asyncHandler(async (req, res) => {
      const event = req.body as PayPalWebhookEvent;
      if (!event || typeof event.id !== "string" || typeof event.event_type !== "string") {
        throw new AppError(400, "paypal_webhook_invalid", "PayPal webhook body is invalid.");
      }
      const resolved = await providerService.resolveConfig("PAYPAL");
      await verifyPayPalWebhook({
        mode: resolved.config.mode,
        clientId: resolved.config.clientId!,
        clientSecret: resolved.credentials.clientSecret!,
        webhookId: resolved.config.webhookId!,
        headers: {
          authAlgo: req.get("paypal-auth-algo"),
          certUrl: req.get("paypal-cert-url"),
          transmissionId: req.get("paypal-transmission-id"),
          transmissionSignature: req.get("paypal-transmission-sig"),
          transmissionTime: req.get("paypal-transmission-time")
        },
        event
      });
      await providerService.recordWebhookReceived("PAYPAL");
      const normalized = normalizePayPalWebhook(event);
      if (!normalized) return sendSuccess(res, { received: true, ignored: true });

      return sendSuccess(res, await processPaymentEvent(context, normalized));
    })
  );
}
