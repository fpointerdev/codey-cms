import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  decryptBackupFile,
  encryptBackupFile,
  isEncryptedBackupFile
} from "../scripts/backup-crypto.mjs";
import { postgresCliConnection, postgresCliUrl } from "../scripts/postgres-cli-url.mjs";
import {
  assertSafeMediaTree,
  assertSafeTarEntries,
  assertSafeTarEntryTypes,
  backupArtifactPath,
  verifyBackupArtifact
} from "../scripts/restore-safety.mjs";
import { readBackupHealth } from "../src/infrastructure/operations/backup-status.js";

const encryptionKey = "test-backup-encryption-key-with-32-characters";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

test("PostgreSQL CLI URLs remove Prisma-only parameters", () => {
  const normalized = new URL(postgresCliUrl(
    "postgresql://codey:secret@db:5432/codey?schema=public&connection_limit=10&sslmode=require"
  ));

  assert.equal(normalized.searchParams.get("schema"), null);
  assert.equal(normalized.searchParams.get("connection_limit"), null);
  assert.equal(normalized.searchParams.get("sslmode"), "require");
  assert.throws(() => postgresCliUrl("mysql://db/codey"), /PostgreSQL protocol/i);

  const connection = postgresCliConnection(
    "postgresql://codey:p%40ssword@db:5432/codey?schema=public"
  );
  assert.equal(connection.url, "postgresql://codey@db:5432/codey");
  assert.equal(connection.password, "p@ssword");
});

function backupConfig(directory: string, overrides: Record<string, unknown> = {}) {
  return {
    dir: directory,
    maxAgeHours: 30,
    required: true,
    encrypted: true,
    requireEncryption: true,
    s3MediaProtected: false,
    storageDriver: "local" as const,
    ...overrides
  };
}

test("backup encryption round-trips and rejects tampered archives", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "codey-backup-crypto-"));
  const source = path.join(directory, "source.dump");
  const encrypted = path.join(directory, "source.dump.enc");
  const restored = path.join(directory, "restored.dump");
  const tamperedOutput = path.join(directory, "tampered.dump");

  try {
    const content = Buffer.from("verified database backup content");
    await writeFile(source, content);
    await encryptBackupFile(source, encrypted, encryptionKey);

    assert.equal(await isEncryptedBackupFile(encrypted), true);
    await decryptBackupFile(encrypted, restored, encryptionKey);
    assert.deepEqual(await readFile(restored), content);

    const tampered = await readFile(encrypted);
    tampered[Math.floor(tampered.length / 2)] ^= 0xff;
    await writeFile(encrypted, tampered);

    await assert.rejects(
      decryptBackupFile(encrypted, tamperedOutput, encryptionKey),
      /could not be authenticated/i
    );
    await assert.rejects(readFile(tamperedOutput), /ENOENT/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("restore verification requires safe paths, sizes, and checksums", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "codey-restore-safety-"));
  const artifact = path.join(directory, "runtime.dump");
  const content = "verified runtime backup";

  try {
    await writeFile(artifact, content);
    await verifyBackupArtifact(artifact, {
      sizeBytes: Buffer.byteLength(content),
      sha256: sha256(content)
    });

    await assert.rejects(
      verifyBackupArtifact(artifact, { sizeBytes: Buffer.byteLength(content) }),
      /checksum/i
    );
    await writeFile(artifact, "x".repeat(Buffer.byteLength(content)));
    await assert.rejects(
      verifyBackupArtifact(artifact, {
        sizeBytes: Buffer.byteLength(content),
        sha256: sha256(content)
      }),
      /checksum/i
    );
    assert.throws(() => backupArtifactPath(directory, ".."), /invalid artifact path/i);
    assert.throws(() => assertSafeTarEntries("../outside\n"), /unsafe path/i);
    assert.throws(
      () => assertSafeTarEntryTypes("lrwxr-xr-x user/group 0 2026-07-17 linked.txt -> ../outside.txt\n"),
      /link or unsupported/i
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("restored media rejects symbolic links", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "codey-restore-media-"));
  const mediaDirectory = path.join(directory, "media");

  try {
    await mkdir(mediaDirectory);
    await writeFile(path.join(directory, "outside.txt"), "outside");
    await symlink(path.join(directory, "outside.txt"), path.join(mediaDirectory, "linked.txt"));

    await assert.rejects(assertSafeMediaTree(mediaDirectory), /symbolic link/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("backup readiness requires a recent successful encrypted backup", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "codey-backup-health-"));
  const now = new Date("2026-07-16T12:00:00.000Z");
  const databaseFile = "runtime-backup-1.dump.enc";
  const manifestFile = "runtime-backup-1.manifest.json";
  const databaseBody = "encrypted backup";

  try {
    assert.deepEqual(
      await readBackupHealth(backupConfig(directory), now),
      {
        status: "fail",
        blocking: true,
        message: "No completed backup has been recorded."
      }
    );

    await writeFile(path.join(directory, databaseFile), databaseBody);
    await writeFile(path.join(directory, manifestFile), JSON.stringify({
      schemaVersion: 1,
      backupId: "backup-1",
      completedAt: "2026-07-16T00:00:00.000Z",
      database: {
        file: databaseFile,
        sizeBytes: Buffer.byteLength(databaseBody),
        sha256: sha256(databaseBody)
      },
      media: {
        driver: "local",
        snapshotIncluded: false
      }
    }));

    await writeFile(path.join(directory, "latest.json"), JSON.stringify({
      schemaVersion: 1,
      status: "success",
      backupId: "backup-1",
      completedAt: "2026-07-16T00:00:00.000Z",
      manifestFile,
      encrypted: true,
      mirrored: true
    }));
    const healthy = await readBackupHealth(backupConfig(directory), now);

    assert.equal(healthy.status, "pass");
    assert.equal(healthy.blocking, false);
    assert.equal(healthy.details?.backupId, "backup-1");
    assert.equal(healthy.details?.databaseFile, databaseFile);

    await writeFile(path.join(directory, databaseFile), "x".repeat(Buffer.byteLength(databaseBody)));
    const corruptedArtifact = await readBackupHealth(backupConfig(directory), now);
    assert.equal(corruptedArtifact.status, "fail");
    assert.equal(corruptedArtifact.blocking, true);
    assert.match(corruptedArtifact.message ?? "", /artifacts/i);

    await writeFile(path.join(directory, databaseFile), databaseBody);
    await rm(path.join(directory, databaseFile));
    const missingArtifact = await readBackupHealth(backupConfig(directory), now);
    assert.equal(missingArtifact.status, "fail");
    assert.equal(missingArtifact.blocking, true);
    assert.match(missingArtifact.message ?? "", /artifacts/i);

    const stale = await readBackupHealth(backupConfig(directory, { maxAgeHours: 6 }), now);
    assert.equal(stale.status, "fail");
    assert.equal(stale.blocking, true);
    assert.match(stale.message ?? "", /stale/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("optional backup failures are reported without blocking readiness", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "codey-backup-optional-"));

  try {
    await writeFile(path.join(directory, "latest.json"), JSON.stringify({
      schemaVersion: 1,
      status: "failed",
      failedAt: "2026-07-16T11:00:00.000Z",
      lastSuccessAt: "2026-07-15T11:00:00.000Z",
      error: "mirror unavailable"
    }));
    const health = await readBackupHealth(backupConfig(directory, {
      required: false,
      requireEncryption: false,
      encrypted: false
    }));

    assert.equal(health.status, "fail");
    assert.equal(health.blocking, false);
    assert.equal(health.details?.error, "mirror unavailable");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
