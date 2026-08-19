import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { AppError } from "../../core/errors/app-error.js";
import type { ModuleContext } from "../../core/types/module.js";
import { releaseOrderInventoryReservation } from "./checkout.service.js";
import { deliverQueuedOrderEmails, orderAccountUrl, queueOrderEmail } from "./order-email.service.js";
import { orderLookupTokenMatches } from "./order-lookup.js";

export const buyerSessionCookieName = "codey_buyer_session";

const buyerSessionLifetimeMs = 90 * 24 * 60 * 60 * 1_000;
const maximumOpenCasesPerOrder = 5;

type BuyerRequest = {
  cookies?: Record<string, string | undefined>;
};

type BuyerResponse = {
  cookie: (name: string, value: string, options: Record<string, unknown>) => unknown;
};

type BuyerClearResponse = {
  clearCookie: (name: string, options: Record<string, unknown>) => unknown;
};
type ShopTransaction = Prisma.TransactionClient;

const buyerOrderInclude = {
  items: true,
  tracking: true,
  supportCases: {
    orderBy: { createdAt: "desc" as const },
    take: 20
  }
} as const;

type BuyerOrder = Prisma.OrderGetPayload<{ include: typeof buyerOrderInclude }>;

function hashBuyerSessionToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function cookieOptions(context: ModuleContext) {
  return {
    httpOnly: true,
    secure: context.config.isProduction,
    sameSite: "lax" as const,
    path: "/"
  };
}

function buyerToken(req: BuyerRequest) {
  const token = req.cookies?.[buyerSessionCookieName];
  return typeof token === "string" && /^[A-Za-z0-9_-]{40,100}$/.test(token) ? token : null;
}

function safeTrackingUrl(value: string | null | undefined) {
  if (!value) return null;

  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function buyerSupportCaseDto(supportCase: BuyerOrder["supportCases"][number]) {
  return {
    type: supportCase.type,
    status: supportCase.status,
    subject: supportCase.subject,
    message: supportCase.message,
    merchantResponse: supportCase.merchantResponse,
    resolvedAt: supportCase.resolvedAt,
    createdAt: supportCase.createdAt,
    updatedAt: supportCase.updatedAt
  };
}

export function buyerOrderDto(order: BuyerOrder) {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    checkoutStatus: order.checkoutStatus,
    currency: order.currency,
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    shippingCents: order.shippingCents,
    taxCents: order.taxCents,
    totalCents: order.totalCents,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    items: order.items.map((item) => ({
      productName: item.productName,
      variantName: item.variantName,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents
    })),
    tracking: order.tracking
      ? {
          status: order.tracking.status,
          carrier: order.tracking.carrier,
          trackingNumber: order.tracking.trackingNumber,
          trackingUrl: safeTrackingUrl(order.tracking.trackingUrl),
          estimatedDeliveryAt: order.tracking.estimatedDeliveryAt,
          shippedAt: order.tracking.shippedAt,
          deliveredAt: order.tracking.deliveredAt,
          note: order.tracking.note,
          updatedAt: order.tracking.updatedAt
        }
      : null,
    supportCases: order.supportCases.map(buyerSupportCaseDto)
  };
}

async function activeBuyerSession(context: ModuleContext, req: BuyerRequest) {
  const token = buyerToken(req);
  if (!token) return null;

  return context.prisma.buyerSession.findFirst({
    where: {
      tokenHash: hashBuyerSessionToken(token),
      expiresAt: { gt: new Date() }
    }
  });
}

async function ensureBuyerSession(
  context: ModuleContext,
  req: BuyerRequest,
  res: BuyerResponse
) {
  const existingToken = buyerToken(req);
  const existing = existingToken ? await activeBuyerSession(context, req) : null;
  if (existing && existingToken) {
    const refreshed = await context.prisma.buyerSession.updateMany({
      where: { id: existing.id },
      data: { lastSeenAt: new Date() }
    });
    if (refreshed.count === 1) {
      res.cookie(buyerSessionCookieName, existingToken, {
        ...cookieOptions(context),
        maxAge: Math.max(1_000, existing.expiresAt.getTime() - Date.now())
      });
      return existing;
    }
  }

  const token = randomBytes(32).toString("base64url");
  const session = await context.prisma.buyerSession.create({
    data: {
      tokenHash: hashBuyerSessionToken(token),
      expiresAt: new Date(Date.now() + buyerSessionLifetimeMs)
    }
  });
  res.cookie(buyerSessionCookieName, token, {
    ...cookieOptions(context),
    maxAge: buyerSessionLifetimeMs
  });

  return session;
}

export async function attachOrderToBuyerSession(
  context: ModuleContext,
  req: BuyerRequest,
  res: BuyerResponse,
  orderId: string
) {
  const session = await ensureBuyerSession(context, req, res);
  await context.prisma.buyerSessionOrder.upsert({
    where: {
      sessionId_orderId: {
        sessionId: session.id,
        orderId
      }
    },
    update: {},
    create: {
      sessionId: session.id,
      orderId
    }
  });

  return session;
}

export async function deleteExpiredBuyerSessions(context: ModuleContext) {
  const result = await context.prisma.buyerSession.deleteMany({
    where: { expiresAt: { lte: new Date() } }
  });
  return result.count;
}

export async function forgetBuyerSession(
  context: ModuleContext,
  req: BuyerRequest,
  res: BuyerClearResponse
) {
  const token = buyerToken(req);
  if (token) {
    await context.prisma.buyerSession.deleteMany({
      where: { tokenHash: hashBuyerSessionToken(token) }
    });
  }
  res.clearCookie(buyerSessionCookieName, cookieOptions(context));

  return { forgotten: true };
}

