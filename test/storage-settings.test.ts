import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { StorageSettingsService } from "../src/infrastructure/storage/storage-settings.service.js";

function storageHarness(
  localDir: string,
  initialValue: unknown = null,
  runtimeOverrides: Record<string, unknown> = {}
) {
  let storedValue = initialValue;
  const media: Array<{ storageKey: string | null; mimeType: string | null; variants: unknown }> = [];
  const prisma = {
    site: {
      upsert: async () => ({ id: "site-1" })
    },
    moduleSetting: {
      findUnique: async () => storedValue ? { value: storedValue } : null,
      upsert: async (input: { update: { value: unknown } }) => {
        storedValue = input.update.value;
        return { value: storedValue };
      }
    },
    mediaAsset: {
      findMany: async () => media
    }
  };
  const config = {
    isProduction: false,
    app: { name: "Storage Test", mode: "cms" },
    security: { credentialEncryptionKey: "storage-test-encryption-key-at-least-32" },
    storage: {
      driver: "local",
      localDir,
      endpoint: undefined,
      region: "auto",
      bucket: undefined,
      accessKeyId: undefined,
      secretAccessKey: undefined,
      forcePathStyle: true,
      publicBaseUrl: undefined,
      keyPrefix: "sites/storage-test",
      signedUrlTtlSeconds: 900,
      maxUploadBytes: 10 * 1024 * 1024,
      requestBodyLimit: "12mb",
      imageVariantWidths: [320, 640, 1200],
      quotaBytes: {
        default: 512 * 1024 * 1024,
        presentation: 512 * 1024 * 1024,
        cms: 2 * 1024 * 1024 * 1024,
        shop: 5 * 1024 * 1024 * 1024,
        saas: 2 * 1024 * 1024 * 1024
      },
      ...runtimeOverrides
    }
  };

  return {
    service: new StorageSettingsService(prisma as never, config as never),
    media,
    storedValue: () => storedValue
  };
}

test("environment storage recognizes only bounded Cloudflare R2 hostnames", async () => {
  const localDir = await mkdtemp(path.join(tmpdir(), "codey-storage-hostname-"));
  const r2 = storageHarness(localDir, null, {
    driver: "s3",
    endpoint: "https://account.r2.cloudflarestorage.com",
    bucket: "website-media",
    accessKeyId: "test-access-key",
    secretAccessKey: "test-secret-key"
  });
  const lookalike = storageHarness(localDir, null, {
    driver: "s3",
    endpoint: "https://account.r2.cloudflarestorage.com.attacker.example",
    bucket: "website-media",
    accessKeyId: "test-access-key",
    secretAccessKey: "test-secret-key"
  });

  assert.equal((await r2.service.getAdminStatus()).provider, "r2");
  assert.equal((await lookalike.service.getAdminStatus()).provider, "s3");
});

test("local storage can be selected without exposing a filesystem path", async () => {
  const localDir = await mkdtemp(path.join(tmpdir(), "codey-storage-local-"));
  const harness = storageHarness(localDir);
  await harness.service.initialize();

  const result = await harness.service.update({ provider: "local" });
  assert.equal(result.storage.provider, "local");
  assert.equal(result.storage.source, "dashboard");
  assert.equal(result.storage.configured, true);
  assert.deepEqual(harness.storedValue(), {
    provider: "local",
    lastTestedAt: result.storage.lastTestedAt,
    configurationRevision: result.storage.settingsRevision
  });
  assert.equal("localDir" in (harness.storedValue() as Record<string, unknown>), false);
});

test("provider changes wait for in-flight media operations before switching", async () => {
  const localDir = await mkdtemp(path.join(tmpdir(), "codey-storage-drain-"));
  const harness = storageHarness(localDir);
  await harness.service.initialize();

  let finishOperation = () => {};
  const operationStarted = new Promise<void>((resolve) => {
    void harness.service.withAdapter(async () => {
      resolve();
      await new Promise<void>((finish) => {
        finishOperation = finish;
      });
    });
  });
  await operationStarted;

  let updateCompleted = false;
  const update = harness.service.update({ provider: "local" }).then(() => {
    updateCompleted = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(updateCompleted, false);

  finishOperation();
  await update;
  assert.equal(updateCompleted, true);
});

test("Cloudflare R2 credentials are encrypted and remain write-only", async () => {
  const localDir = await mkdtemp(path.join(tmpdir(), "codey-storage-r2-"));
  const harness = storageHarness(localDir);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 200 });

  try {
    await harness.service.initialize();
    const result = await harness.service.update({
      provider: "r2",
      accountId: "0123456789abcdef0123456789abcdef",
      bucket: "website-media",
      accessKeyId: "r2-access-key",
      secretAccessKey: "r2-secret-key"
    });

    const stored = harness.storedValue() as Record<string, unknown>;
    assert.equal(stored.provider, "r2");
    assert.equal(stored.accountId, "0123456789abcdef0123456789abcdef");
    assert.equal(stored.accessKeyId, "r2-access-key");
    assert.equal(typeof stored.encryptedCredentials, "string");
    assert.equal(JSON.stringify(stored).includes("r2-secret-key"), false);
    assert.equal(result.storage.secretAccessKeyConfigured, true);
    assert.equal("secretAccessKey" in result.storage, false);
    assert.equal(
      harness.service.getRuntimeConfig().endpoint,
      "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("saved cloud credentials survive non-secret updates but not a changed binding", async () => {
  const localDir = await mkdtemp(path.join(tmpdir(), "codey-storage-preserve-"));
  const harness = storageHarness(localDir);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 200 });

  try {
    await harness.service.initialize();
    await harness.service.update({
      provider: "r2",
      accountId: "0123456789abcdef0123456789abcdef",
      bucket: "website-media",
      accessKeyId: "r2-access-key",
      secretAccessKey: "r2-secret-key"
    });
    await harness.service.update({
      provider: "r2",
      accountId: "0123456789abcdef0123456789abcdef",
      bucket: "website-media",
      accessKeyId: "r2-access-key"
    });

    await assert.rejects(
      harness.service.update({
        provider: "r2",
        accountId: "fedcba9876543210fedcba9876543210",
        bucket: "website-media",
        accessKeyId: "r2-access-key"
      }),
      /secret access key/i
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider changes copy existing local media before activation", async () => {
  const localDir = await mkdtemp(path.join(tmpdir(), "codey-storage-migrate-"));
  const harness = storageHarness(localDir);
  const storageKey = "sites/storage-test/media/example.txt";
  harness.media.push({ storageKey, mimeType: "text/plain", variants: null });
  await harness.service.initialize();
  await harness.service.adapter.putObject(storageKey, Buffer.from("existing media"), "text/plain");

  const originalFetch = globalThis.fetch;
  const copiedBodies: Buffer[] = [];
  globalThis.fetch = async (_input, init) => {
    if (init?.method === "PUT" && init.body) {
      copiedBodies.push(Buffer.from(init.body as Uint8Array));
    }
    return new Response(null, { status: 200 });
  };

  try {
    const result = await harness.service.update({
      provider: "r2",
      accountId: "0123456789abcdef0123456789abcdef",
      bucket: "website-media",
      accessKeyId: "r2-access-key",
      secretAccessKey: "r2-secret-key"
    });
    assert.equal(result.migration.copiedObjects, 1);
    assert.equal(copiedBodies.length, 1);
    assert.equal(copiedBodies[0].toString("utf8"), "existing media");
    assert.equal((await readFile(path.join(localDir, storageKey))).toString("utf8"), "existing media");
    assert.equal(harness.service.adapter.publicUrl(storageKey), `/uploads/${storageKey}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
