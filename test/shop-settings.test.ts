import assert from "node:assert/strict";
import test from "node:test";
import { defaultShopSettings, normalizeShopSettings } from "../src/modules/products/shop-settings.js";
import { listProductsQuery, shopSettingsSchema } from "../src/modules/products/products.schemas.js";
import { productCatalogOrderBy } from "../src/modules/products/product-sort.js";

test("shop settings use stable defaults and reject invalid saved shapes", () => {
  assert.deepEqual(normalizeShopSettings(undefined), defaultShopSettings);
  assert.deepEqual(normalizeShopSettings({ catalogLayout: "unknown" }), defaultShopSettings);
  assert.equal(defaultShopSettings.catalogLayout, "grid");
  assert.equal(defaultShopSettings.productsPerPage, 20);
  assert.equal(defaultShopSettings.catalogHero.enabled, false);
  assert.equal(defaultShopSettings.catalogHero.playback, "hover-focus");
  assert.equal(defaultShopSettings.catalogSort, "newest");
  assert.equal(defaultShopSettings.showDescriptions, true);
});

test("shop settings schema validates supported storefront choices", () => {
  const settings = shopSettingsSchema.parse({
    catalogTitle: "Workshop",
    catalogDescription: "Made to last.",
    catalogLayout: "compact",
    cardStyle: "technical",
    catalogSort: "price-low",
    detailLayout: "spec-sheet",
    detailStyle: "industrial",
    productsPerPage: 32,
    showCategories: false,
    showAttributes: true,
    showSku: true,
    showStock: false,
    showDescriptions: false,
    catalogHero: {
      enabled: true,
      mediaType: "VIDEO",
      mediaUrl: "/uploads/workshop.mp4",
      posterUrl: "https://cdn.example.com/workshop.webp",
      altText: "",
      ctaLabel: "See the collection",
      ctaUrl: "/shop/category/summer",
      playback: "hover-focus",
      loop: true
    }
  });

  assert.equal(settings.catalogTitle, "Workshop");
  assert.equal(settings.catalogLayout, "compact");
  assert.equal(settings.productsPerPage, 32);
  assert.equal(settings.showCategories, false);
  assert.equal(settings.catalogHero.mediaUrl, "/uploads/workshop.mp4");
  assert.equal(settings.catalogHero.playback, "hover-focus");
  assert.equal(settings.catalogSort, "price-low");
  assert.equal(settings.showDescriptions, false);
  assert.equal(settings.catalogHero.ctaUrl, "/shop/category/summer");
  assert.throws(() => shopSettingsSchema.parse({ productsPerPage: 100 }));
  assert.throws(() => shopSettingsSchema.parse({
    catalogHero: { enabled: true, mediaType: "VIDEO" }
  }));
  assert.throws(() => shopSettingsSchema.parse({
    catalogHero: { enabled: true, mediaType: "IMAGE", mediaUrl: "/uploads/workshop.webp" }
  }));
  assert.throws(() => shopSettingsSchema.parse({
    catalogHero: {
      enabled: true,
      mediaType: "VIDEO",
      mediaUrl: "javascript:alert(1)"
    }
  }));
  assert.throws(() => shopSettingsSchema.parse({
    catalogHero: { ctaLabel: "Explore" }
  }));
  assert.throws(() => shopSettingsSchema.parse({
    catalogHero: { ctaUrl: "/shop" }
  }));
  assert.throws(() => shopSettingsSchema.parse({
    catalogHero: { ctaLabel: "Manage", ctaUrl: "/%2e%2e/admin" }
  }));
});

test("catalog sort query values map to deterministic database ordering", () => {
  assert.equal(listProductsQuery.parse({}).sort, "newest");
  assert.equal(listProductsQuery.parse({ sort: "price-high" }).sort, "price-high");
  assert.equal(listProductsQuery.safeParse({ sort: "random" }).success, false);
  assert.deepEqual(productCatalogOrderBy("newest"), [{ createdAt: "desc" }, { id: "desc" }]);
  assert.deepEqual(productCatalogOrderBy("name"), [{ name: "asc" }, { id: "asc" }]);
  assert.deepEqual(productCatalogOrderBy("price-low"), [{ priceCents: "asc" }, { id: "asc" }]);
  assert.deepEqual(productCatalogOrderBy("price-high"), [{ priceCents: "desc" }, { id: "desc" }]);
});
