import "dotenv/config";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { decryptBackupFile, isEncryptedBackupFile } from "./backup-crypto.mjs";
import { postgresCliConnection } from "./postgres-cli-url.mjs";
import {
  assertSafeMediaTree,
  assertSafeTarEntries,
  assertSafeTarEntryTypes,
  backupArtifactPath,
  verifyBackupArtifact
} from "./restore-safety.mjs";

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
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

function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 5_000_000) child.kill("SIGTERM");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited with code ${code}: ${stderr.slice(0, 1000)}`));
    });
  });
}

function commandSucceeds(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

async function prepareEncryptedArtifact(filePath, temporaryDirectory) {
  if (!await isEncryptedBackupFile(filePath)) return filePath;

  const encryptionKey = requireEnv("BACKUP_ENCRYPTION_KEY");
  const outputFile = path.join(temporaryDirectory, path.basename(filePath).replace(/\.enc$/i, ""));
  await decryptBackupFile(filePath, outputFile, encryptionKey);
  return outputFile;
}

async function directoryHasFiles(directory) {
  try {
    return (await readdir(directory)).length > 0;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function installRestoredMedia(mediaDirectory, stagingDirectory) {
  const rollbackDirectory = await mkdtemp(path.join(mediaDirectory, ".codey-rollback-"));
  const ignoredNames = new Set([path.basename(stagingDirectory), path.basename(rollbackDirectory)]);
  const currentEntries = (await readdir(mediaDirectory)).filter((name) => !ignoredNames.has(name));
  const stagedEntries = await readdir(stagingDirectory);
  const movedCurrentEntries = [];
  const installedEntries = [];

  try {
    for (const name of currentEntries) {
      await rename(path.join(mediaDirectory, name), path.join(rollbackDirectory, name));
      movedCurrentEntries.push(name);
    }
    for (const name of stagedEntries) {
      await rename(path.join(stagingDirectory, name), path.join(mediaDirectory, name));
      installedEntries.push(name);
    }
  } catch (error) {
    await Promise.all(installedEntries.map((name) =>
      rm(path.join(mediaDirectory, name), { recursive: true, force: true })
    ));

    const recoveryErrors = [];
    for (const name of movedCurrentEntries) {
      try {
        await rename(path.join(rollbackDirectory, name), path.join(mediaDirectory, name));
      } catch (recoveryError) {
        recoveryErrors.push(recoveryError);
      }
    }
    if (recoveryErrors.length > 0) {
      throw new Error(`Media restore failed and previous files remain in ${rollbackDirectory}.`, { cause: error });
    }
    await rm(rollbackDirectory, { recursive: true, force: true });
    throw error;
  }

  await rm(stagingDirectory, { recursive: true, force: true });
  await rm(rollbackDirectory, { recursive: true, force: true });
}

const databaseConnection = postgresCliConnection(
  process.env.MIGRATION_DATABASE_URL || requireEnv("DATABASE_URL")
);
delete process.env.MIGRATION_DATABASE_URL;
delete process.env.DATABASE_URL;
const databaseEnvironment = databaseCommandEnvironment(databaseConnection.password);
const inputArgument = process.argv[2] ?? process.env.BACKUP_FILE;

if (!inputArgument) {
  throw new Error("Pass a backup manifest or database archive path, or set BACKUP_FILE.");
}
if (process.env.NODE_ENV === "production" && !enabled("ALLOW_PRODUCTION_RESTORE")) {
  throw new Error("Set ALLOW_PRODUCTION_RESTORE=true to restore into production.");
}

const inputFile = path.resolve(inputArgument);
await access(inputFile);
const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "codey-restore-"));
let mediaStagingDirectory;

try {
  let manifest;
  let databaseFile = inputFile;
  let databaseFormat;
  let mediaFile;

  if (inputFile.endsWith(".json")) {
    manifest = JSON.parse(await readFile(inputFile, "utf8"));
    if (manifest.schemaVersion !== 1 || !manifest.database?.file) {
      throw new Error("Backup manifest format is not supported.");
    }

    const manifestDirectory = path.dirname(inputFile);
    databaseFile = backupArtifactPath(manifestDirectory, manifest.database.file);
    databaseFormat = manifest.database.format;
    await verifyBackupArtifact(databaseFile, manifest.database);

    if (manifest.media?.snapshotIncluded && manifest.media.file) {
      mediaFile = backupArtifactPath(manifestDirectory, manifest.media.file);
      await verifyBackupArtifact(mediaFile, manifest.media);
    }
  }

  const preparedDatabaseFile = await prepareEncryptedArtifact(databaseFile, temporaryDirectory);
  if (!databaseFormat) {
    databaseFormat = await commandSucceeds("pg_restore", ["--list", preparedDatabaseFile])
      ? "postgres-custom"
      : "postgres-sql";
  }
  if (!["postgres-custom", "postgres-sql"].includes(databaseFormat)) {
    throw new Error(`Backup database format is not supported: ${databaseFormat}.`);
  }
  if (databaseFormat === "postgres-custom") {
    await run("pg_restore", ["--list", preparedDatabaseFile], { quiet: true });
  }

  if (mediaFile && enabled("RESTORE_MEDIA")) {
    const preparedMediaFile = await prepareEncryptedArtifact(mediaFile, temporaryDirectory);
    assertSafeTarEntries(await capture("tar", ["-tzf", preparedMediaFile]));
    assertSafeTarEntryTypes(await capture("tar", ["-tzvf", preparedMediaFile]));

    const mediaDirectory = path.resolve(process.env.STORAGE_LOCAL_DIR ?? "storage/uploads");
    const replaceMedia = enabled("RESTORE_REPLACE_MEDIA");
    if (!replaceMedia && await directoryHasFiles(mediaDirectory)) {
      throw new Error("Media directory is not empty. Set RESTORE_REPLACE_MEDIA=true to replace it.");
    }

    await mkdir(mediaDirectory, { recursive: true });
    mediaStagingDirectory = await mkdtemp(path.join(mediaDirectory, ".codey-restore-"));
    await run("tar", ["-xzf", preparedMediaFile, "-C", mediaStagingDirectory]);
    await assertSafeMediaTree(mediaStagingDirectory);
  }

  if (databaseFormat === "postgres-custom") {
    await run("pg_restore", [
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      "--exit-on-error",
      "--dbname",
      databaseConnection.url,
      preparedDatabaseFile
    ], { env: databaseEnvironment });
  } else {
    await run("psql", [
      "--set",
      "ON_ERROR_STOP=1",
      "--dbname",
      databaseConnection.url,
      "--file",
      preparedDatabaseFile
    ], { env: databaseEnvironment });
  }

  if (mediaStagingDirectory) {
    const mediaDirectory = path.resolve(process.env.STORAGE_LOCAL_DIR ?? "storage/uploads");
    await installRestoredMedia(mediaDirectory, mediaStagingDirectory);
    mediaStagingDirectory = undefined;
  } else if (manifest?.media?.driver === "s3") {
    console.log("Database restored. Restore S3 media through the bucket versioning or replication workflow in the manifest.");
  }

  console.log(`Restore completed from: ${inputFile}`);
} finally {
  if (mediaStagingDirectory) await rm(mediaStagingDirectory, { recursive: true, force: true }).catch(() => undefined);
  await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
}
