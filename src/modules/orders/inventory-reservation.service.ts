import { Prisma, type InventoryReservationStatus } from "@prisma/client";
import { writeAuditLog } from "../../core/audit/audit-log.js";
import { AppError } from "../../core/errors/app-error.js";
import type { ModuleContext } from "../../core/types/module.js";
import { effectivePurchaseLimit } from "../products/product-inventory.js";
export { availableStock, withAvailableInventory } from "../products/product-inventory.js";

type InventoryTransaction = Prisma.TransactionClient;

type InventorySelection = {
  selectionKey: string;
  productId: string;
  variantId: string | null;
  quantity: number;
};

type LockedReservation = {
  id: string;
};

function selectionKey(productId: string, variantId: string | null) {
  return `${productId}:${variantId ?? ""}`;
}

function aggregateOrderItems(items: Array<{
  productId: string | null;
  variantId: string | null;
  quantity: number;
}>) {
  const selections = new Map<string, InventorySelection>();

  for (const item of items) {
    if (!item.productId) {
      throw new AppError(409, "inventory_item_untracked", "An order item is no longer linked to inventory.");
    }

    const key = selectionKey(item.productId, item.variantId);
    const current = selections.get(key);
    if (current) {
      current.quantity += item.quantity;
    } else {
      selections.set(key, {
        selectionKey: key,
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity
      });
    }
  }

  return [...selections.values()].sort((left, right) =>
    left.selectionKey.localeCompare(right.selectionKey)
  );
}

async function assertPurchaseLimits(
  tx: InventoryTransaction,
  selections: InventorySelection[]
) {
  const productIds = [...new Set(selections.map((item) => item.productId))];
  const products = await tx.product.findMany({
    where: { id: { in: productIds }, status: "ACTIVE" },
    select: {
      id: true,
      metadata: true,
      variants: {
        select: { id: true, active: true, metadata: true }
      }
    }
  });
  const productsById = new Map(products.map((product) => [product.id, product]));

  for (const selection of selections) {
    const product = productsById.get(selection.productId);
    const variant = selection.variantId
      ? product?.variants.find((item) => item.id === selection.variantId && item.active)
      : undefined;
    if (!product || (selection.variantId && !variant)) {
      throw new AppError(422, "inventory_item_unavailable", "One or more products are unavailable.");
    }

    const limit = effectivePurchaseLimit(product.metadata, variant?.metadata);
    if (limit !== undefined && selection.quantity > limit) {
      throw new AppError(
        422,
        "product_purchase_limit_exceeded",
        `This item is limited to ${limit} per order.`,
        { limit }
      );
    }
  }
}

async function incrementReservedInventory(
  tx: InventoryTransaction,
  selection: InventorySelection
) {
  const rows = selection.variantId
    ? await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        UPDATE "ProductVariant"
        SET "reservedQuantity" = "reservedQuantity" + ${selection.quantity},
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${selection.variantId}
          AND "productId" = ${selection.productId}
          AND "active" = true
          AND "stockQuantity" - "reservedQuantity" >= ${selection.quantity}
        RETURNING "id"
      `)
    : await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        UPDATE "Product"
        SET "reservedQuantity" = "reservedQuantity" + ${selection.quantity},
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${selection.productId}
          AND "status" = 'ACTIVE'::"ProductStatus"
          AND "stockQuantity" - "reservedQuantity" >= ${selection.quantity}
        RETURNING "id"
      `);

  if (rows.length !== 1) {
    throw new AppError(409, "insufficient_stock", "One or more products are out of stock.");
  }
}

async function decrementReservedInventory(
  tx: InventoryTransaction,
  reservation: InventorySelection,
  consumePhysicalStock: boolean
) {
  const stockChange = consumePhysicalStock
    ? Prisma.sql`, "stockQuantity" = "stockQuantity" - ${reservation.quantity}`
    : Prisma.empty;
  const rows = reservation.variantId
    ? await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        UPDATE "ProductVariant"
        SET "reservedQuantity" = "reservedQuantity" - ${reservation.quantity}
            ${stockChange},
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${reservation.variantId}
          AND "productId" = ${reservation.productId}
          AND "reservedQuantity" >= ${reservation.quantity}
          ${consumePhysicalStock
            ? Prisma.sql`AND "stockQuantity" >= ${reservation.quantity}`
            : Prisma.empty}
        RETURNING "id"
      `)
    : await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        UPDATE "Product"
        SET "reservedQuantity" = "reservedQuantity" - ${reservation.quantity}
            ${stockChange},
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${reservation.productId}
          AND "reservedQuantity" >= ${reservation.quantity}
          ${consumePhysicalStock
            ? Prisma.sql`AND "stockQuantity" >= ${reservation.quantity}`
            : Prisma.empty}
        RETURNING "id"
      `);

  if (rows.length !== 1) {
    throw new AppError(409, "inventory_inconsistent", "Reserved inventory is inconsistent and requires reconciliation.");
  }
}

