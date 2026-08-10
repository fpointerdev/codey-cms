import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../src/config/index.js";
import { S3StorageAdapter } from "../src/infrastructure/storage/s3-storage.js";

function s3Config(overrides: Partial<AppConfig["storage"]> = {}): AppConfig["storage"] {
  return {
    driver: "s3",
    localDir: "storage/uploads",
    endpoint: "https://storage.example.com/base/",
    region: "auto",
    bucket: "codey",
    accessKeyId: "access-key",
    secretAccessKey: "secret-key",
    forcePathStyle: true,
    publicBaseUrl: undefined,
    keyPrefix: "sites/default",
    signedUrlTtlSeconds: 900,
    maxUploadBytes: 10 * 1024 * 1024,
    requestBodyLimit: "11mb",
    imageVariantWidths: [480, 960],
    quotaBytes: {
      default: 1024,
      presentation: 1024,
      cms: 1024,
      shop: 1024,
      saas: 1024
    },
    ...overrides
  };
}

test("S3 URL normalization handles long slash runs in linear time", async () => {
  const slashRun = "/".repeat(100_000);
  const storage = new S3StorageAdapter(s3Config({
    endpoint: `https://storage.example.com/base/${slashRun}segment/`,
    publicBaseUrl: `https://cdn.example.com/media${slashRun}`
  }));

  assert.equal(storage.publicUrl("images/hero.jpg"), "https://cdn.example.com/media/images/hero.jpg");

  const download = await storage.createDownloadUrl("images/hero.jpg");
  assert.equal(new URL(download.url).pathname, `/base/${slashRun}segment/codey/images/hero.jpg`);
});
