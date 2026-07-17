import "dotenv/config";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { encryptBackupFile } from "./backup-crypto.mjs";
import { postgresCliConnection } from "./postgres-cli-url.mjs";

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function positiveNumber(value, fallback, name) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number.`);
  return parsed;
}

function enabled(name) {
  return ["1", "true", "yes", "on"].includes(String(process.env[name] || "").toLowerCase());
}

function databaseCommandEnvironment(password) {
  const environment = { ...process.env };
  delete environment.DATABASE_URL;
  if (password) environment.PGPASSWORD = password;
  return environment;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.env ?? process.env,
      stdio: options.quiet ? ["ignore", "ignore", "inherit"] : "inherit"
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}.`));
    });
  });
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function fileDetails(filePath) {
  const fileStats = await stat(filePath);
  return {
    file: path.basename(filePath),
    sizeBytes: fileStats.size,
    sha256: await sha256File(filePath)
  };
}

async function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, filePath);
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function protectFile(filePath, encryptionKey) {
  if (!encryptionKey) return filePath;

  const encryptedPath = `${filePath}.enc`;
  await encryptBackupFile(filePath, encryptedPath, encryptionKey);
  await unlink(filePath);
  return encryptedPath;
}

async function cleanupRetention(directory, retentionDays) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !/^runtime-\d{4}-\d{2}-\d{2}T/.test(entry.name)) continue;
    const filePath = path.join(directory, entry.name);
    const fileStats = await stat(filePath);
    if (fileStats.mtimeMs < cutoff) await unlink(filePath);
  }
}

async function mirrorArtifacts(directory, artifactPaths, latest) {
  await mkdir(directory, { recursive: true });
  for (const artifactPath of artifactPaths) {
    await copyFile(artifactPath, path.join(directory, path.basename(artifactPath)));
  }
  await writeJsonAtomic(path.join(directory, "latest.json"), latest);
}

async function sendFailureAlert(error, status) {
  const url = process.env.BACKUP_ALERT_WEBHOOK_URL?.trim();
  if (!url) return;

  try {
    const response = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(5_000),
      headers: {
        "content-type": "application/json",
        ...(process.env.BACKUP_ALERT_WEBHOOK_TOKEN
          ? { authorization: `Bearer ${process.env.BACKUP_ALERT_WEBHOOK_TOKEN}` }
          : {})
      },
      body: JSON.stringify({
        event: "codey.backup.failed",
        app: process.env.APP_NAME || "CodeY CMS",
        error: error instanceof Error ? error.message : String(error),
        status
      })
    });
    if (!response.ok) console.error(`Backup alert webhook returned ${response.status}.`);
  } catch (alertError) {
    console.error(`Backup alert failed: ${alertError instanceof Error ? alertError.message : alertError}`);
  }
}

const backupDir = path.resolve(process.env.BACKUP_DIR ?? "backups");
const mirrorDir = process.env.BACKUP_MIRROR_DIR
  ? path.resolve(process.env.BACKUP_MIRROR_DIR)
  : undefined;
const incompleteArtifacts = [];
let completedLocalStatus;