async function listBuyerOrdersForSession(context: ModuleContext, sessionId: string) {
  const memberships = await context.prisma.buyerSessionOrder.findMany({
    where: { sessionId },
    orderBy: { claimedAt: "desc" },
    include: { order: { include: buyerOrderInclude } },
    take: 100
  });
  await context.prisma.buyerSession.updateMany({
    where: { id: sessionId },
    data: { lastSeenAt: new Date() }
  });

  return memberships.map(({ order }) => buyerOrderDto(order));
}

export async function listBuyerOrders(context: ModuleContext, req: BuyerRequest) {
  const session = await activeBuyerSession(context, req);
  return session ? listBuyerOrdersForSession(context, session.id) : [];
}

export async function claimBuyerOrder(
  context: ModuleContext,
  req: BuyerRequest,
  res: BuyerResponse,
  input: { orderNumber: string; lookupToken: string }
) {
  const order = await context.prisma.order.findUnique({
    where: { orderNumber: input.orderNumber },
    select: { id: true, lookupTokenHash: true }
  });
  if (!orderLookupTokenMatches(order?.lookupTokenHash, input.lookupToken) || !order) {
    throw new AppError(404, "order_not_found", "Order not found.");
  }

  const session = await attachOrderToBuyerSession(context, req, res, order.id);
  return listBuyerOrdersForSession(context, session.id);
}

async function ownedOrder(
  tx: ShopTransaction,
  sessionId: string,
  orderNumber: string
) {
  const membership = await tx.buyerSessionOrder.findFirst({
    where: {
      sessionId,
      order: { orderNumber }
    },
    include: { order: { include: buyerOrderInclude } }
  });
  if (!membership) throw new AppError(404, "order_not_found", "Order not found.");

  return membership.order;
}

async function requiredBuyerSession(context: ModuleContext, req: BuyerRequest) {
  const session = await activeBuyerSession(context, req);
  if (!session) throw new AppError(404, "order_not_found", "Order not found.");

  return session;
}

export async function createBuyerSupportCase(
  context: ModuleContext,
  req: BuyerRequest,
  orderNumber: string,
  input: { type: "COMPLAINT" | "RETURN" | "OTHER"; subject: string; message: string }
) {
  const session = await requiredBuyerSession(context, req);
  return context.prisma.$transaction(async (tx) => {
    const order = await ownedOrder(tx, session.id, orderNumber);
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`
    );
    if (locked.length !== 1) {
      throw new AppError(404, "order_not_found", "Order not found.");
    }
    const openCases = await tx.orderSupportCase.count({
      where: {
        orderId: order.id,
        status: { in: ["OPEN", "IN_REVIEW"] }
      }
    });
    if (openCases >= maximumOpenCasesPerOrder) {
      throw new AppError(
        409,
        "support_case_limit_reached",
        "Resolve an existing request before opening another one."
      );
    }

    const supportCase = await tx.orderSupportCase.create({
      data: {
        orderId: order.id,
        type: input.type,
        subject: input.subject,
        message: input.message
      }
    });
    return buyerSupportCaseDto(supportCase);
  });
}

export async function cancelBuyerOrder(
  context: ModuleContext,
  req: BuyerRequest,
  orderNumber: string,
  reason: string
) {
  const session = await requiredBuyerSession(context, req);
  const result = await context.prisma.$transaction(async (tx) => {
    const order = await ownedOrder(tx, session.id, orderNumber);
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`
    );
    if (locked.length !== 1) {
      throw new AppError(404, "order_not_found", "Order not found.");
    }
    const current = await tx.order.findUniqueOrThrow({
      where: { id: order.id },
      include: buyerOrderInclude
    });
    if (["CANCELLED", "REFUNDED"].includes(current.status)) {
      return { action: "unchanged" as const, order: current };
    }

    const paymentCount = await tx.payment.count({ where: { orderId: current.id } });
    if (
      current.status === "PENDING"
      && current.checkoutStatus === "PAYMENT_PENDING"
      && paymentCount === 0
    ) {
      const released = await releaseOrderInventoryReservation(tx, current.id);
      const cancelled = released
        ? await tx.order.findUniqueOrThrow({ where: { id: current.id }, include: buyerOrderInclude })
        : await tx.order.update({
            where: { id: current.id },
            data: { status: "CANCELLED", checkoutStatus: "ABANDONED" },
            include: buyerOrderInclude
          });
      await queueOrderEmail(tx, cancelled, {
        eventType: "ORDER_STATUS_CHANGED",
        previousStatus: current.status,
        accountUrl: orderAccountUrl(context)
      });
      return { action: "cancelled" as const, order: cancelled };
    }

    const existingRequest = await tx.orderSupportCase.findFirst({
      where: {
        orderId: current.id,
        type: "CANCELLATION",
        status: { in: ["OPEN", "IN_REVIEW"] }
      },
      orderBy: { createdAt: "desc" }
    });
    const supportCase = existingRequest ?? await tx.orderSupportCase.create({
      data: {
        orderId: current.id,
        type: "CANCELLATION",
        subject: "Cancellation request",
        message: reason
      }
    });

    return { action: "requested" as const, order: current, supportCase };
  });

  if (result.action === "cancelled") {
    await deliverQueuedOrderEmails(context, { orderId: result.order.id });
  }

  const response = {
    action: result.action,
    order: buyerOrderDto(result.order)
  };
  return "supportCase" in result && result.supportCase
    ? { ...response, supportCase: buyerSupportCaseDto(result.supportCase) }
    : response;
}
