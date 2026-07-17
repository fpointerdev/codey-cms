import assert from "node:assert/strict";
import test from "node:test";
import { defaultShopSettings, normalizeShopSettings } from "../src/modules/products/shop-settings.js";
import { shopSettingsSchema } from "../src/modules/products/products.schemas.js";

test("shop settings use stable defaults and reject invalid saved shapes", () => {
  assert.deepEqual(normalizeShopSettings(undefined), defaultShopSettings);
  assert.deepEqual(normalizeShopSettings({ catalogLayout: "unknown" }), defaultShopSettings);
  assert.equal(defaultShopSettings.catalogLayout, "grid");
  assert.equal(defaultShopSettings.productsPerPage, 20);
});

test("shop settings schema validates supported storefront choices", () => {
  const settings = shopSettingsSchema.parse({
    catalogTitle: "Workshop",
    catalogDescription: "Made to last.",
    catalogLayout: "compact",
    cardStyle: "technical",
    detailLayout: "spec-sheet",
    detailStyle: "industrial",
    productsPerPage: 32,
    showCategories: false,
    showAttributes: true,
    showSku: true,
    showStock: false
  });

  assert.equal(settings.catalogTitle, "Workshop");
  assert.equal(settings.catalogLayout, "compact");
  assert.equal(settings.productsPerPage, 32);
  assert.equal(settings.showCategories, false);
  assert.throws(() => shopSettingsSchema.parse({ productsPerPage: 100 }));
});
