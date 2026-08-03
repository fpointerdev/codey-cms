import { spawn } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { executeRuntimeUpdate } from "./runtime-update-orchestrator.mjs";

const imageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = path.resolve(process.env.CODEY_RUNTIME_ROOT || "/runtime");
const releasesRoot = path.join(runtimeRoot, "releases");
const currentLink = path.join(runtimeRoot, "current");
const controlFile = path.resolve(
  process.env.CODEY_UPDATE_CONTROL_FILE || path.join(runtimeRoot, "control", "pending-update.json")
);
const statusFile = path.join(path.dirname(controlFile), "update-status.json");
const updatesRoot = path.resolve(process.env.CODEY_UPDATE_DIR || path.join(runtimeRoot, "updates"));
const backupRoot = path.resolve(process.env.BACKUP_DIR || "/app/backups");
const port = process.env.PORT || "4000";
const readinessUrl = `http://127.0.0.1:${port}/api/v1/health/ready`;

let runtimeProcess;
let runtimeExitPromise;
let stopping = false;
let updating = false;
let updatePoll;

await mkdir(releasesRoot, { recursive: true });
await mkdir(path.dirname(controlFile), { recursive: true });
await ensureInitialRelease();
await startRuntime();

updatePoll = setInterval(() => void processPendingUpdate(), 5_000);
updatePoll.unref();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => void shutdown(signal));
}

