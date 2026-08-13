import assert from "node:assert/strict";
import test from "node:test";

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    location: {
      origin: "https://example.test"
    }
  }
});

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: () => null,
    removeItem: () => undefined,
    setItem: () => undefined
  }
});

const { state } = await import("../apps/web/web/core.js");
const {
  customStorefrontEditorHref,
  customStorefrontPageHref,
  customStorefrontPreviewHref
} = await import("../apps/web/web/custom-storefront.js");

test("custom storefront pages use their theme route for preview and editing", () => {
  state.config = { app: { customStorefrontDir: "storefront" } };
  const page = {
    slug: "shop-page",
    locale: "en",
    content: {
      publicPath: "/shop",
      editorBlock: "hero"
    }
  };

  assert.equal(customStorefrontPageHref(page, "/shop-page"), "/shop");
  assert.equal(
    customStorefrontPreviewHref(page, "/shop-page"),
    "/shop?codey-block=hero&codey-page=shop-page&codey-preview=1&locale=en"
  );
  assert.equal(
    customStorefrontEditorHref(page, "/shop-page"),
    "/shop?codey-block=hero&codey-page=shop-page&edit=1&locale=en"
  );
});

test("custom storefront paths fall back when page metadata is unsafe", () => {
  state.config = { app: { customStorefrontDir: "storefront" } };

  assert.equal(
    customStorefrontPageHref({ content: { publicPath: "//outside.example" } }, "/safe"),
    "/safe"
  );
});

test("custom storefront paths include a non-default page locale", () => {
  state.config = {
    app: { customStorefrontDir: "storefront" },
    localization: {
      enabled: true,
      defaultLocale: "en"
    }
  };
  const page = {
    slug: "shop-page",
    locale: "de",
    content: {
      publicPath: "/shop",
      editorBlock: "hero"
    }
  };

  assert.equal(customStorefrontPageHref(page, "/de/shop-page"), "/de/shop");
  assert.equal(
    customStorefrontPreviewHref(page, "/de/shop-page"),
    "/de/shop?codey-block=hero&codey-page=shop-page&codey-preview=1&locale=de"
  );
  assert.equal(
    customStorefrontEditorHref(page, "/de/shop-page"),
    "/de/shop?codey-block=hero&codey-page=shop-page&edit=1&locale=de"
  );
});
