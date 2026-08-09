import { Prisma, type InventoryReservationStatus } from "@prisma/client";
import { AppError } from "../../core/errors/app-error.js";
import type { ModuleContext } from "../../core/types/module.js";

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

function configuredPurchaseLimit(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const limit = value.maxPurchaseQuantity;
  return typeof limit === "number" && Number.isSafeInteger(limit) && limit > 0
    ? limit
    : undefined;
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

    const limits = [configuredPurchaseLimit(product.metadata), configuredPurchaseLimit(variant?.metadata ?? null)]
      .filter((limit): limit is number => limit !== undefined);
    const limit = limits.length ? Math.min(...limits) : undefined;
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

export function availableStock(stockQuantity: number, reservedQuantity: number) {
  return Math.max(stockQuantity - reservedQuantity, 0);
}

export function withAvailableInventory<T extends {
  stockQuantity: number;
  reservedQuantity: number;
  variants?: Array<{ stockQuantity: number; reservedQuantity: number }>;
}>(product: T) {
  return {
    ...product,
    availableStock: availableStock(product.stockQuantity, product.reservedQuantity),
    ...(product.variants
      ? {
          variants: product.variants.map((variant) => ({
            ...variant,
            availableStock: availableStock(variant.stockQuantity, variant.reservedQuantity)
          }))
        }
      : {})
  };
}

export function reservationExpiry(context: ModuleContext, now = new Date()) {
  return new Date(now.getTime() + context.config.commerce.checkout.reservationTtlMinutes * 60_000);
}
