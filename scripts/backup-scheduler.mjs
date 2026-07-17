import "dotenv/config";
import { spawn } from "node:child_process";

function intervalMilliseconds() {
  const hours = Number(process.env.BACKUP_INTERVAL_HOURS || 24);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 168) {
    throw new Error("BACKUP_INTERVAL_HOURS must be greater than 0 and no more than 168 hours.");
  }
  return hours * 60 * 60 * 1000;
}

function runBackup() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/backup-runtime.mjs"], {
      env: process.env,
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
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => controller.abort());
}

const interval = intervalMilliseconds();
while (!controller.signal.aborted) {
  await runBackup();
  if (!controller.signal.aborted) await wait(interval, controller.signal);
}