try {
  const databaseConnection = postgresCliConnection(requireEnv("DATABASE_URL"));
  delete process.env.DATABASE_URL;
  const databaseEnvironment = databaseCommandEnvironment(databaseConnection.password);
  const retentionDays = positiveNumber(process.env.BACKUP_RETENTION_DAYS, 30, "BACKUP_RETENTION_DAYS");
  const encryptionKey = process.env.BACKUP_ENCRYPTION_KEY?.trim();
  const storageDriver = process.env.STORAGE_DRIVER || "local";
  const backupRequired = enabled("BACKUP_REQUIRED");

  if (enabled("BACKUP_REQUIRE_ENCRYPTION") && !encryptionKey) {
    throw new Error("BACKUP_ENCRYPTION_KEY is required when BACKUP_REQUIRE_ENCRYPTION=true.");
  }
  if (storageDriver === "s3" && backupRequired && !enabled("BACKUP_S3_MEDIA_PROTECTED")) {
    throw new Error("S3 media protection must be confirmed with BACKUP_S3_MEDIA_PROTECTED=true.");
  }
  if (mirrorDir && mirrorDir === backupDir) {
    throw new Error("BACKUP_MIRROR_DIR must be different from BACKUP_DIR.");
  }

  const startedAt = new Date();
  const backupId = startedAt.toISOString().replace(/[:.]/g, "-");
  const baseName = `runtime-${backupId}`;
  const plainDatabaseFile = path.join(backupDir, `${baseName}.dump`);
  incompleteArtifacts.push(plainDatabaseFile);

  await mkdir(backupDir, { recursive: true });
  await run("pg_dump", [
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    "--file",
    plainDatabaseFile,
    databaseConnection.url
  ], { env: databaseEnvironment });
  await run("pg_restore", ["--list", plainDatabaseFile], { quiet: true, env: databaseEnvironment });

  let databaseFile = await protectFile(plainDatabaseFile, encryptionKey);
  incompleteArtifacts.push(databaseFile);
  let mediaFile;
  let media;

  if (storageDriver === "local") {
    const mediaDir = path.resolve(process.env.STORAGE_LOCAL_DIR ?? "storage/uploads");
    const plainMediaFile = path.join(backupDir, `${baseName}-media.tar.gz`);
    try {
      await access(mediaDir);
      incompleteArtifacts.push(plainMediaFile);
      await run("tar", ["-czf", plainMediaFile, "-C", mediaDir, "."]);
      mediaFile = await protectFile(plainMediaFile, encryptionKey);
      incompleteArtifacts.push(mediaFile);
      media = {
        driver: "local",
        snapshotIncluded: true,
        ...(await fileDetails(mediaFile))
      };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        media = { driver: "local", snapshotIncluded: false, reason: "Media directory does not exist." };
      } else {
        throw error;
      }
    }
  } else if (storageDriver === "s3") {
    media = {
      driver: "s3",
      snapshotIncluded: false,
      bucket: process.env.STORAGE_S3_BUCKET || null,
      keyPrefix: process.env.STORAGE_KEY_PREFIX || null,
      externallyProtected: enabled("BACKUP_S3_MEDIA_PROTECTED"),
      requirement: "Enable bucket versioning or replication and test media recovery separately."
    };
  } else {
    media = { driver: storageDriver, snapshotIncluded: false };
  }

  const completedAt = new Date();
  const manifest = {
    schemaVersion: 1,
    backupId,
    app: process.env.APP_NAME || "CodeY CMS",
    mode: process.env.APP_MODE || "cms",
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    encrypted: Boolean(encryptionKey),
    database: {
      format: "postgres-custom",
      verified: true,
      ...(await fileDetails(databaseFile))
    },
    media
  };
  const manifestFile = path.join(backupDir, `${baseName}.manifest.json`);
  await writeJsonAtomic(manifestFile, manifest);
  incompleteArtifacts.push(manifestFile);

  const latest = {
    schemaVersion: 1,
    status: "success",
    backupId,
    completedAt: completedAt.toISOString(),
    manifestFile: path.basename(manifestFile),
    encrypted: Boolean(encryptionKey),
    mirrored: Boolean(mirrorDir)
  };
  const artifacts = [databaseFile, ...(mediaFile ? [mediaFile] : []), manifestFile];

  completedLocalStatus = latest;
  if (mirrorDir) await mirrorArtifacts(mirrorDir, artifacts, latest);
  await writeJsonAtomic(path.join(backupDir, "latest.json"), latest);
  await cleanupRetention(backupDir, retentionDays);
  if (mirrorDir) await cleanupRetention(mirrorDir, retentionDays);

  incompleteArtifacts.length = 0;
  console.log(`Backup completed: ${manifestFile}`);
  if (mirrorDir) console.log(`Backup mirrored to: ${mirrorDir}`);
} catch (error) {
  await mkdir(backupDir, { recursive: true }).catch(() => undefined);
  const latestPath = path.join(backupDir, "latest.json");
  const previous = await readJson(latestPath);
  const status = {
    schemaVersion: 1,
    status: "failed",
    failedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
    lastSuccessAt:
      completedLocalStatus?.completedAt ??
      (previous?.status === "success" ? previous.completedAt : previous?.lastSuccessAt),
    ...(completedLocalStatus ? { localBackupCompleted: true } : {})
  };

  if (!completedLocalStatus) {
    await Promise.all(incompleteArtifacts.map((filePath) => unlink(filePath).catch(() => undefined)));
  }
  await writeJsonAtomic(latestPath, status).catch(() => undefined);
  await sendFailureAlert(error, status);
  console.error(status.error);
  process.exitCode = 1;
}
