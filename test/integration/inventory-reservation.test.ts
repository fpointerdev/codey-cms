import assert from "node:assert/strict";
import { after, test } from "node:test";
import { config } from "../../src/config/index.js";
import { prisma } from "../../src/infrastructure/database/prisma.js";
import { logger } from "../../src/infrastructure/logging/logger.js";
import {
  consumeInventoryReservation,
  expireInventoryReservations,
  reconcileReservedInventory,
  releaseInventoryReservation,
  reserveInventoryForOrder
} from "../../src/modules/orders/inventory-reservation.service.js";

const createdProductIds: string[] = [];
const createdOrderIds: string[] = [];

async function createProduct(runId: string, stockQuantity: number) {
  const product = await prisma.product.create({
    data: {
      name: `Reservation product ${runId}`,
      slug: `reservation-product-${runId}`,
      sku: `RES-${runId}`,
      priceCents: 1000,
      currency: "EUR",
      stockQuantity,
      status: "ACTIVE"
    }
  });
  createdProductIds.push(product.id);
  return product;
}

async function createOrder(
  runId: string,
  items: Array<{ productId: string; quantity: number }>
) {
  const order = await prisma.order.create({
    data: {
      orderNumber: `RES-${runId}`,
      customerEmail: `reservation-${runId}@example.com`,
      checkoutStatus: "PAYMENT_PENDING",
      currency: "EUR",
      subtotalCents: items.reduce((total, item) => total + item.quantity * 1000, 0),
      totalCents: items.reduce((total, item) => total + item.quantity * 1000, 0),
      items: {
        create: items.map((item) => ({
          productId: item.productId,
          productName: `Reservation product ${runId}`,
          unitPriceCents: 1000,
          quantity: item.quantity
        }))
      }
    }
  });
  createdOrderIds.push(order.id);
  return order;
}

function runId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const context = { config, prisma, logger };

after(async () => {
  await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.$disconnect();
});

test("two customers reserving the last unit produce one winner", async () => {
  const id = runId();
  const product = await createProduct(id, 1);
  const firstOrder = await createOrder(`${id}-first`, [{ productId: product.id, quantity: 1 }]);
  const secondOrder = await createOrder(`${id}-second`, [{ productId: product.id, quantity: 1 }]);
  const expiresAt = new Date(Date.now() + 60_000);

  const attempts = await Promise.allSettled([
    prisma.$transaction((tx) => reserveInventoryForOrder(tx, firstOrder.id, expiresAt)),
    prisma.$transaction((tx) => reserveInventoryForOrder(tx, secondOrder.id, expiresAt))
  ]);

  assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((result) => result.status === "rejected").length, 1);
  const inventory = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  assert.equal(inventory.stockQuantity, 1);
  assert.equal(inventory.reservedQuantity, 1);
  assert.equal(await prisma.inventoryReservation.count({
    where: { orderId: { in: [firstOrder.id, secondOrder.id] }, status: "ACTIVE" }
  }), 1);
});

test("multi-item reservation is all-or-nothing", async () => {
  const id = runId();
  const available = await createProduct(`${id}-available`, 3);
  const unavailable = await createProduct(`${id}-unavailable`, 0);
  const order = await createOrder(id, [
    { productId: available.id, quantity: 2 },
    { productId: unavailable.id, quantity: 1 }
  ]);

  await assert.rejects(
    prisma.$transaction((tx) => reserveInventoryForOrder(tx, order.id, new Date(Date.now() + 60_000)))
  );

  const products = await prisma.product.findMany({
    where: { id: { in: [available.id, unavailable.id] } },
    orderBy: { id: "asc" }
  });
  assert.ok(products.every((product) => product.reservedQuantity === 0));
  assert.equal(await prisma.inventoryReservation.count({ where: { orderId: order.id } }), 0);
});

test("duplicate lines aggregate and release remains idempotent", async () => {
  const id = runId();
  const product = await createProduct(id, 6);
  const order = await createOrder(id, [
    { productId: product.id, quantity: 2 },
    { productId: product.id, quantity: 3 }
  ]);

  await prisma.$transaction((tx) =>
    reserveInventoryForOrder(tx, order.id, new Date(Date.now() + 60_000))
  );
  const reservation = await prisma.inventoryReservation.findFirstOrThrow({
    where: { orderId: order.id }
  });
  assert.equal(reservation.quantity, 5);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).reservedQuantity, 5);

  const first = await prisma.$transaction((tx) =>
    releaseInventoryReservation(tx, order.id, { reason: "integration_release" })
  );
  const second = await prisma.$transaction((tx) =>
    releaseInventoryReservation(tx, order.id, { reason: "integration_release" })
  );
  assert.equal(first.released, 1);
  assert.equal(second.released, 0);
  const inventory = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  assert.equal(inventory.stockQuantity, 6);
  assert.equal(inventory.reservedQuantity, 0);
});

