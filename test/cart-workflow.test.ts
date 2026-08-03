import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../src/core/errors/app-error.js";
import type { ModuleContext } from "../src/core/types/module.js";
import { removeCartItem, updateCartItem } from "../src/modules/orders/checkout.service.js";
import {
  cartItemParams,
  checkoutCartSchema,
  updateCartItemSchema
} from "../src/modules/orders/orders.schemas.js";

function cartContext(options: { quote?: boolean } = {}) {
  const updates: unknown[] = [];
  const deletes: unknown[] = [];
  const locks: unknown[] = [];
  const cart = {
    id: "cart-1",
    sessionToken: "cart-session-token-value",
    customerEmail: null,
    currency: "EUR",
    status: "ACTIVE",
    couponCode: null,
    shippingCountry: null,
    shippingRateId: null,
    metadata: null,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [{
      id: "item-1",
      cartId: "cart-1",
      productId: "product-1",
      variantId: null,
      selectionKey: "product-1:",
      quantity: 2,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date()
    }]
  };
  const product = {
    id: "product-1",
    name: "Desk",
    slug: "desk",
    status: "ACTIVE",
    priceCents: 12500,
    currency: "EUR",
    stockQuantity: 8,
    metadata: options.quote ? { purchaseMode: "quote" } : {},
    images: [{ url: "/uploads/desk.jpg", alt: "Desk" }],
    variants: []
  };
  const tx = {
    $queryRaw: async (query: unknown) => {
      locks.push(query);
      return [{ id: cart.id }];
    },
    cart: {
      findFirst: async () => ({ ...cart, items: undefined }),
      findUniqueOrThrow: async () => cart
    },
    cartItem: {
      findFirst: async () => cart.items[0],
      update: async (args: unknown) => {
        updates.push(args);
        return cart.items[0];
      },
      deleteMany: async (args: unknown) => {
        deletes.push(args);
        return { count: 1 };
      }
    },
    product: { findFirst: async () => ({ ...product, variants: [] }) }
  };
  const context = {
    prisma: {
      $transaction: async (callback: (transaction: typeof tx) => unknown) => callback(tx),
      product: { findMany: async () => [product] }
    }
  } as unknown as ModuleContext;

  return { context, updates, deletes, locks };
}

test("cart item updates stay token scoped and return current totals", async () => {
  const { context, updates, locks } = cartContext();
  const result = await updateCartItem(context, "cart-session-token-value", "item-1", 2);

  assert.equal(locks.length, 1);
  assert.deepEqual(updates, [{ where: { id: "item-1" }, data: { quantity: 2 } }]);
  assert.equal(result.items[0]?.available, true);
  assert.equal(result.items[0]?.lineTotalCents, 25000);
  assert.equal(result.subtotalCents, 25000);
});

test("cart item deletion is scoped to both cart and item", async () => {
  const { context, deletes, locks } = cartContext();
  await removeCartItem(context, "cart-session-token-value", "item-1");

  assert.equal(locks.length, 1);
  assert.deepEqual(deletes, [{ where: { id: "item-1", cartId: "cart-1" } }]);
});

test("cart mutation schemas reject invalid quantities and item ids", () => {
  assert.equal(updateCartItemSchema.safeParse({ quantity: 0 }).success, false);
  assert.equal(updateCartItemSchema.safeParse({ quantity: 2 }).success, true);
  assert.equal(cartItemParams.safeParse({ token: "long-enough-cart-token", itemId: "not-a-cuid" }).success, false);
});

test("quote-only products cannot be converted into zero-price cart orders", async () => {
  const { context } = cartContext({ quote: true });
  await assert.rejects(
    () => updateCartItem(context, "cart-session-token-value", "item-1", 2),
    (error) => error instanceof AppError && error.code === "invalid_cart_item"
  );
});

test("physical checkout validates a complete delivery address", () => {
  const base = {
    customerEmail: "buyer@example.com",
    shippingCountry: "DE"
  };
  assert.equal(checkoutCartSchema.safeParse({
    ...base,
    shippingAddress: { line1: "Main Street 1", city: "Berlin", postalCode: "10115" }
  }).success, true);
  assert.equal(checkoutCartSchema.safeParse({
    ...base,
    shippingAddress: { line1: "Main Street 1", city: "Berlin" }
  }).success, false);
  assert.equal(checkoutCartSchema.safeParse(base).success, false);
  assert.equal(checkoutCartSchema.safeParse({
    customerEmail: "buyer@example.com",
    shippingRateId: "ckx1234567890123456789012",
    shippingAddress: { line1: "Main Street 1", city: "Berlin", postalCode: "10115" }
  }).success, false);
});
