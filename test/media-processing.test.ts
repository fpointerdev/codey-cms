import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import type { StorageAdapter } from "../src/infrastructure/storage/storage.types.js";
import {
  inspectImageBuffer,
  MediaProcessingQueue
} from "../src/modules/cms/media-optimizer.js";
import { inspectMediaFile } from "../src/modules/cms/media-policy.js";
import { MediaService } from "../src/modules/cms/media.service.js";

const processingLimits = {
  maxPixels: 2_000_000,
  maxWidth: 500,
  maxHeight: 500,
  maxFrames: 10
};

function glbFile(document: Record<string, unknown>) {
  const source = Buffer.from(JSON.stringify(document), "utf8");
  const padding = Buffer.alloc((4 - source.length % 4) % 4, 0x20);
  const json = Buffer.concat([source, padding]);
  const body = Buffer.alloc(20 + json.length);
  body.write("glTF", 0, "ascii");
  body.writeUInt32LE(2, 4);
  body.writeUInt32LE(body.length, 8);
  body.writeUInt32LE(json.length, 12);
  body.writeUInt32LE(0x4e4f534a, 16);
  json.copy(body, 20);
  return body;
}

function glbWithBinary(document: Record<string, unknown>, binary: Buffer) {
  const jsonOnly = glbFile(document);
  const body = Buffer.alloc(jsonOnly.length + 8 + binary.length);
  jsonOnly.copy(body);
  body.writeUInt32LE(binary.length, jsonOnly.length);
  body.writeUInt32LE(0x004e4942, jsonOnly.length + 4);
  binary.copy(body, jsonOnly.length + 8);
  body.writeUInt32LE(body.length, 8);
  return body;
}

test("GLB uploads require a valid self-contained version 2 model", () => {
  const valid = glbFile({ asset: { version: "2.0" }, scenes: [{}], scene: 0 });
  const external = glbFile({
    asset: { version: "2.0" },
    buffers: [{ uri: "https://tracker.example/model.bin", byteLength: 12 }]
  });
  const missingBinary = glbFile({
    asset: { version: "2.0" },
    buffers: [{ byteLength: 12 }]
  });
  const invalidVersion = glbFile({ asset: { version: "1.0" }, scenes: [{}] });
  const validBinary = glbWithBinary(
    { asset: { version: "2.0" }, buffers: [{ byteLength: 4 }] },
    Buffer.alloc(4)
  );

  assert.equal(inspectMediaFile("product.glb", "model/gltf-binary", valid, "OTHER").kind, "OTHER");
  assert.equal(inspectMediaFile("product.glb", "model/gltf-binary", validBinary, "OTHER").kind, "OTHER");
  assert.throws(
    () => inspectMediaFile("product.glb", "model/gltf-binary", external, "OTHER"),
    (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "media_signature_mismatch")
  );
  assert.throws(
    () => inspectMediaFile("product.glb", "model/gltf-binary", missingBinary, "OTHER"),
    (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "media_signature_mismatch")
  );
  assert.throws(
    () => inspectMediaFile("product.glb", "model/gltf-binary", invalidVersion, "OTHER"),
    (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "media_signature_mismatch")
  );
  assert.throws(
    () => inspectMediaFile("product.png", "model/gltf-binary", valid, "OTHER"),
    (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "media_extension_mismatch")
  );
});

test("compressed images cannot bypass decoded dimension limits", async () => {
  const compressed = await sharp({
    create: {
      width: 1_000,
      height: 1_000,
      channels: 3,
      background: "white"
    }
  }).png({ compressionLevel: 9 }).toBuffer();

  assert.ok(compressed.byteLength < 20_000);
  await assert.rejects(
    inspectImageBuffer(compressed, processingLimits),
    (error: unknown) => Boolean(
      error && typeof error === "object" && "code" in error && error.code === "media_image_limits_exceeded"
    )
  );
});

test("animated images cannot bypass frame limits", async () => {
  const animated = await sharp(
    Buffer.from([
      255, 0, 0, 255,
      0, 0, 255, 255
    ]),
    { raw: { width: 1, height: 2, channels: 4, pageHeight: 1 } }
  ).gif({ delay: [100, 100], loop: 0 }).toBuffer();

  await assert.rejects(
    inspectImageBuffer(animated, { ...processingLimits, maxFrames: 1 }),
    (error: unknown) => Boolean(
      error && typeof error === "object" && "code" in error && error.code === "media_image_limits_exceeded"
    )
  );
});

test("media processing queue never exceeds its configured concurrency", async () => {
  const queue = new MediaProcessingQueue(2);
  let active = 0;
  let maximumActive = 0;

  await Promise.all(Array.from({ length: 8 }, (_, index) => queue.run(async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return index;
  })));

  assert.equal(maximumActive, 2);
});

test("failed media persistence removes original and generated objects", async () => {
  const body = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 3,
      background: "white"
    }
  }).png().toBuffer();
  const storedKeys: string[] = [];
  const deletedKeys: string[] = [];
  const storage: StorageAdapter = {
    enabled: true,
    checkConnection: async () => undefined,
    publicUrl: (key) => `/uploads/${key}`,
    createUploadUrl: async () => { throw new Error("unused"); },
    createDownloadUrl: async () => { throw new Error("unused"); },
    putObject: async (key) => { storedKeys.push(key); },
    getObject: async () => body,
    deleteObject: async (key) => { deletedKeys.push(key); },
    headObject: async () => ({ sizeBytes: body.byteLength, mimeType: "image/png" })
  };
  const prisma = {
    site: {
      upsert: async () => ({ id: "site-1", slug: "default", deploymentProfile: "cms" })
    },
    mediaAsset: {
      findMany: async () => [],
      create: async () => { throw new Error("database write failed"); }
    },
    $executeRaw: async () => 0
  };
  const config = {
    app: { name: "Test CMS", mode: "cms" },
    storage: {
      keyPrefix: "sites/default",
      maxUploadBytes: 1_000_000,
      imageVariantWidths: [1],
      quotaBytes: {
        default: 1_000_000,
        presentation: 1_000_000,
        cms: 1_000_000,
        shop: 1_000_000,
        saas: 1_000_000
      }
    },
    media: {
      maxPixels: 1_000_000,
      maxWidth: 1_000,
      maxHeight: 1_000,
      maxFrames: 10,
      processingConcurrency: 1
    }
  };
  const service = new MediaService(prisma as never, config as never, storage);

  await assert.rejects(service.uploadMedia({
    filename: "pixel.png",
    mimeType: "image/png",
    kind: "IMAGE",
    dataBase64: body.toString("base64")
  }), /database write failed/);

  assert.equal(storedKeys.length, 2);
  assert.deepEqual([...deletedKeys].sort(), [...storedKeys].sort());
});
