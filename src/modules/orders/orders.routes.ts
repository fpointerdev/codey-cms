import type { Router } from "express";
import rateLimit from "express-rate-limit";
import { Prisma } from "@prisma/client";
import type { ModuleContext } from "../../core/types/module.js";
import { asyncHandler } from "../../core/http/async-handler.js";
import { sendCreated, sendSuccess } from "../../core/http/response.js";
import { validateRequest } from "../../core/http/validation.middleware.js";
import { requirePermission } from "../auth/auth.middleware.js";
import { createSharedCommerceLimiter } from "./commerce-rate-limit.middleware.js";
import {
  cartItemParams,
  cartTokenParams,
  checkoutCartSchema,
  checkoutLimitSchemas,
  commerceResourceParams,
  createCartSchema,
  createCouponSchema,
  customerDataAnonymizeSchema,
  customerDataExportSchema,
  createShippingRateSchema,
  createShippingZoneSchema,
  createTaxRuleSchema,
  lookupOrderSchema,
  orderNotificationIdParams,
  orderIdParams,
  shippingZoneIdParams,
  updateCheckoutStatusSchema,
  updateOrderStatusSchema
} from "./orders.schemas.js";
import {
  addCartItem,
  assertMerchantCheckoutTransition,
  assertMerchantOrderTransition,
  checkoutCart,
  createCart,
  createOrder,
  getCart,
  lookupOrder,
  removeCartItem,
  releaseExpiredOrderReservations,
  releaseOrderInventoryReservation,
  updateCartItem
} from "./checkout.service.js";
import {
  anonymizeCustomerData,
  auditCustomerDataExport,
  exportCustomerData
} from "./customer-data.service.js";
import { deliverQueuedOrderEmails, queueOrderEmail, requeueOrderEmail } from "./order-email.service.js";
import { adminOrderDto } from "./order-lookup.js";

function createCheckoutLimiter(context: ModuleContext) {
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
          code: "checkout_rate_limit_exceeded",
          message: "Too many checkout requests. Please try again later."
        },
        meta: null
      });
    }
  });
}