test("consume and expire race to one valid transition", async () => {
  const id = runId();
  const product = await createProduct(id, 2);
  const order = await createOrder(id, [{ productId: product.id, quantity: 2 }]);
  await prisma.$transaction((tx) =>
    reserveInventoryForOrder(tx, order.id, new Date(Date.now() + 60_000))
  );

  const transitions = await Promise.allSettled([
    prisma.$transaction((tx) => consumeInventoryReservation(tx, order.id)),
    prisma.$transaction((tx) => releaseInventoryReservation(tx, order.id, {
      status: "EXPIRED",
      reason: "reservation_expired"
    }))
  ]);
  assert.equal(transitions.filter((result) => result.status === "fulfilled").length, 2);

  const reservation = await prisma.inventoryReservation.findFirstOrThrow({
    where: { orderId: order.id }
  });
  assert.ok(["CONSUMED", "EXPIRED"].includes(reservation.status));
  const inventory = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  assert.equal(inventory.reservedQuantity, 0);
  assert.equal(inventory.stockQuantity, reservation.status === "CONSUMED" ? 0 : 2);
});

test("product metadata can cap purchase quantity", async () => {
  const id = runId();
  const product = await createProduct(id, 10);
  await prisma.product.update({
    where: { id: product.id },
    data: { metadata: { maxPurchaseQuantity: 2 } }
  });
  const order = await createOrder(id, [{ productId: product.id, quantity: 3 }]);

  await assert.rejects(
    prisma.$transaction((tx) =>
      reserveInventoryForOrder(tx, order.id, new Date(Date.now() + 60_000))
    ),
    (error: unknown) => Boolean(
      error && typeof error === "object" && "code" in error &&
      error.code === "product_purchase_limit_exceeded"
    )
  );
  assert.equal(
    (await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).reservedQuantity,
    0
  );
});

test("two cleanup workers expire an active reservation once", async () => {
  const id = runId();
  const product = await createProduct(id, 2);
  const order = await createOrder(id, [{ productId: product.id, quantity: 1 }]);
  await prisma.$transaction((tx) =>
    reserveInventoryForOrder(tx, order.id, new Date(Date.now() - 1_000))
  );

  const results = await Promise.all([
    expireInventoryReservations(context),
    expireInventoryReservations(context)
  ]);
  assert.equal(results.reduce((total, count) => total + count, 0), 1);
  const reservation = await prisma.inventoryReservation.findFirstOrThrow({
    where: { orderId: order.id }
  });
  assert.equal(reservation.status, "EXPIRED");
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).reservedQuantity, 0);
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).checkoutStatus, "ABANDONED");
});

test("a failed cleanup transaction remains retryable", async () => {
  const id = runId();
  const product = await createProduct(id, 1);
  const order = await createOrder(id, [{ productId: product.id, quantity: 1 }]);
  await prisma.$transaction((tx) =>
    reserveInventoryForOrder(tx, order.id, new Date(Date.now() - 1_000))
  );
  await prisma.product.update({
    where: { id: product.id },
    data: { reservedQuantity: 0 }
  });

  await assert.rejects(expireInventoryReservations(context));
  assert.equal(
    (await prisma.inventoryReservation.findFirstOrThrow({ where: { orderId: order.id } })).status,
    "ACTIVE"
  );

  await prisma.product.update({
    where: { id: product.id },
    data: { reservedQuantity: 1 }
  });
  assert.equal(await expireInventoryReservations(context), 1);
});

test("reconciliation detects and repairs reserved inventory drift", async () => {
  const id = runId();
  const product = await createProduct(id, 10);
  await prisma.product.update({
    where: { id: product.id },
    data: { reservedQuantity: 4 }
  });

  const dryRun = await reconcileReservedInventory(context);
  assert.equal(dryRun.mode, "dry-run");
  assert.ok(dryRun.mismatches.some((mismatch) =>
    mismatch.kind === "product" && mismatch.id === product.id && mismatch.expectedReservedQuantity === 0
  ));
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).reservedQuantity, 4);

  const repaired = await reconcileReservedInventory(context, { repair: true });
  assert.equal(repaired.mode, "repair");
  assert.ok(repaired.repaired >= 1);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).reservedQuantity, 0);
  assert.ok(await prisma.auditLog.findFirst({
    where: { action: "inventory.reconcile.repair", subjectId: product.id }
  }));
});
