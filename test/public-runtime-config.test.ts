import assert from "node:assert/strict";
import test from "node:test";
import { defaultDesignSystemSettings } from "../src/modules/config/site-design.js";
import {
  buildPublicRuntimeConfig,
  publicRuntimeConfigSchema
} from "../src/modules/config/public-runtime-config.js";
import { normalizeLocalizationSettings } from "../src/modules/localization/localization.service.js";

function publicConfig() {
  const runtimeConfig = {
    env: "private-environment",
    app: {
      name: "CodeY CMS",
      mode: "cms",
      publicUrl: "https://www.example.com"
    },
    api: { trustProxy: 4 },
    features: {
      auth: true,
      users: true,
      roles: true,
      config: true,
      health: true,
      cms: true,
      products: false,
      orders: false,
      notifications: true,
      payments: false
    },
    storage: {
      bucket: "private-bucket",
      keyPrefix: "private-prefix",
      publicBaseUrl: "https://media.example.com",
      imageVariantWidths: [480, 960]
    }
  };

  return buildPublicRuntimeConfig(runtimeConfig as never, {
    title: "Public site",
    description: "Public description",
    metaTitle: "Public title",
    metaDescription: "Public metadata",
    siteUrl: "https://www.example.com",
    searchIndexing: true,
    sitemapEnabled: true,
    design: defaultDesignSystemSettings,
    generatedCss: ".generated { color: black; }",
    logoUrl: "/uploads/logo.webp",
    logoMode: "image-and-name",
    logoAltText: "Public site logo",
    logoHeight: 42,
    faviconUrl: "/uploads/favicon.webp",
    socialImageUrl: "/uploads/social.webp",
    socialImageAlt: "Public site",
    customCss: ".custom { color: green; }"
  }, normalizeLocalizationSettings({}, false));
}

test("public runtime configuration exposes only the explicit browser contract", () => {
  const result = publicConfig();

  assert.deepEqual(Object.keys(result), [
    "app",
    "features",
    "localization",
    "siteSettings",
    "storage"
  ]);
  assert.deepEqual(Object.keys(result.app), ["name", "mode", "publicUrl"]);
  assert.deepEqual(Object.keys(result.features), ["cms", "products", "orders", "payments"]);
  assert.deepEqual(Object.keys(result.storage), ["publicBaseUrl", "imageVariantWidths"]);

  const serialized = JSON.stringify(result);
  for (const privateValue of ["private-environment", "private-bucket", "private-prefix", "trustProxy"]) {
    assert.doesNotMatch(serialized, new RegExp(privateValue));
  }
});

test("public runtime configuration rejects accidental top-level fields", () => {
  const result = publicConfig();
  const parsed = publicRuntimeConfigSchema.safeParse({
    ...result,
    installedModules: [{ moduleId: "cms" }]
  });

  assert.equal(parsed.success, false);
});
