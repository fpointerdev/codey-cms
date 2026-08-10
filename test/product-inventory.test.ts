import assert from "node:assert/strict";
import test from "node:test";
import {
  availableStock,
  canSetOnHandStock,
  effectivePurchaseLimit,
  withAvailableInventory
} from "../src/modules/products/product-inventory.js";

test("available inventory never exposes reserved units", () => {
  assert.equal(availableStock(10, 4), 6);
  assert.equal(availableStock(2, 5), 0);

  const product = withAvailableInventory({
    stockQuantity: 99,
    reservedQuantity: 0,
    variants: [
      { stockQuantity: 5, reservedQuantity: 2 },
      { stockQuantity: 3, reservedQuantity: 3 }
    ]
  });
  assert.equal(product.availableStock, 3);
  assert.deepEqual(product.variants.map((variant) => variant.availableStock), [3, 0]);
});

test("purchase caps use the strictest valid product or variant limit", () => {
  assert.equal(effectivePurchaseLimit({ maxPurchaseQuantity: 5 }, { maxPurchaseQuantity: 2 }), 2);
  assert.equal(effectivePurchaseLimit({ maxPurchaseQuantity: 0 }, { maxPurchaseQuantity: "2" }), undefined);
});

test("on-hand stock cannot be set below active reservations", () => {
  assert.equal(canSetOnHandStock(4, 4), true);
  assert.equal(canSetOnHandStock(3, 4), false);
});