async function ensureInitialRelease() {
  try {
    await lstat(currentLink);
    return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const packageJson = JSON.parse(await readFile(path.join(imageRoot, "package.json"), "utf8"));
  const target = releaseDirectory(packageJson.version);
  await cp(imageRoot, target, {
    recursive: true,
    force: false,
    filter: (source) => {
      const relative = path.relative(imageRoot, source);
      const topLevel = relative.split(path.sep)[0];
      return !["backups", "backups-mirror", "storage", "updates"].includes(topLevel);
    }
  });
  await switchCurrent(target);
}

async function startRuntime() {
  const current = await currentRelease();
  runtimeProcess = spawn(
    process.execPath,
    ["scripts/run-with-runtime-secrets.mjs", "--", process.execPath, "scripts/start-production.mjs"],
    {
      cwd: current,
      env: process.env,
      stdio: "inherit"
    }
  );
  runtimeExitPromise = new Promise((resolve) => {
    runtimeProcess.once("exit", (code, signal) => resolve({ code, signal }));
  });
  runtimeProcess.once("error", (error) => {
    console.error("CodeY CMS runtime failed to start.", error);
  });
  runtimeExitPromise.then(({ code, signal }) => {
    if (!stopping && !updating) {
      console.error(`CodeY CMS runtime exited unexpectedly (${signal || code}). Restarting.`);
      setTimeout(() => void startRuntime(), 2_000).unref();
    }
  });
}

async function stopRuntime() {
  if (!runtimeProcess || runtimeProcess.exitCode !== null || runtimeProcess.signalCode !== null) return;
  runtimeProcess.kill("SIGTERM");

  const exited = await Promise.race([
    runtimeExitPromise.then(() => true),
    wait(15_000).then(() => false)
  ]);
  if (!exited) {
    runtimeProcess.kill("SIGKILL");
    await runtimeExitPromise;
  }
}

async function processPendingUpdate() {
  if (updating || stopping) return;
  let request;
  try {
    request = await readJson(controlFile);
    if (!request) return;
    await validateUpdateRequest(request);
  } catch (error) {
    await rejectInvalidRequest(request, error);
    return;
  }

  updating = true;
  const previousRelease = await currentRelease();

  try {
    const result = await executeRuntimeUpdate({
      request,
      previousRelease,
      operations: {
        beforeApply: async () => {
          await assertCurrentVersion(previousRelease, request.fromVersion);
          await writeStatus("applying", request);
          await markUpdate(previousRelease, request.updateId, "APPLYING");
        },
        createBackup: async () => {
          await runWithSecrets(previousRelease, process.execPath, ["scripts/backup-runtime.mjs"]);
          const backup = await readJson(path.join(backupRoot, "latest.json"));
          const backupId = backup?.status === "success" ? backup.backupId : undefined;
          if (!backupId || !isSafeFileName(backup.manifestFile)) {
            throw new Error("The pre-update backup did not publish a successful backup manifest.");
          }
          return {
            backupId,
            manifestPath: path.join(backupRoot, backup.manifestFile)
          };
        },
        afterBackup: ({ backupId }) => markUpdate(
          previousRelease,
          request.updateId,
          "APPLYING",
          ["--backup-id", backupId]
        ),
        stopRuntime,
        prepareRelease,
        switchCurrent,
        startRuntime,
        waitForReadiness,
        restoreBackup: (manifestPath) => restoreBackup(previousRelease, manifestPath),
        onUpdateError: (message) => console.error(`CodeY CMS update failed: ${message}`),
        onRollbackError: (error) => console.error("Previous runtime recovery failed.", error)
      }
    });

    if (result.status === "SUCCEEDED") {
      await markUpdate(result.targetRelease, request.updateId, "SUCCEEDED", ["--backup-id", result.backupId]);
      await writeStatus("succeeded", request, { backupId: result.backupId })
        .catch((statusError) => console.error("Unable to write update supervisor status.", statusError));
      await archiveRequest(request, "succeeded")
        .catch((archiveError) => console.error("Unable to archive the completed update request.", archiveError));
      await cleanupOldReleases(result.targetRelease, previousRelease)
        .catch((cleanupError) => console.error("Unable to clean old runtime releases.", cleanupError));
    } else {
      await markUpdate(previousRelease, request.updateId, result.status, [
        ...(result.backupId ? ["--backup-id", result.backupId] : []),
        "--error",
        result.error.slice(0, 2000)
      ]).catch((statusError) => console.error("Unable to record update failure.", statusError));
      await writeStatus(result.status.toLowerCase(), request, {
        backupId: result.backupId,
        error: result.error
      });
      await archiveRequest(request, result.status.toLowerCase()).catch(() => undefined);
    }
  } finally {
    updating = false;
  }
}

async function prepareRelease(previousRelease, request) {
  const publicKeyPath = path.resolve(
    previousRelease,
    process.env.CODEY_RELEASE_PUBLIC_KEY_FILE || "runtime-meta/release-public-key.pem"
  );
  await run(previousRelease, process.execPath, [
    "scripts/verify-release.mjs",
    "--manifest",
    request.manifestPath,
    "--artifact",
    request.artifactPath,
    "--public-key",
    publicKeyPath
  ]);

  const releaseEnvelope = await readJson(request.manifestPath);
  if (
    releaseEnvelope?.payload?.version !== request.toVersion ||
    releaseEnvelope?.payload?.artifact?.file !== path.basename(request.artifactPath)
  ) {
    throw new Error("Signed release metadata does not match the staged update request.");
  }

  const tarEntries = await run(previousRelease, "tar", ["-tzf", request.artifactPath], { capture: true });
  const tarDetails = await run(previousRelease, "tar", ["-tvzf", request.artifactPath], { capture: true });
  const safety = await import(
    pathToFileURL(path.join(previousRelease, "scripts", "restore-safety.mjs")).href
  );
  safety.assertSafeTarEntries(tarEntries);
  safety.assertSafeTarEntryTypes(tarDetails);

  const expectedRoot = `codey-cms-${request.toVersion}`;
  const entries = tarEntries.split(/\r?\n/).filter(Boolean);
  if (entries.length === 0 || entries.some((entry) => {
    const normalized = entry.replace(/^\.\//, "");
    return normalized !== expectedRoot && !normalized.startsWith(`${expectedRoot}/`);
  })) {
    throw new Error("Release archive contains files outside its versioned root.");
  }

  const stagingRoot = path.join(releasesRoot, `.staging-${request.updateId}`);
  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(stagingRoot, { recursive: true });
  await run(previousRelease, "tar", ["-xzf", request.artifactPath, "-C", stagingRoot]);
  await safety.assertSafeMediaTree(stagingRoot);

  const extractedRoot = path.join(stagingRoot, expectedRoot);
  const runtimeManifest = await readJson(path.join(extractedRoot, "codey-runtime.json"));
  if (runtimeManifest?.version !== request.toVersion || runtimeManifest?.channel !== "stable") {
    throw new Error("Extracted release metadata does not match the staged update.");
  }
  const packageJson = await readJson(path.join(extractedRoot, "package.json"));
  if (packageJson?.version !== request.toVersion) {
    throw new Error("Extracted package version does not match the staged update.");
  }

  const corepackHome = path.join(runtimeRoot, "corepack");
  const pnpmHome = path.join(runtimeRoot, "pnpm");
  const xdgCacheHome = path.join(runtimeRoot, "xdg-cache");
  const xdgConfigHome = path.join(runtimeRoot, "xdg-config");
  const xdgDataHome = path.join(runtimeRoot, "xdg-data");
  await Promise.all([corepackHome, pnpmHome, xdgCacheHome, xdgConfigHome, xdgDataHome]
    .map((directory) => mkdir(directory, { recursive: true })));
  const packageManagerEnvironment = {
    ...process.env,
    COREPACK_HOME: corepackHome,
    PNPM_HOME: pnpmHome,
    XDG_CACHE_HOME: xdgCacheHome,
    XDG_CONFIG_HOME: xdgConfigHome,
    XDG_DATA_HOME: xdgDataHome
  };
  await run(extractedRoot, "pnpm", ["install", "--prod", "--frozen-lockfile"], {
    env: packageManagerEnvironment
  });
  await run(extractedRoot, "pnpm", ["prisma:generate"], {
    env: packageManagerEnvironment
  });

  const target = releaseDirectory(request.toVersion);
  await rm(target, { recursive: true, force: true });
  await rename(extractedRoot, target);
  await rm(stagingRoot, { recursive: true, force: true });
  return target;
}

async function markUpdate(releaseRoot, updateId, status, extraArgs = []) {
  await runWithSecrets(releaseRoot, process.execPath, [
    "scripts/update-runtime-status.mjs",
    updateId,
    status,
    ...extraArgs
  ]);
}

function runWithSecrets(cwd, command, args, extraEnvironment = {}) {
  return run(cwd, process.execPath, [
    "scripts/run-with-runtime-secrets.mjs",
    "--",
    command,
    ...args
  ], { env: { ...process.env, ...extraEnvironment } });
}

function run(cwd, command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: options.env || process.env,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit"
    });
    let output = "";

    if (options.capture) {
      child.stdout.on("data", (chunk) => { output += chunk.toString(); });
      child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    }
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(options.capture ? output : undefined);
      else reject(new Error(`${command} exited with code ${code}.${output ? `\n${output}` : ""}`));
    });
  });
}

