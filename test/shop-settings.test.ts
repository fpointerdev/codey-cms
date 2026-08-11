import assert from "node:assert/strict";
import test from "node:test";
import { defaultShopSettings, normalizeShopSettings } from "../src/modules/products/shop-settings.js";
import { shopSettingsSchema } from "../src/modules/products/products.schemas.js";

test("shop settings use stable defaults and reject invalid saved shapes", () => {
  assert.deepEqual(normalizeShopSettings(undefined), defaultShopSettings);
  assert.deepEqual(normalizeShopSettings({ catalogLayout: "unknown" }), defaultShopSettings);
  assert.equal(defaultShopSettings.catalogLayout, "grid");
  assert.equal(defaultShopSettings.productsPerPage, 20);
  assert.equal(defaultShopSettings.catalogHero.enabled, false);
  assert.equal(defaultShopSettings.catalogHero.playback, "hover-focus");
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
    showStock: false,
    catalogHero: {
      enabled: true,
      mediaType: "VIDEO",
      mediaUrl: "/uploads/workshop.mp4",
      posterUrl: "https://cdn.example.com/workshop.webp",
      altText: "",
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
});
