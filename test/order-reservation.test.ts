import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { AppError } from "../src/core/errors/app-error.js";
import {
  assertMerchantCheckoutTransition,
  assertMerchantOrderTransition,
  releaseOrderInventoryReservation
} from "../src/modules/orders/checkout.service.js";

test("cancelling an order releases its ledger and coupon without restoring physical stock", async () => {
  const couponUpdates: unknown[] = [];
  let queryCount = 0;
  const tx = {
    $queryRaw: async () => {
      queryCount += 1;
      return queryCount === 1 ? [{ id: "order-1" }] : [];
    },
    order: {
      findUnique: async () => ({
        id: "order-1",
        status: "PENDING",
        checkoutStatus: "PAYMENT_PENDING",
        couponCode: "SAVE10",
        items: [
          { productId: "product-1", variantId: "variant-1", quantity: 2 },
          { productId: "product-1", variantId: "variant-1", quantity: 1 },
          { productId: "product-2", variantId: null, quantity: 4 }
        ]
      }),
      updateMany: async () => ({ count: 1 })
    },
    inventoryReservation: { findMany: async () => [] },
    coupon: {
      updateMany: async (args: unknown) => {
        couponUpdates.push(args);
        return { count: 1 };
      }
    }
  } as unknown as Prisma.TransactionClient;

  assert.equal(await releaseOrderInventoryReservation(tx, "order-1"), true);
  assert.equal(couponUpdates.length, 1);
});

test("completed orders cannot release inventory again", async () => {
  let claimed = false;
  const tx = {
    order: {
      findUnique: async () => ({
        id: "order-2",
        status: "PAID",
        checkoutStatus: "COMPLETE",
        couponCode: null,
        items: []
      }),
      updateMany: async () => {
        claimed = true;
        return { count: 1 };
      }
    }
  } as unknown as Prisma.TransactionClient;

  assert.equal(await releaseOrderInventoryReservation(tx, "order-2"), false);
  assert.equal(claimed, false);
});

test("merchant order actions cannot bypass payment state", () => {
  assert.doesNotThrow(() => assertMerchantOrderTransition("PENDING", "CANCELLED"));
  assert.doesNotThrow(() => assertMerchantOrderTransition("PAID", "FULFILLED"));
  assert.throws(
    () => assertMerchantOrderTransition("PENDING", "PAID"),
    (error) => error instanceof AppError && error.code === "invalid_order_status_transition"
  );
  assert.throws(
    () => assertMerchantOrderTransition("PAID", "REFUNDED"),
    (error) => error instanceof AppError && error.code === "invalid_order_status_transition"
  );
});

test("merchant checkout actions cannot bypass payment authorization", () => {
  assert.doesNotThrow(() => assertMerchantCheckoutTransition("PAYMENT_PENDING", "ABANDONED"));
  assert.doesNotThrow(() => assertMerchantCheckoutTransition("COMPLETE", "COMPLETE"));
  assert.throws(
    () => assertMerchantCheckoutTransition("PAYMENT_PENDING", "COMPLETE"),
    (error) => error instanceof AppError && error.code === "invalid_checkout_status_transition"
  );
  assert.throws(
    () => assertMerchantCheckoutTransition("PAYMENT_AUTHORIZED", "ABANDONED"),
    (error) => error instanceof AppError && error.code === "invalid_checkout_status_transition"
  );
});

test("confirmed unpaid orders can restore reserved inventory when cancelled", async () => {
  const claims: unknown[] = [];
  let queryCount = 0;
  const tx = {
    $queryRaw: async () => {
      queryCount += 1;
      return queryCount === 1 ? [{ id: "order-confirmed" }] : [];
    },
    order: {
      findUnique: async () => ({
        id: "order-confirmed",
        status: "CONFIRMED",
        checkoutStatus: "PAYMENT_PENDING",
        couponCode: null,
        items: [{ productId: "product-1", variantId: null, quantity: 2 }]
      }),
      updateMany: async (args: unknown) => {
        claims.push(args);
        return { count: 1 };
      }
    },
    inventoryReservation: { findMany: async () => [] },
    coupon: { updateMany: async () => ({ count: 0 }) }
  } as unknown as Prisma.TransactionClient;

  assert.equal(await releaseOrderInventoryReservation(tx, "order-confirmed", {
    orderStatuses: ["PENDING", "CONFIRMED"]
  }), true);
  assert.deepEqual(claims, [{
    where: {
      id: "order-confirmed",
      status: { in: ["PENDING", "CONFIRMED"] },
      checkoutStatus: "PAYMENT_PENDING"
    },
    data: { status: "CANCELLED", checkoutStatus: "ABANDONED" }
  }]);
});
