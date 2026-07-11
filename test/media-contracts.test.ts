import assert from "node:assert/strict";
import test from "node:test";
import { containsMediaReference } from "../src/modules/cms/media.service.js";
import {
  isOptimizableImageKey,
  optimizedImageStorageKey,
  requestedImageWidth
} from "../src/modules/cms/media-optimizer.js";
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

test("manual payment events use an exact status mapping", () => {
  assert.equal(statusFromWebhook("payment.succeeded"), "SUCCEEDED");
  assert.equal(statusFromWebhook("payment.failed"), "FAILED");
  assert.equal(statusFromWebhook("payment.refunded"), "REFUNDED");
  assert.equal(statusFromWebhook("payment.succeeded.fake"), undefined);
});
