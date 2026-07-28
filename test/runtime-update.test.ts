import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../src/config/index.js";
import { AppError } from "../src/core/errors/app-error.js";
import type { AppLogger } from "../src/infrastructure/logging/logger.js";
import { RuntimeUpdateService } from "../src/runtime/runtime-update.service.js";
import { createSignedRelease } from "../scripts/release-contract.mjs";

type UpdateRecord = Record<string, any>;

test("runtime updater stages only a signed artifact with its exact checksum", async () => {
  const fixture = await updateFixture();

  try {
    const check = await fixture.service.check();
    assert.equal(check.updateAvailable, true);
    assert.equal(check.latestVersion, "0.9.0");

    const result = await fixture.service.stageLatest("owner-1");
    assert.equal(result.staged, true);
    assert.equal(fixture.updates[0]?.status, "STAGED");

    const control = JSON.parse(await readFile(fixture.controlFile, "utf8"));
    assert.equal(control.fromVersion, "0.8.0");
    assert.equal(control.toVersion, "0.9.0");
    assert.equal(await readFile(control.artifactPath, "utf8"), fixture.artifact.toString("utf8"));
  } finally {
    await fixture.close();
  }
});

test("runtime updater records a failed stage when downloaded bytes are tampered", async () => {
  const fixture = await updateFixture({ tamperArtifact: true });

  try {
    await assert.rejects(
      fixture.service.stageLatest("owner-1"),
      (error) => error instanceof AppError && error.code === "release_artifact_invalid"
    );
    assert.equal(fixture.updates[0]?.status, "FAILED");
    assert.match(fixture.updates[0]?.error || "", /checksum/i);
  } finally {
    await fixture.close();
  }
});

test("runtime updater reports artifact network failures as an unavailable release", async () => {
  const fixture = await updateFixture({ failArtifactDownload: true });

  try {
    await assert.rejects(
      fixture.service.stageLatest("owner-1"),
      (error) => error instanceof AppError && error.code === "release_artifact_unavailable"
    );
    assert.equal(fixture.updates[0]?.status, "FAILED");
  } finally {
    await fixture.close();
  }
});

test("runtime updater recovers an abandoned stage with no supervisor request", async () => {
  const fixture = await updateFixture();
  fixture.updates.push({
    id: "update-abandoned-1",
    status: "STAGED",
    createdAt: new Date("2026-07-20T00:00:00.000Z"),
    updatedAt: new Date("2026-07-20T00:00:00.000Z")
  });

  try {
    const result = await fixture.service.stageLatest("owner-1");
    assert.equal(result.staged, true);
    assert.equal(fixture.updates[0]?.status, "FAILED");
    assert.equal(fixture.updates[1]?.status, "STAGED");
  } finally {
    await fixture.close();
  }
});

test("runtime updater keeps a recent stage active", async () => {
  const fixture = await updateFixture();
  fixture.updates.push({
    id: "update-active-0001",
    status: "STAGED",
    createdAt: new Date(),
    updatedAt: new Date()
  });

  try {
    await assert.rejects(
      fixture.service.stageLatest("owner-1"),
      (error) => error instanceof AppError && error.code === "runtime_update_active"
    );
    assert.equal(fixture.updates[0]?.status, "STAGED");
  } finally {
    await fixture.close();
  }
});

async function updateFixture(options: { failArtifactDownload?: boolean; tamperArtifact?: boolean } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "codey-runtime-update-"));
  const artifact = Buffer.from("verified-codey-cms-release");
  const servedArtifact = options.tamperArtifact ? Buffer.alloc(artifact.length, "x") : artifact;
  const baseUrl = "http://releases.codey.test";
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const payload = {
    schemaVersion: 1,
    product: "codey-cms",
    version: "0.9.0",
    channel: "stable",
    releasedAt: "2026-07-22T00:00:00.000Z",
    contracts: {
      websiteSpec: "1.0",
      builder: "1.0",
      exportedSiteAcceptance: "1.0"
    },
    artifact: {
      file: "codey-cms-0.9.0.tar.gz",
      url: `${baseUrl}/codey-cms-0.9.0.tar.gz`,
      sizeBytes: artifact.length,
      sha256: await import("node:crypto").then(({ createHash }) =>
        createHash("sha256").update(artifact).digest("hex"))
    }
  } as const;
  const { envelope } = createSignedRelease(payload, privateKey);
  const stableBody = JSON.stringify({
    schemaVersion: 1,
    channel: "stable",
    version: payload.version,
    releasedAt: payload.releasedAt,
    manifest: envelope
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === `${baseUrl}/stable.json`) {
      return new Response(stableBody, {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    if (url === `${baseUrl}/codey-cms-0.9.0.tar.gz`) {
      if (options.failArtifactDownload) throw new TypeError("network unavailable");
      return new Response(servedArtifact, {
        status: 200,
        headers: { "content-length": String(servedArtifact.length) }
      });
    }
    return new Response(null, { status: 404 });
  };

  const updates: UpdateRecord[] = [];
  const prisma = {
    runtimeInstallation: {
      findUnique: async () => ({ status: "COMPLETE", runtimeVersion: "0.8.0" })
    },
    runtimeUpdate: {
      findFirst: async () => updates.find((update) => ["STAGED", "APPLYING"].includes(update.status)) || null,
      create: async ({ data }: { data: UpdateRecord }) => {
        const update = { id: "update-test-0001", ...data };
        updates.push(update);
        return update;
      },
      update: async ({ where, data }: { where: { id: string }; data: UpdateRecord }) => {
        const update = updates.find((item) => item.id === where.id);
        Object.assign(update || {}, data);
        return update;
      },
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: UpdateRecord }) => {
        const update = updates.find((item) => item.id === where.id && item.status === where.status);
        if (!update) return { count: 0 };
        Object.assign(update, data);
        return { count: 1 };
      }
    }
  } as unknown as PrismaClient;
  const controlFile = path.join(directory, "control", "pending-update.json");
  const config = {
    isProduction: false,
    updates: {
      enabled: true,
      autoApply: false,
      feedUrl: `${baseUrl}/stable.json`,
      publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
      publicKeyFile: "unused",
      directory: path.join(directory, "updates"),
      controlFile,
      checkIntervalHours: 24
    }
  } as unknown as AppConfig;
  const logger = {
    info() {},
    warn() {},
    error() {}
  } as unknown as AppLogger;

  return {
    artifact,
    controlFile,
    updates,
    service: new RuntimeUpdateService(prisma, config, logger),
    close: async () => {
      globalThis.fetch = originalFetch;
      await rm(directory, { recursive: true, force: true });
    }
  };
}
