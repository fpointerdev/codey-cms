import assert from "node:assert/strict";
import test from "node:test";
import { containsMediaReference } from "../src/modules/cms/media.service.js";
import {
  isOptimizableImageKey,
  optimizedImageStorageKey,
  requestedImageWidth
} from "../src/modules/cms/media-optimizer.js";
import {
  inspectMediaFile,
  publicMediaResponsePolicy
} from "../src/modules/cms/media-policy.js";
import { enrichPublicMedia } from "../src/modules/cms/public-media.js";
import {
  sanitizeContentBlockValue,
  sanitizePostContent,
  sanitizeRichText
} from "../src/modules/cms/rich-text-sanitizer.js";
import { statusFromWebhook } from "../src/modules/payments/payments.routes.js";

test("responsive image widths are limited to configured variants", () => {
  const allowedWidths = [320, 640, 1200];

  assert.equal(requestedImageWidth("640", allowedWidths), 640);
  assert.equal(requestedImageWidth("641", allowedWidths), undefined);
  assert.equal(requestedImageWidth("2401", allowedWidths), undefined);
  assert.equal(
    optimizedImageStorageKey("sites/default/media/photo.jpg", 640),
    "sites/default/media/photo-w640.webp"
  );
  assert.equal(isOptimizableImageKey("sites/default/media/photo.jpg"), true);
  assert.equal(isOptimizableImageKey("sites/default/media/photo-w640.webp"), false);
});

test("media references are found recursively without substring matches", () => {
  const references = new Set(["asset_123", "/uploads/sites/default/media/photo.jpg"]);
  const value = {
    slides: [
      {
        mediaAssetId: "asset_123",
        url: "/uploads/sites/default/media/photo.jpg"
      }
    ]
  };

  assert.equal(containsMediaReference(value, references), true);
  assert.equal(containsMediaReference({ mediaAssetId: "asset_123_old" }, references), false);
});

test("public media enrichment preserves non-plain values", async () => {
  const createdAt = new Date("2026-07-22T10:00:00.000Z");
  const result = await enrichPublicMedia({
    mediaAsset: {
      findMany: async () => [{
        id: "asset_123",
        url: "/uploads/sites/default/media/photo.jpg",
        width: 1200,
        height: 800,
        variants: null,
        altText: "Product photo"
      }]
    }
  }, {
    createdAt,
    image: {
      mediaAssetId: "asset_123",
      url: "/uploads/sites/default/media/photo.jpg"
    }
  });

  assert.strictEqual(result.createdAt, createdAt);
  assert.deepEqual(result.image, {
    mediaAssetId: "asset_123",
    url: "/uploads/sites/default/media/photo.jpg",
    width: 1200,
    height: 800,
    alt: "Product photo"
  });
});

test("media uploads require matching extensions, MIME types, kinds, and file signatures", () => {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(16)
  ]);

  assert.equal(inspectMediaFile("hero.png", "image/png", png, "IMAGE").mimeType, "image/png");
  assert.throws(
    () => inspectMediaFile("hero.jpg", "image/png", png, "IMAGE"),
    /extension does not match/i
  );
  assert.throws(
    () => inspectMediaFile("payload.png", "image/png", Buffer.from("<script>alert(1)</script>"), "IMAGE"),
    /contents do not match/i
  );
  assert.throws(
    () => inspectMediaFile("vector.svg", "image/svg+xml", Buffer.from("<svg></svg>"), "IMAGE"),
    /not supported/i
  );
  assert.throws(
    () => inspectMediaFile("document.pdf", "application/pdf", Buffer.from("%PDF-1.7"), "IMAGE"),
    /kind does not match/i
  );
});

test("public media response policy serves documents as downloads and rejects unknown files", () => {
  assert.deepEqual(publicMediaResponsePolicy("sites/default/media/document.pdf"), {
    mimeType: "application/pdf",
    disposition: "attachment"
  });
  assert.equal(publicMediaResponsePolicy("sites/default/media/payload.html"), null);
});

test("rich CMS fields are sanitized before persistence and rendering", () => {
  const unsafe = '<p>Hello <strong>world</strong></p><img src=x onerror=alert(1)><a href="javascript:alert(1)">bad</a><script>alert(2)</script>';
  const sanitized = sanitizeRichText(unsafe);

  assert.match(sanitized, /<strong>world<\/strong>/);
  assert.doesNotMatch(sanitized, /img|onerror|javascript|script|alert/i);
  assert.deepEqual(sanitizePostContent({ body: unsafe, layout: "article" }), {
    body: sanitized,
    layout: "article"
  });
  assert.deepEqual(
    sanitizeContentBlockValue("CUSTOM", {
      title: "Title <kept as text>",
      items: [{ body: unsafe, url: "https://example.com" }]
    }),
    {
      title: "Title <kept as text>",
      items: [{ body: sanitized, url: "https://example.com" }]
    }
  );
});

test("manual payment events use an exact status mapping", () => {
  assert.equal(statusFromWebhook("payment.succeeded"), "SUCCEEDED");
  assert.equal(statusFromWebhook("payment.failed"), "FAILED");
  assert.equal(statusFromWebhook("payment.refunded"), "REFUNDED");
  assert.equal(statusFromWebhook("payment.succeeded.fake"), undefined);
});