async function lockOrder(tx: InventoryTransaction, orderId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`
  );
  if (rows.length !== 1) {
    throw new AppError(404, "order_not_found", "Order not found.");
  }
}

async function lockedActiveReservations(tx: InventoryTransaction, orderId: string) {
  const locked = await tx.$queryRaw<LockedReservation[]>(Prisma.sql`
    SELECT "id"
    FROM "InventoryReservation"
    WHERE "orderId" = ${orderId}
      AND "status" = 'ACTIVE'::"InventoryReservationStatus"
    ORDER BY "selectionKey" ASC
    FOR UPDATE
  `);
  if (!locked.length) return [];

  return tx.inventoryReservation.findMany({
    where: { id: { in: locked.map((reservation) => reservation.id) }, status: "ACTIVE" },
    orderBy: { selectionKey: "asc" }
  });
}

export async function reserveInventoryForOrder(
  tx: InventoryTransaction,
  orderId: string,
  expiresAt: Date
) {
  await lockOrder(tx, orderId);
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { items: true, inventoryReservations: true }
  });
  if (!order || order.status !== "PENDING" || order.checkoutStatus !== "PAYMENT_PENDING") {
    throw new AppError(409, "order_not_payable", "This order cannot reserve inventory.");
  }

  const selections = aggregateOrderItems(order.items);
  if (!selections.length) {
    throw new AppError(422, "empty_order", "An order must contain at least one inventory item.");
  }
  await assertPurchaseLimits(tx, selections);

  const existingByKey = new Map(
    order.inventoryReservations.map((reservation) => [reservation.selectionKey, reservation])
  );
  const active = order.inventoryReservations.filter((reservation) => reservation.status === "ACTIVE");
  if (active.length) {
    const activeByKey = new Map(active.map((reservation) => [reservation.selectionKey, reservation]));
    const complete = selections.every((selection) => {
      const reservation = activeByKey.get(selection.selectionKey);
      return reservation?.quantity === selection.quantity && reservation.expiresAt > new Date();
    });
    if (complete && active.length === selections.length) return active;
    throw new AppError(409, "inventory_reservation_conflict", "This order has an invalid inventory reservation.");
  }

  for (const selection of selections) {
    const existing = existingByKey.get(selection.selectionKey);
    if (existing?.status === "CONSUMED") {
      throw new AppError(409, "inventory_already_consumed", "This order inventory has already been consumed.");
    }
    if (existing && existing.quantity !== selection.quantity) {
      throw new AppError(409, "inventory_reservation_conflict", "The order changed after inventory was reserved.");
    }

    await incrementReservedInventory(tx, selection);
    if (existing) {
      await tx.inventoryReservation.update({
        where: { id: existing.id },
        data: {
          status: "ACTIVE",
          expiresAt,
          consumedAt: null,
          releasedAt: null,
          releaseReason: null
        }
      });
    } else {
      await tx.inventoryReservation.create({
        data: {
          orderId,
          ...selection,
          expiresAt
        }
      });
    }
  }

  return tx.inventoryReservation.findMany({
    where: { orderId, status: "ACTIVE" },
    orderBy: { selectionKey: "asc" }
  });
}

export async function consumeInventoryReservation(
  tx: InventoryTransaction,
  orderId: string,
  now = new Date()
) {
  await lockOrder(tx, orderId);
  const reservations = await lockedActiveReservations(tx, orderId);
  if (!reservations.length) {
    const consumed = await tx.inventoryReservation.count({
      where: { orderId, status: "CONSUMED" }
    });
    if (consumed > 0) return { consumed: false, duplicate: true, count: 0 };
    throw new AppError(409, "inventory_reservation_missing", "This order has no active inventory reservation.");
  }
  if (reservations.some((reservation) => reservation.expiresAt <= now)) {
    throw new AppError(409, "order_reservation_expired", "The inventory reservation has expired.");
  }

  for (const reservation of reservations) {
    const claimed = await tx.inventoryReservation.updateMany({
      where: { id: reservation.id, status: "ACTIVE", expiresAt: { gt: now } },
      data: { status: "CONSUMED", consumedAt: now }
    });
    if (claimed.count !== 1) {
      throw new AppError(409, "inventory_reservation_conflict", "The inventory reservation changed before payment completed.");
    }
    await decrementReservedInventory(tx, reservation, true);
  }

  return { consumed: true, duplicate: false, count: reservations.length };
}

export async function releaseInventoryReservation(
  tx: InventoryTransaction,
  orderId: string,
  options: {
    status?: Extract<InventoryReservationStatus, "RELEASED" | "EXPIRED">;
    reason: string;
    now?: Date;
  }
) {
  await lockOrder(tx, orderId);
  const reservations = await lockedActiveReservations(tx, orderId);
  const now = options.now ?? new Date();
  const status = options.status ?? "RELEASED";

  for (const reservation of reservations) {
    const claimed = await tx.inventoryReservation.updateMany({
      where: { id: reservation.id, status: "ACTIVE" },
      data: {
        status,
        releasedAt: now,
        releaseReason: options.reason
      }
    });
    if (claimed.count !== 1) continue;
    await decrementReservedInventory(tx, reservation, false);
  }

  return { released: reservations.length, status };
}

export async function assertActiveInventoryReservation(
  tx: InventoryTransaction,
  orderId: string,
  now = new Date()
) {
  await lockOrder(tx, orderId);
  const reservations = await lockedActiveReservations(tx, orderId);
  if (!reservations.length || reservations.some((reservation) => reservation.expiresAt <= now)) {
    throw new AppError(409, "order_reservation_expired", "The inventory reservation has expired.");
  }
  return reservations;
}

export function reservationExpiry(context: ModuleContext, now = new Date()) {
  return new Date(now.getTime() + context.config.commerce.checkout.reservationTtlMinutes * 60_000);
}

export async function expireInventoryReservations(
  context: ModuleContext,
  now = new Date(),
  batchSize = 100
) {
  const candidates = await context.prisma.inventoryReservation.findMany({
    where: { status: "ACTIVE", expiresAt: { lte: now } },
    select: { orderId: true },
    distinct: ["orderId"],
    orderBy: { expiresAt: "asc" },
    take: batchSize
  });
  let expired = 0;

  for (const candidate of candidates) {
    const didExpire = await context.prisma.$transaction(async (tx) => {
      const result = await releaseInventoryReservation(tx, candidate.orderId, {
        status: "EXPIRED",
        reason: "reservation_expired",
        now
      });
      if (!result.released) return false;

      const order = await tx.order.findUnique({
        where: { id: candidate.orderId },
        select: { couponCode: true }
      });
      const abandoned = await tx.order.updateMany({
        where: {
          id: candidate.orderId,
          status: { in: ["PENDING", "CONFIRMED"] },
          checkoutStatus: { in: ["PAYMENT_PENDING", "PAYMENT_AUTHORIZED"] }
        },
        data: { status: "CANCELLED", checkoutStatus: "ABANDONED" }
      });
      if (abandoned.count === 1 && order?.couponCode) {
        await tx.coupon.updateMany({
          where: { code: order.couponCode, usageCount: { gt: 0 } },
          data: { usageCount: { decrement: 1 } }
        });
      }
      return abandoned.count === 1;
    });
    if (didExpire) expired += 1;
  }

  return expired;
}

type InventoryMismatch = {
  kind: "product" | "variant" | "orphan";
  id: string;
  storedReservedQuantity: number | null;
  expectedReservedQuantity: number;
};

async function inventoryMismatches(context: ModuleContext) {
  const [groups, products, variants] = await Promise.all([
    context.prisma.inventoryReservation.groupBy({
      by: ["productId", "variantId"],
      where: { status: "ACTIVE" },
      _sum: { quantity: true }
    }),
    context.prisma.product.findMany({
      select: { id: true, reservedQuantity: true }
    }),
    context.prisma.productVariant.findMany({
      select: { id: true, reservedQuantity: true }
    })
  ]);
  const expectedProducts = new Map<string, number>();
  const expectedVariants = new Map<string, number>();
  for (const group of groups) {
    const quantity = group._sum.quantity ?? 0;
    if (group.variantId) expectedVariants.set(group.variantId, quantity);
    else expectedProducts.set(group.productId, quantity);
  }

  const mismatches: InventoryMismatch[] = [];
  const productIds = new Set(products.map((product) => product.id));
  const variantIds = new Set(variants.map((variant) => variant.id));
  for (const product of products) {
    const expected = expectedProducts.get(product.id) ?? 0;
    if (product.reservedQuantity !== expected) {
      mismatches.push({
        kind: "product",
        id: product.id,
        storedReservedQuantity: product.reservedQuantity,
        expectedReservedQuantity: expected
      });
    }
  }
  for (const variant of variants) {
    const expected = expectedVariants.get(variant.id) ?? 0;
    if (variant.reservedQuantity !== expected) {
      mismatches.push({
        kind: "variant",
        id: variant.id,
        storedReservedQuantity: variant.reservedQuantity,
        expectedReservedQuantity: expected
      });
    }
  }
  for (const [productId, quantity] of expectedProducts) {
    if (!productIds.has(productId)) {
      mismatches.push({
        kind: "orphan",
        id: productId,
        storedReservedQuantity: null,
        expectedReservedQuantity: quantity
      });
    }
  }
  for (const [variantId, quantity] of expectedVariants) {
    if (!variantIds.has(variantId)) {
      mismatches.push({
        kind: "orphan",
        id: variantId,
        storedReservedQuantity: null,
        expectedReservedQuantity: quantity
      });
    }
  }

  return {
    checked: { products: products.length, variants: variants.length },
    mismatches: mismatches.sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`))
  };
}

