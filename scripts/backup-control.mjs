import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const heartbeatMaxAge = 30_000;
const requestCooldown = 60_000;

async function readJson(directory, name) {
  try {
    return JSON.parse(await readFile(path.join(directory, name), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJson(directory, name, value, exclusive = false) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, name);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { flag: "wx", mode: 0o600 });
    if (exclusive) await link(temporary, target);
    else await rename(temporary, target);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

function controlError(code, message) {
  return Object.assign(new Error(message), { code });
}

export async function backupControlStatus(directory, now = Date.now()) {
  const heartbeat = await readJson(directory, "backup-worker.json");
  const request = await readJson(directory, "requested-backup.json");
  const result = await readJson(directory, "backup-request-status.json");
  const age = now - Date.parse(heartbeat?.updatedAt);
  const available = Number.isFinite(age) && age >= -5_000 && age <= heartbeatMaxAge;
  const job = request ? result?.id === request.id ? result : { ...request, status: "queued" } : result;
  return {
    version: "1.0",
    available,
    busy: available && Boolean(heartbeat?.running || request),
    status: !available ? "unavailable" : job?.status || "idle",
    requestId: job?.id || null,
    requestedAt: job?.requestedAt || null,
    completedAt: job?.completedAt || null,
    backupId: job?.backupId || null,
    message: !available
      ? "The backup worker is not responding. Ask your hosting provider to check the backup service."
      : job?.status === "failed" ? "The backup did not complete. Existing backups were kept; check recovery status before retrying." : null
  };
}

export async function requestBackup(directory, now = Date.now()) {
  const status = await backupControlStatus(directory, now);
  if (!status.available) throw controlError("backup_worker_unavailable", status.message);
  // A scheduled snapshot is not this request: queue an encrypted job behind it.
  if (await readJson(directory, "requested-backup.json")) return backupControlStatus(directory, now);
  if (status.requestedAt && now - Date.parse(status.requestedAt) < requestCooldown) {
    throw controlError("backup_request_cooldown", "Wait one minute before requesting another backup.");
  }
  const request = { id: randomUUID(), requestedAt: new Date(now).toISOString() };
  try {
    await writeJson(directory, "requested-backup.json", request, true);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  return backupControlStatus(directory, now);
}

export function writeBackupHeartbeat(directory, running, now = Date.now()) {
  return writeJson(directory, "backup-worker.json", { updatedAt: new Date(now).toISOString(), running });
}

export async function runRequestedBackup(directory, run, scheduled = false) {
  const request = await readJson(directory, "requested-backup.json");
  if (!request && !scheduled) return false;
  if (request) {
    const previous = await readJson(directory, "backup-request-status.json");
    if (previous?.id === request.id && ["succeeded", "failed"].includes(previous.status)) {
      await unlink(path.join(directory, "requested-backup.json"));
      return false;
    }
    await writeJson(directory, "backup-request-status.json", { ...request, status: "running" });
  }
  const startedAt = Date.now();
  await writeBackupHeartbeat(directory, true);
  const heartbeat = setInterval(() => {
    void writeBackupHeartbeat(directory, true).catch(() => undefined);
  }, 5_000);
  heartbeat.unref();
  try {
    let succeeded = false;
    try { succeeded = await run({ requested: Boolean(request) }); } catch { /* A failed worker must leave a recoverable result. */ }
    const latest = await readJson(directory, "latest.json").catch(() => null);
    succeeded = succeeded && latest?.status === "success" && Date.parse(latest.completedAt) >= startedAt && (!request || latest.encrypted === true);
    if (request) {
      await writeJson(directory, "backup-request-status.json", {
        ...request,
        status: succeeded ? "succeeded" : "failed",
        completedAt: new Date().toISOString(),
        backupId: succeeded ? latest.backupId : null
      });
      await unlink(path.join(directory, "requested-backup.json"));
    }
    return true;
  } finally {
    clearInterval(heartbeat);
    await writeBackupHeartbeat(directory, false);
  }
}

export async function acquireBackupLock(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, ".backup-running");
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (error) {
    if (error.code === "EEXIST") {
      throw controlError("backup_in_progress", "A backup is already running. If it was interrupted, ask your hosting provider to clear the backup lock after checking that no backup process remains.");
    }
    throw error;
  }
  return () => rmdir(lock);
}