async function waitForReadiness() {
  const deadline = Date.now() + 90_000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(readinessUrl, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return;
      lastError = new Error(`Readiness returned ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await wait(1_000);
  }

  throw lastError || new Error("Updated runtime did not become ready.");
}

async function switchCurrent(target) {
  const temporaryLink = `${currentLink}.${process.pid}.next`;
  await unlink(temporaryLink).catch(() => undefined);
  await symlink(path.relative(runtimeRoot, target), temporaryLink, "dir");
  await rename(temporaryLink, currentLink);
}

async function currentRelease() {
  const target = await readlink(currentLink);
  return path.resolve(runtimeRoot, target);
}

function releaseDirectory(version) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version || "")) {
    throw new Error("Runtime version is invalid.");
  }
  return path.join(releasesRoot, version);
}

async function validateUpdateRequest(request) {
  if (
    !request ||
    request.schemaVersion !== 1 ||
    typeof request.updateId !== "string" ||
    !/^[A-Za-z0-9_-]{10,64}$/.test(request.updateId)
  ) {
    throw new Error("Pending update request is invalid.");
  }
  releaseDirectory(request.fromVersion);
  releaseDirectory(request.toVersion);
  for (const value of [request.artifactPath, request.manifestPath]) {
    const resolved = path.resolve(value || "");
    const relative = path.relative(updatesRoot, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Pending update references a file outside the update directory.");
    }
    const fileStats = await lstat(resolved);
    if (!fileStats.isFile() || fileStats.isSymbolicLink()) {
      throw new Error("Pending update references an unsupported file type.");
    }
  }
}

async function assertCurrentVersion(releaseRoot, expectedVersion) {
  const packageJson = await readJson(path.join(releaseRoot, "package.json"));
  if (packageJson?.version !== expectedVersion) {
    throw new Error(`Pending update expects ${expectedVersion}, but the current runtime is ${packageJson?.version || "unknown"}.`);
  }
}

async function restoreBackup(previousRelease, manifestPath) {
  await runWithSecrets(
    previousRelease,
    process.execPath,
    ["scripts/restore-runtime.mjs", manifestPath],
    {
      ALLOW_PRODUCTION_RESTORE: "true",
      RESTORE_MEDIA: "false"
    }
  );
}

async function rejectInvalidRequest(request, error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Rejected pending CodeY CMS update: ${message}`);

  if (typeof request?.updateId === "string") {
    const releaseRoot = await currentRelease().catch(() => undefined);
    if (releaseRoot) {
      await markUpdate(releaseRoot, request.updateId, "FAILED", ["--error", message.slice(0, 2000)])
        .catch(() => undefined);
    }
  }

  await writeJsonAtomic(statusFile, {
    schemaVersion: 1,
    status: "failed",
    updateId: typeof request?.updateId === "string" ? request.updateId : null,
    updatedAt: new Date().toISOString(),
    error: message
  }).catch(() => undefined);

  const historyDirectory = path.join(path.dirname(controlFile), "history");
  await mkdir(historyDirectory, { recursive: true });
  await rename(controlFile, path.join(historyDirectory, `${Date.now()}-invalid.json`)).catch(() => undefined);
}

function isSafeFileName(value) {
  return typeof value === "string" && value.length > 0 && path.basename(value) === value && !value.includes("\\");
}

async function archiveRequest(request, result) {
  const historyDirectory = path.join(path.dirname(controlFile), "history");
  await mkdir(historyDirectory, { recursive: true });
  await rename(controlFile, path.join(historyDirectory, `${request.updateId}-${result}.json`));
}

async function writeStatus(status, request, details = {}) {
  await writeJsonAtomic(statusFile, {
    schemaVersion: 1,
    status,
    updateId: request.updateId,
    fromVersion: request.fromVersion,
    toVersion: request.toVersion,
    updatedAt: new Date().toISOString(),
    ...details
  });
}

async function cleanupOldReleases(current, previous) {
  const entries = await import("node:fs/promises").then(({ readdir }) => readdir(releasesRoot, { withFileTypes: true }));
  const protectedPaths = new Set([path.resolve(current), path.resolve(previous)]);
  const removable = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const entryPath = path.join(releasesRoot, entry.name);
    if (!protectedPaths.has(path.resolve(entryPath))) removable.push(entryPath);
  }
  removable.sort();
  while (removable.length > 1) {
    await rm(removable.shift(), { recursive: true, force: true });
  }
}

async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  if (updatePoll) clearInterval(updatePoll);
  await stopRuntime();
  console.log(`CodeY CMS supervisor stopped after ${signal}.`);
  process.exit(0);
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, filePath);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
