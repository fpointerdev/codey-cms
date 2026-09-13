import "dotenv/config";
import { spawn } from "node:child_process";
import path from "node:path";
import { runRequestedBackup, writeBackupHeartbeat } from "./backup-control.mjs";

function intervalMilliseconds() {
  const hours = Number(process.env.BACKUP_INTERVAL_HOURS || 24);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 168) {
    throw new Error("BACKUP_INTERVAL_HOURS must be greater than 0 and no more than 168 hours.");
  }
  return hours * 60 * 60 * 1000;
}

function runBackup({ requested = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/backup-runtime.mjs"], {
      env: { ...process.env, ...(requested ? { BACKUP_REQUIRE_ENCRYPTION: "true" } : {}) },
      stdio: "inherit"
    });
    child.on("error", (error) => {
      console.error(`Backup process failed to start: ${error.message}`);
      resolve(false);
    });
    child.on("close", (code) => resolve(code === 0));
  });
}

function wait(milliseconds, signal) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timeout = setTimeout(done, milliseconds);
    signal.addEventListener("abort", done, { once: true });
    if (signal.aborted) done();
  });
}

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => controller.abort());
}

const interval = intervalMilliseconds();
const directory = path.resolve(process.env.BACKUP_DIR || "backups");
let nextBackup = 0;
while (!controller.signal.aborted) {
  await writeBackupHeartbeat(directory, false);
  try {
    if (await runRequestedBackup(directory, runBackup, Date.now() >= nextBackup)) {
      nextBackup = Date.now() + interval;
    }
  } catch (error) {
    console.error(`Backup worker needs attention: ${error.message}`);
  }
  if (!controller.signal.aborted) await wait(5_000, controller.signal);
}