async function repairMismatch(context: ModuleContext, mismatch: InventoryMismatch) {
  if (mismatch.kind === "orphan") return false;

  return context.prisma.$transaction(async (tx) => {
    const table = mismatch.kind === "product" ? "Product" : "ProductVariant";
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM ${Prisma.raw(`"${table}"`)} WHERE "id" = ${mismatch.id} FOR UPDATE`
    );
    if (!locked.length) return false;

    const aggregate = await tx.inventoryReservation.aggregate({
      where: {
        status: "ACTIVE",
        ...(mismatch.kind === "product"
          ? { productId: mismatch.id, variantId: null }
          : { variantId: mismatch.id })
      },
      _sum: { quantity: true }
    });
    const expectedReservedQuantity = aggregate._sum.quantity ?? 0;
    const current = mismatch.kind === "product"
      ? await tx.product.findUniqueOrThrow({
          where: { id: mismatch.id },
          select: { reservedQuantity: true }
        })
      : await tx.productVariant.findUniqueOrThrow({
          where: { id: mismatch.id },
          select: { reservedQuantity: true }
        });
    if (current.reservedQuantity === expectedReservedQuantity) return false;

    if (mismatch.kind === "product") {
      await tx.product.update({
        where: { id: mismatch.id },
        data: { reservedQuantity: expectedReservedQuantity }
      });
    } else {
      await tx.productVariant.update({
        where: { id: mismatch.id },
        data: { reservedQuantity: expectedReservedQuantity }
      });
    }
    await writeAuditLog(tx, {
      action: "inventory.reconcile.repair",
      subject: mismatch.kind,
      subjectId: mismatch.id,
      severity: "HIGH",
      metadata: {
        previousReservedQuantity: current.reservedQuantity,
        expectedReservedQuantity
      }
    });
    return true;
  });
}

export async function reconcileReservedInventory(
  context: ModuleContext,
  options: { repair?: boolean } = {}
) {
  const before = await inventoryMismatches(context);
  let repaired = 0;
  if (options.repair) {
    for (const mismatch of before.mismatches) {
      if (await repairMismatch(context, mismatch)) repaired += 1;
    }
  }
  const after = options.repair ? await inventoryMismatches(context) : before;

  return {
    mode: options.repair ? "repair" : "dry-run",
    healthy: after.mismatches.length === 0,
    checked: after.checked,
    detected: before.mismatches.length,
    repaired,
    mismatches: after.mismatches
  };
}

export async function inventoryReservationDiagnostics(context: ModuleContext, now = new Date()) {
  const [count, oldest] = await Promise.all([
    context.prisma.inventoryReservation.count({
      where: { status: "ACTIVE", expiresAt: { lte: now } }
    }),
    context.prisma.inventoryReservation.findFirst({
      where: { status: "ACTIVE", expiresAt: { lte: now } },
      select: { expiresAt: true },
      orderBy: { expiresAt: "asc" }
    })
  ]);

  return {
    status: count ? "attention" : "pass",
    blocking: false,
    expiredActiveReservations: count,
    oldestExpiredAt: oldest?.expiresAt ?? null,
    oldestExpiredAgeSeconds: oldest
      ? Math.max(0, Math.floor((now.getTime() - oldest.expiresAt.getTime()) / 1000))
      : 0
  };
}
