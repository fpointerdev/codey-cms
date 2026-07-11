import type { Router } from "express";
import rateLimit from "express-rate-limit";
import type { ModuleContext } from "../../core/types/module.js";
import { asyncHandler } from "../../core/http/async-handler.js";
import { sendCreated, sendSuccess } from "../../core/http/response.js";
import { validateRequest } from "../../core/http/validation.middleware.js";
import { requirePermission } from "../auth/auth.middleware.js";
import {
  addCartItemSchema,
  cartTokenParams,
  checkoutCartSchema,
  createCartSchema,
  createCouponSchema,
  createOrderSchema,
  createShippingRateSchema,
  createShippingZoneSchema,
  createTaxRuleSchema,
  lookupOrderSchema,
  orderIdParams,
  shippingZoneIdParams,
  updateCheckoutStatusSchema,
  updateOrderStatusSchema
} from "./orders.schemas.js";
import {
  addCartItem,
  checkoutCart,
  createCart,
  createOrder,
  getCart,
  lookupOrder,
  releaseExpiredOrderReservations,
  releaseOrderInventoryReservation
} from "./checkout.service.js";
import { deliverQueuedOrderEmails, queueOrderEmail } from "./order-email.service.js";

function createCheckoutLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
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
  const checkoutLimiter = createCheckoutLimiter();
  const cleanupTimer = setInterval(() => {
    void releaseExpiredOrderReservations(context).catch((error) => {
      context.logger.error({ err: error }, "Unable to release expired order reservations");
    });
  }, 60_000);
  cleanupTimer.unref();

  router.get(
    "/",
    requirePermission(context, "read", "orders"),
    asyncHandler(async (_req, res) => {
      await releaseExpiredOrderReservations(context);
      const orders = await context.prisma.order.findMany({
        orderBy: { createdAt: "desc" },
        include: { items: true, notifications: true },
        take: 100
      });

      return sendSuccess(res, { orders });
    })
  );

  router.post(
    "/",
    requirePermission(context, "update", "orders"),
    validateRequest({ body: createOrderSchema }),
    asyncHandler(async (req, res) => {
      const order = await createOrder(context, req.body);
      await deliverQueuedOrderEmails(context, { orderId: order.id });

      return sendCreated(res, { order });
    })
  );

  router.post(
    "/lookup",
    validateRequest({ body: lookupOrderSchema }),
    asyncHandler(async (req, res) => {
      const order = await lookupOrder(context, req.body);

      return sendSuccess(res, { order });
    })
  );

  router.post(
    "/carts",
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
    validateRequest({ params: cartTokenParams, body: addCartItemSchema }),
    asyncHandler(async (req, res) => {
      const cart = await addCartItem(context, req.params.token, req.body);

      return sendSuccess(res, { cart });
    })
  );

  router.post(
    "/carts/:token/checkout",
    checkoutLimiter,
    validateRequest({ params: cartTokenParams, body: checkoutCartSchema }),
    asyncHandler(async (req, res) => {
      const order = await checkoutCart(context, req.params.token, req.body);
      await deliverQueuedOrderEmails(context, { orderId: order.id });

      return sendCreated(res, { order });
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
          country: req.body.country?.toUpperCase()
        }
      });

      return sendCreated(res, { taxRule });
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

  router.patch(
    "/:id/checkout-status",
    requirePermission(context, "update", "orders"),
    validateRequest({ params: orderIdParams, body: updateCheckoutStatusSchema }),
    asyncHandler(async (req, res) => {
      const order = await context.prisma.$transaction(async (tx) => {
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

      return sendSuccess(res, { order });
    })
  );

  router.patch(
    "/:id/status",
    requirePermission(context, "update", "orders"),
    validateRequest({ params: orderIdParams, body: updateOrderStatusSchema }),
    asyncHandler(async (req, res) => {
      const order = await context.prisma.$transaction(async (tx) => {
        const currentOrder = await tx.order.findUniqueOrThrow({
          where: { id: req.params.id },
          include: { items: true }
        });
        const released = req.body.status === "CANCELLED"
          ? await releaseOrderInventoryReservation(tx, req.params.id)
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

      return sendSuccess(res, { order });
    })
  );
}