export function registerOrderRoutes(router: Router, context: ModuleContext) {
  const limitSchemas = checkoutLimitSchemas(context.config.commerce.checkout);
  const checkoutLimiter = createCheckoutLimiter(context);
  const createCartLimiter = createSharedCommerceLimiter(context, "cart.create");
  const checkoutCartLimiter = createSharedCommerceLimiter(context, "cart.checkout");
  const createOrderLimiter = createSharedCommerceLimiter(context, "order.create");
  const lookupOrderLimiter = createSharedCommerceLimiter(context, "order.lookup");
  const cleanupTimer = setInterval(() => {
    void releaseExpiredOrderReservations(context).catch((error) => {
      context.logger.error({ err: error }, "Unable to release expired order reservations");
    });
  }, 60_000);
  cleanupTimer.unref();
  const emailDeliveryTimer = setInterval(() => {
    void deliverQueuedOrderEmails(context).catch((error) => {
      context.logger.error({ err: error }, "Unable to process queued order emails");
    });
  }, 60_000);
  emailDeliveryTimer.unref();

  router.get(
    "/",
    requirePermission(context, "read", "orders"),
    asyncHandler(async (_req, res) => {
      await releaseExpiredOrderReservations(context);
      const orders = await context.prisma.order.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          items: true,
          notifications: { orderBy: { createdAt: "asc" } }
        },
        take: 100
      });

      return sendSuccess(res, { orders: orders.map(adminOrderDto) });
    })
  );

  router.post(
    "/",
    requirePermission(context, "update", "orders"),
    createOrderLimiter,
    validateRequest({ body: limitSchemas.createOrder }),
    asyncHandler(async (req, res) => {
      const order = await createOrder(context, req.body, { ipAddress: req.ip });
      await deliverQueuedOrderEmails(context, { orderId: order.id });

      return sendCreated(res, { order: adminOrderDto(order) });
    })
  );

  router.post(
    "/lookup",
    lookupOrderLimiter,
    validateRequest({ body: lookupOrderSchema }),
    asyncHandler(async (req, res) => {
      const order = await lookupOrder(context, req.body);

      return sendSuccess(res, { order });
    })
  );

  router.post(
    "/carts",
    createCartLimiter,
    checkoutLimiter,
    validateRequest({ body: createCartSchema }),
    asyncHandler(async (req, res) => {
      const cart = await createCart(context, req.body);

      return sendCreated(res, { cart });
    })
  );

  router.get(
    "/carts/:token",
    validateRequest({ params: cartTokenParams }),
    asyncHandler(async (req, res) => {
      const cart = await getCart(context, req.params.token);

      return sendSuccess(res, { cart });
    })
  );

  router.post(
    "/carts/:token/items",
    checkoutLimiter,
    validateRequest({ params: cartTokenParams, body: limitSchemas.addCartItem }),
    asyncHandler(async (req, res) => {
      const cart = await addCartItem(context, req.params.token, req.body);

      return sendSuccess(res, { cart });
    })
  );

  router.patch(
    "/carts/:token/items/:itemId",
    checkoutLimiter,
    validateRequest({ params: cartItemParams, body: limitSchemas.updateCartItem }),
    asyncHandler(async (req, res) => {
      const cart = await updateCartItem(
        context,
        req.params.token,
        req.params.itemId,
        req.body.quantity
      );

      return sendSuccess(res, { cart });
    })
  );

  router.delete(
    "/carts/:token/items/:itemId",
    checkoutLimiter,
    validateRequest({ params: cartItemParams }),
    asyncHandler(async (req, res) => {
      const cart = await removeCartItem(context, req.params.token, req.params.itemId);

      return sendSuccess(res, { cart });
    })
  );

  router.post(
    "/carts/:token/checkout",
    checkoutCartLimiter,
    checkoutLimiter,
    validateRequest({ params: cartTokenParams, body: checkoutCartSchema }),
    asyncHandler(async (req, res) => {
      const order = await checkoutCart(context, req.params.token, req.body, { ipAddress: req.ip });
      await deliverQueuedOrderEmails(context, { orderId: order.id });

      return sendCreated(res, { order: adminOrderDto(order) });
    })
  );

  router.post(
    "/notifications/process",
    requirePermission(context, "update", "orders"),
    asyncHandler(async (_req, res) => {
      const delivery = await deliverQueuedOrderEmails(context);

      return sendSuccess(res, { delivery });
    })
  );

  router.post(
    "/notifications/:notificationId/retry",
    requirePermission(context, "update", "orders"),
    validateRequest({ params: orderNotificationIdParams }),
    asyncHandler(async (req, res) => {
      const delivery = await requeueOrderEmail(context, req.params.notificationId);

      return sendSuccess(res, { delivery });
    })
  );

  router.post(
    "/customers/export",
    requirePermission(context, "read", "orders"),
    validateRequest({ body: customerDataExportSchema }),
    asyncHandler(async (req, res) => {
      const customerData = await exportCustomerData(context, req.body.email);
      await auditCustomerDataExport(context, req.body.email, {
        actorUserId: req.user!.id,
        ipAddress: req.ip,
        userAgent: req.header("user-agent"),
        requestId: req.header("x-request-id")
      }, {
        orders: customerData.orders.length,
        carts: customerData.carts.length,
        payments: customerData.payments.length,
        paymentWebhooks: customerData.paymentWebhooks.length
      });

      return sendSuccess(res, { customerData });
    })
  );

  router.post(
    "/customers/anonymize",
    requirePermission(context, "update", "orders"),
    validateRequest({ body: customerDataAnonymizeSchema }),
    asyncHandler(async (req, res) => {
      const result = await anonymizeCustomerData(context, req.body.email, {
        actorUserId: req.user!.id,
        ipAddress: req.ip,
        userAgent: req.header("user-agent"),
        requestId: req.header("x-request-id")
      });

      return sendSuccess(res, { anonymized: true, ...result });
    })
  );

  router.post(
    "/reservations/release-expired",
    requirePermission(context, "update", "orders"),
    asyncHandler(async (_req, res) => {
      const released = await releaseExpiredOrderReservations(context);

      return sendSuccess(res, { released });
    })
  );

  router.get(
    "/shipping/zones",
    asyncHandler(async (_req, res) => {
      const zones = await context.prisma.shippingZone.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        include: {
          rates: {
            where: { active: true },
            orderBy: [{ sortOrder: "asc" }, { priceCents: "asc" }]
          }
        }
      });

      return sendSuccess(res, { zones });
    })
  );

  router.post(
    "/shipping/zones",
    requirePermission(context, "update", "orders"),
    validateRequest({ body: createShippingZoneSchema }),
    asyncHandler(async (req, res) => {
      const zone = await context.prisma.shippingZone.create({
        data: {
          ...req.body,
          countries: req.body.countries.map((country: string) => country.toUpperCase())
        }
      });

      return sendCreated(res, { zone });
    })
  );

  router.post(
    "/shipping/zones/:id/rates",
    requirePermission(context, "update", "orders"),
    validateRequest({ params: shippingZoneIdParams, body: createShippingRateSchema }),
    asyncHandler(async (req, res) => {
      const rate = await context.prisma.shippingRate.create({
        data: {
          ...req.body,
          zoneId: req.params.id
        }
      });

      return sendCreated(res, { rate });
    })
  );

  router.delete(
    "/shipping/zones/:id",
    requirePermission(context, "update", "orders"),
    validateRequest({ params: commerceResourceParams }),
    asyncHandler(async (req, res) => {
      await context.prisma.shippingZone.delete({ where: { id: req.params.id } });
      return sendSuccess(res, { deleted: true });
    })
  );

  router.get(
    "/tax-rules",
    requirePermission(context, "read", "orders"),
    asyncHandler(async (_req, res) => {
      const taxRules = await context.prisma.taxRule.findMany({
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }]
      });

      return sendSuccess(res, { taxRules });
    })
  );

  router.post(
    "/tax-rules",
    requirePermission(context, "update", "orders"),
    validateRequest({ body: createTaxRuleSchema }),
    asyncHandler(async (req, res) => {
      const taxRule = await context.prisma.taxRule.create({
        data: {
          ...req.body,
          country: req.body.country?.toUpperCase(),
          region: req.body.region?.toUpperCase()
        }
      });

      return sendCreated(res, { taxRule });
    })
  );

  router.delete(
    "/tax-rules/:id",
    requirePermission(context, "update", "orders"),
    validateRequest({ params: commerceResourceParams }),
    asyncHandler(async (req, res) => {
      await context.prisma.taxRule.delete({ where: { id: req.params.id } });
      return sendSuccess(res, { deleted: true });
    })
  );

  router.get(
    "/coupons",
    requirePermission(context, "read", "orders"),
    asyncHandler(async (_req, res) => {
      const coupons = await context.prisma.coupon.findMany({
        orderBy: { createdAt: "desc" },
        take: 100
      });

      return sendSuccess(res, { coupons });
    })
  );

  router.post(
    "/coupons",
    requirePermission(context, "update", "orders"),
    validateRequest({ body: createCouponSchema }),
    asyncHandler(async (req, res) => {
      const coupon = await context.prisma.coupon.create({
        data: {
          ...req.body,
          code: req.body.code.toUpperCase(),
          currency: req.body.currency?.toUpperCase()
        }
      });

      return sendCreated(res, { coupon });
    })
  );

  router.delete(
    "/coupons/:id",
    requirePermission(context, "update", "orders"),
    validateRequest({ params: commerceResourceParams }),
    asyncHandler(async (req, res) => {
      await context.prisma.coupon.delete({ where: { id: req.params.id } });
      return sendSuccess(res, { deleted: true });
    })
  );

  router.patch(
    "/:id/checkout-status",
    requirePermission(context, "update", "orders"),
    validateRequest({ params: orderIdParams, body: updateCheckoutStatusSchema }),
    asyncHandler(async (req, res) => {
      const order = await context.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "Order" WHERE "id" = ${req.params.id} FOR UPDATE`
        );
        const currentOrder = await tx.order.findUniqueOrThrow({ where: { id: req.params.id } });
        assertMerchantCheckoutTransition(currentOrder.checkoutStatus, req.body.checkoutStatus);
        if (req.body.checkoutStatus === "ABANDONED") {
          const released = await releaseOrderInventoryReservation(tx, req.params.id);
          if (released) {
            return tx.order.findUniqueOrThrow({
              where: { id: req.params.id },
              include: { items: true }
            });
          }
        }

        return tx.order.update({
          where: { id: req.params.id },
          data: { checkoutStatus: req.body.checkoutStatus },
          include: { items: true }
        });
      });

      return sendSuccess(res, { order: adminOrderDto(order) });
    })
  );

  router.patch(
    "/:id/status",
    requirePermission(context, "update", "orders"),
    validateRequest({ params: orderIdParams, body: updateOrderStatusSchema }),
    asyncHandler(async (req, res) => {
      const order = await context.prisma.$transaction(async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "Order" WHERE "id" = ${req.params.id} FOR UPDATE`
        );
        const currentOrder = await tx.order.findUniqueOrThrow({
          where: { id: req.params.id },
          include: { items: true }
        });
        assertMerchantOrderTransition(currentOrder.status, req.body.status);
        const released = req.body.status === "CANCELLED"
          ? await releaseOrderInventoryReservation(tx, req.params.id, {
              orderStatuses: ["PENDING", "CONFIRMED"]
            })
          : false;
        const updatedOrder = released
          ? await tx.order.findUniqueOrThrow({
              where: { id: req.params.id },
              include: { items: true }
            })
          : await tx.order.update({
              where: { id: req.params.id },
              data: { status: req.body.status },
              include: { items: true }
            });

        if (currentOrder.status !== updatedOrder.status) {
          await queueOrderEmail(tx, updatedOrder, {
            eventType: "ORDER_STATUS_CHANGED",
            previousStatus: currentOrder.status
          });
        }

        return updatedOrder;
      });
      await deliverQueuedOrderEmails(context, { orderId: order.id });

      return sendSuccess(res, { order: adminOrderDto(order) });
    })
  );
}
