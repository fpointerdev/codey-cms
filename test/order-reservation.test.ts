import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { releaseOrderInventoryReservation } from "../src/modules/orders/checkout.service.js";

test("releasing an order restores grouped stock and coupon usage once", async () => {
  const variantUpdates: unknown[] = [];
  const productUpdates: unknown[] = [];
  const couponUpdates: unknown[] = [];
  const tx = {
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
    productVariant: {
      updateMany: async (args: unknown) => {
        variantUpdates.push(args);
        return { count: 1 };
      }
    },
    product: {
      updateMany: async (args: unknown) => {
        productUpdates.push(args);
        return { count: 1 };
      }
    },
    coupon: {
      updateMany: async (args: unknown) => {
        couponUpdates.push(args);
        return { count: 1 };
      }
    }
  } as unknown as Prisma.TransactionClient;

  assert.equal(await releaseOrderInventoryReservation(tx, "order-1"), true);
  assert.deepEqual(variantUpdates, [{
    where: { id: "variant-1", productId: "product-1" },
    data: { stockQuantity: { increment: 3 } }
  }]);
  assert.deepEqual(productUpdates, [{
    where: { id: "product-2" },
    data: { stockQuantity: { increment: 4 } }
  }]);
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
