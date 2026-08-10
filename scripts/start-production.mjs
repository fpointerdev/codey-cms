import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL;
let databaseMayHaveChanged = false;

try {
  run(process.execPath, ["scripts/build-prisma-schema.mjs"]);
  databaseMayHaveChanged = true;
  run(process.execPath, [
    "node_modules/prisma/build/index.js",
    "migrate",
    "deploy",
    "--schema",
    "prisma/generated/schema.prisma"
  ], {
    ...process.env,
    DATABASE_URL: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL
  });

  if (process.env.CODEY_MANAGE_RUNTIME_DB_ROLE === "true") {
    run(process.execPath, ["scripts/configure-runtime-database-role.mjs"]);
  }
  delete process.env.MIGRATION_DATABASE_URL;

  const exportSpecPath = path.resolve(
    root,
    process.env.CODEY_EXPORT_WEBSITE_SPEC_PATH || "codey/export/website-spec.json"
  );
  const exportApplyScript = path.join(root, "scripts", "apply-export-website-spec.mjs");

  if (
    process.env.CODEY_EXPORT_APPLY_ON_START !== "false" &&
    existsSync(exportSpecPath) &&
    existsSync(exportApplyScript)
  ) {
    run(process.execPath, [exportApplyScript]);
  }

  const serverEntry = path.join(root, "dist", "src", "server.js");

  if (!existsSync(serverEntry)) {
    throw new Error(`Compiled server entry was not found at ${path.relative(root, serverEntry)}.`);
  }

  await startServer(serverEntry);
} catch (error) {
  if (!databaseMayHaveChanged || !await recoverApplyingUpdate(error)) throw error;
  throw new Error("The updated runtime failed before readiness; its pre-update database backup was restored.", {
    cause: error
  });
}

function run(command, args, environment = process.env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: environment,
    stdio: "inherit"
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${[command, ...args].join(" ")} exited with code ${result.status}.`);
  }
}

async function startServer(serverEntry) {
  const child = spawn(process.execPath, [serverEntry], {
    cwd: root,
    env: process.env,
    stdio: "inherit"
  });
  const exit = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const forwardSigint = () => child.kill("SIGINT");
  const forwardSigterm = () => child.kill("SIGTERM");
  process.on("SIGINT", forwardSigint);
  process.on("SIGTERM", forwardSigterm);

  try {
    await Promise.race([
      waitForReadiness(),
      exit.then(({ code, signal }) => {
        throw new Error(`API server exited before readiness (${signal || code}).`);
      })
    ]);
    const { code, signal } = await exit;
    process.exitCode = signal ? 1 : code ?? 1;
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await Promise.race([exit, wait(10_000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exit;
    throw error;
  } finally {
    process.off("SIGINT", forwardSigint);
    process.off("SIGTERM", forwardSigterm);
  }
}

async function waitForReadiness() {
  const port = process.env.PORT || "4000";
  const apiPrefix = `/${String(process.env.API_PREFIX || "/api/v1").replace(/^\/+|\/+$/g, "")}`;
  const deadline = Date.now() + 60_000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${apiPrefix}/health/ready`, {
        signal: AbortSignal.timeout(5_000)
      });
      if (response.ok) return;
      lastError = new Error(`Readiness returned ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await wait(1_000);
  }

  throw lastError || new Error("API server did not become ready.");
}

async function recoverApplyingUpdate(startupError) {
  const runtimeRoot = path.resolve(process.env.CODEY_RUNTIME_ROOT || "/runtime");
  const controlFile = path.resolve(
    process.env.CODEY_UPDATE_CONTROL_FILE || path.join(runtimeRoot, "control", "pending-update.json")
  );
  const statusFile = path.join(path.dirname(controlFile), "update-status.json");
  const backupRoot = path.resolve(process.env.BACKUP_DIR || "/app/backups");
  const [request, status, packageJson, currentTarget] = await Promise.all([
    readJson(controlFile),
    readJson(statusFile),
    readJson(path.join(root, "package.json")),
    readlink(path.join(runtimeRoot, "current")).catch(() => "")
  ]);
  const activeRoot = path.resolve(runtimeRoot, currentTarget);

  if (
    request?.schemaVersion !== 1 ||
    !/^[A-Za-z0-9_-]{10,64}$/.test(request.updateId || "") ||
    request.toVersion !== packageJson?.version ||
    status?.status !== "applying" ||
    status.updateId !== request.updateId ||
    activeRoot !== root
  ) {
    return false;
  }

  const update = await readRuntimeUpdate(request.updateId);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(update?.backupId || "")) {
    return false;
  }
  const manifestPath = path.join(backupRoot, `runtime-${update.backupId}.manifest.json`);
  const manifest = await readJson(manifestPath);
  if (manifest?.backupId !== update.backupId) return false;

  console.error(
    `Updated runtime ${packageJson.version} failed before readiness; restoring backup ${update.backupId}.`,
    startupError
  );
  run(process.execPath, ["scripts/restore-runtime.mjs", manifestPath], {
    ...process.env,
    ...(migrationDatabaseUrl ? { MIGRATION_DATABASE_URL: migrationDatabaseUrl } : {}),
    ALLOW_PRODUCTION_RESTORE: "true",
    RESTORE_MEDIA: "false",
    RESTORE_RECREATE_SCHEMA: "true"
  });
  return true;
}

async function readRuntimeUpdate(updateId) {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    return await prisma.runtimeUpdate.findUnique({
      where: { id: updateId },
      select: { backupId: true }
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
