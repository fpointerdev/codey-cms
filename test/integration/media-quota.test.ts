import assert from "node:assert/strict";
import { after, test } from "node:test";
import { config } from "../../src/config/index.js";
import { prisma } from "../../src/infrastructure/database/prisma.js";
import type { StorageAdapter } from "../../src/infrastructure/storage/storage.types.js";
import { MediaService } from "../../src/modules/cms/media.service.js";

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const filenames = [`quota-a-${runId}.png`, `quota-b-${runId}.png`];
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function uploadBarrier(expected: number) {
  let arrivals = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });

  return async () => {
    arrivals += 1;
    if (arrivals === expected) release();
    await ready;
  };
}

function storageRecorder(beforePut: () => Promise<void>) {
  const stored: string[] = [];
  const deleted: string[] = [];
  const adapter: StorageAdapter = {
    enabled: true,
    checkConnection: async () => undefined,
    publicUrl: (key) => `/uploads/${key}`,
    createUploadUrl: async () => { throw new Error("unused"); },
    createDownloadUrl: async () => { throw new Error("unused"); },
    putObject: async (key) => {
      stored.push(key);
      await beforePut();
    },
    getObject: async () => png,
    deleteObject: async (key) => { deleted.push(key); },
    headObject: async () => ({ sizeBytes: png.byteLength, mimeType: "image/png" })
  };

  return { adapter, stored, deleted };
}

after(async () => {
  await prisma.mediaAsset.deleteMany({ where: { originalFilename: { in: filenames } } });
  await prisma.$disconnect();
});

test("concurrent uploads cannot bypass a site storage quota", async () => {
  const usage = await new MediaService(prisma, config).getUsage();
  const quotaBytes = usage.usedBytes + png.byteLength;
  const quotaConfig = {
    ...config,
    storage: {
      ...config.storage,
      imageVariantWidths: [],
      quotaBytes: {
        default: quotaBytes,
        presentation: quotaBytes,
        cms: quotaBytes,
        shop: quotaBytes,
        saas: quotaBytes
      }
    }
  } as typeof config;
  const beforePut = uploadBarrier(2);
  const firstStorage = storageRecorder(beforePut);
  const secondStorage = storageRecorder(beforePut);
  const first = new MediaService(prisma, quotaConfig, firstStorage.adapter);
  const second = new MediaService(prisma, quotaConfig, secondStorage.adapter);

  const attempts = await Promise.allSettled([
    first.uploadMedia({
      filename: filenames[0],
      mimeType: "image/png",
      kind: "IMAGE",
      dataBase64: png.toString("base64")
    }),
    second.uploadMedia({
      filename: filenames[1],
      mimeType: "image/png",
      kind: "IMAGE",
      dataBase64: png.toString("base64")
    })
  ]);

  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((attempt) => attempt.status === "rejected").length, 1);
  assert.equal(await prisma.mediaAsset.count({
    where: { originalFilename: { in: filenames } }
  }), 1);
  assert.equal(firstStorage.stored.length + secondStorage.stored.length, 2);
  assert.equal(firstStorage.deleted.length + secondStorage.deleted.length, 1);
});
