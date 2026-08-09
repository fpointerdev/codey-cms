import assert from "node:assert/strict";
import test from "node:test";
import { siteSettingsSchema } from "../src/modules/config/config.schemas.js";

test("site settings accept uploaded branding and sharing media", () => {
  const settings = siteSettingsSchema.parse({
    title: "Example Studio",
    logoUrl: "/uploads/logo.webp",
    logoMode: "image-and-name",
    logoAltText: "Example Studio logo",
    logoHeight: 48,
    faviconUrl: "https://cdn.example.com/favicon.png",
    socialImageUrl: "/uploads/social.webp",
    socialImageAlt: "Example Studio preview"
  });

  assert.equal(settings.logoMode, "image-and-name");
  assert.equal(settings.logoHeight, 48);
  assert.equal(settings.faviconUrl, "https://cdn.example.com/favicon.png");
  assert.equal(settings.searchIndexing, true);
  assert.equal(settings.sitemapEnabled, true);
});

test("site settings reject executable and non-image media URLs", () => {
  for (const field of ["logoUrl", "faviconUrl", "socialImageUrl"] as const) {
    const result = siteSettingsSchema.safeParse({
      title: "Example Studio",
      [field]: "javascript:alert(1)"
    });

    assert.equal(result.success, false, `${field} should reject unsafe URLs`);
  }
});
