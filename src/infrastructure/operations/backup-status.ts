import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

type BackupStatusConfig = {
  dir: string;
  maxAgeHours: number;
  required: boolean;
  encrypted: boolean;
  requireEncryption: boolean;
  s3MediaProtected: boolean;
  storageDriver: "disabled" | "local" | "s3";
};

export type BackupHealth = {
  status: "fail" | "pass" | "skipped";
  blocking: boolean;
  message?: string;
  details?: Record<string, unknown>;
};

type VerifiedChecksum = {
  sizeBytes: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
  sha256: string;
};

const verifiedChecksums = new Map<string, VerifiedChecksum>();

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeArtifactName(value: unknown) {
  if (
    typeof value !== "string" ||
    !value ||
    value === "." ||
    value === ".." ||
    value.includes("\\") ||
    basename(value) !== value
  ) {
    throw new Error("Invalid backup artifact name");
  }

  return value;
}

function validSha256(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error("Invalid backup artifact checksum");
  }

  return value.toLowerCase();
}

async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function verifyArtifact(directory: string, value: unknown) {
  const artifact = asRecord(value);
  if (
    !artifact ||
    typeof artifact.sizeBytes !== "number" ||
    !Number.isSafeInteger(artifact.sizeBytes) ||
    artifact.sizeBytes < 0
  ) {
    throw new Error("Invalid backup artifact metadata");
  }

  const file = safeArtifactName(artifact.file);
  const filePath = resolve(directory, file);
  const fileStats = await stat(filePath, { bigint: true });
  if (!fileStats.isFile() || fileStats.size !== BigInt(artifact.sizeBytes)) {
    throw new Error("Backup artifact size mismatch");
  }

  const expectedSha256 = validSha256(artifact.sha256);
  const cached = verifiedChecksums.get(filePath);
  if (
    !cached ||
    cached.sizeBytes !== fileStats.size ||
    cached.mtimeNs !== fileStats.mtimeNs ||
    cached.ctimeNs !== fileStats.ctimeNs ||
    cached.sha256 !== expectedSha256
  ) {
    const actualSha256 = await sha256File(filePath);
    if (actualSha256 !== expectedSha256) {
      throw new Error("Backup artifact checksum mismatch");
    }

    verifiedChecksums.set(filePath, {
      sizeBytes: fileStats.size,
      mtimeNs: fileStats.mtimeNs,
      ctimeNs: fileStats.ctimeNs,
      sha256: actualSha256
    });
  }

  return { file, sizeBytes: artifact.sizeBytes };
}

async function verifyRecordedArtifacts(directory: string, latest: Record<string, unknown>) {
  const manifestFile = safeArtifactName(latest.manifestFile);
  const manifestStats = await stat(resolve(directory, manifestFile));
  if (!manifestStats.isFile()) throw new Error("Backup manifest is not a file");

  const manifest = asRecord(JSON.parse(await readFile(resolve(directory, manifestFile), "utf8")));
  if (!manifest || manifest.schemaVersion !== 1) throw new Error("Invalid backup manifest");
  if (latest.backupId && manifest.backupId !== latest.backupId) throw new Error("Backup ID mismatch");
  if (manifest.completedAt !== latest.completedAt) throw new Error("Backup completion mismatch");

  const database = await verifyArtifact(directory, manifest.database);
  const media = asRecord(manifest.media);
  const mediaSnapshot = media?.snapshotIncluded === true
    ? await verifyArtifact(directory, media)
    : null;

  return {
    manifestFile,
    databaseFile: database.file,
    databaseSizeBytes: database.sizeBytes,
    mediaSnapshotIncluded: Boolean(mediaSnapshot)
  };
}

export async function readBackupHealth(config: BackupStatusConfig, now = new Date()): Promise<BackupHealth> {
  const blocking = config.required || config.requireEncryption;

  if (config.requireEncryption && !config.encrypted) {
    return {
      status: "fail",
      blocking,
      message: "Backup encryption is required but no encryption key is configured."
    };
  }
  if (config.required && config.storageDriver === "s3" && !config.s3MediaProtected) {
    return {
      status: "fail",
      blocking,
      message: "S3 media protection has not been confirmed."
    };
  }

  let latest: Record<string, unknown>;

  try {
    const value = JSON.parse(await readFile(resolve(config.dir, "latest.json"), "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid backup status");
    latest = value as Record<string, unknown>;
  } catch (error) {
    const missing = Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
    return {
      status: config.required ? "fail" : "skipped",
      blocking,
      message: missing ? "No completed backup has been recorded." : "Backup status file is invalid."
    };
  }

  if (latest.status !== "success") {
    return {
      status: "fail",
      blocking,
      message: "The most recent backup attempt failed.",
      details: {
        failedAt: typeof latest.failedAt === "string" ? latest.failedAt : undefined,
        lastSuccessAt: typeof latest.lastSuccessAt === "string" ? latest.lastSuccessAt : undefined,
        error: typeof latest.error === "string" ? latest.error : undefined
      }
    };
  }

  const completedAt = typeof latest.completedAt === "string" ? new Date(latest.completedAt) : null;
  if (!completedAt || Number.isNaN(completedAt.getTime())) {
    return {
      status: "fail",
      blocking,
      message: "Latest backup completion time is invalid."
    };
  }

  const ageHours = Math.max(0, (now.getTime() - completedAt.getTime()) / (60 * 60 * 1000));
  const encrypted = latest.encrypted === true;
  if (config.requireEncryption && !encrypted) {
    return {
      status: "fail",
      blocking,
      message: "Latest backup is not encrypted.",
      details: { completedAt: completedAt.toISOString(), ageHours }
    };
  }
  if (ageHours > config.maxAgeHours) {
    return {
      status: "fail",
      blocking,
      message: "Latest backup is stale.",
      details: {
        completedAt: completedAt.toISOString(),
        ageHours,
        maxAgeHours: config.maxAgeHours
      }
    };
  }

  let artifacts: Awaited<ReturnType<typeof verifyRecordedArtifacts>>;
  try {
    artifacts = await verifyRecordedArtifacts(config.dir, latest);
  } catch {
    return {
      status: "fail",
      blocking,
      message: "Latest backup artifacts are missing or invalid.",
      details: { completedAt: completedAt.toISOString(), ageHours }
    };
  }

  return {
    status: "pass",
    blocking: false,
    details: {
      backupId: typeof latest.backupId === "string" ? latest.backupId : undefined,
      completedAt: completedAt.toISOString(),
      ageHours,
      encrypted,
      mirrored: latest.mirrored === true,
      s3MediaProtected: config.s3MediaProtected,
      ...artifacts
    }
  };
}
