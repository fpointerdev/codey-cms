import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, realpath, writeFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const imageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = path.resolve(process.env.CODEY_RUNTIME_ROOT || "/runtime");
const controlDirectory = path.dirname(process.env.CODEY_UPDATE_CONTROL_FILE || path.join(runtimeRoot, "control", "pending-update.json"));
let child;
let stopping = false;

async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const current = child;
  const exited = new Promise((resolve) => current.once("exit", resolve));
  const signal = (name) => {
    try { process.kill(-current.pid, name); } catch (error) { if (error.code !== "ESRCH") throw error; }
  };
  signal("SIGTERM");
  const timeout = setTimeout(() => signal("SIGKILL"), 10_000);
  try { await exited; } finally { clearTimeout(timeout); }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => { stopping = true; void stop(); });
}

while (!stopping) {
  try {
    const state = JSON.parse(await readFile(path.join(controlDirectory, "api-state.json"), "utf8"));
    if (state.desired === "stopped") {
      await stop();
      const target = path.join(controlDirectory, "api-status.json");
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify({ status: "stopped", requestId: state.requestId }), { flag: "wx", mode: 0o600 });
        await rename(temporary, target);
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
    } else if (state.desired === "running" && (!child || child.exitCode !== null || child.signalCode !== null)) {
      const current = await realpath(path.join(runtimeRoot, "current"));
      const relative = path.relative(path.join(runtimeRoot, "releases"), current);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Invalid active runtime path.");
      child = spawn(process.execPath, [
        path.join(imageRoot, "scripts/run-with-runtime-secrets.mjs"), "--api", "--",
        process.execPath, path.join(imageRoot, "scripts/start-production.mjs"), "--serve-only", "--runtime-root", current
      ], { cwd: current, env: process.env, stdio: "inherit", detached: true });
      child.on("error", (error) => console.error("API process failed to start.", error));
    }
  } catch (error) {
    if (error.code !== "ENOENT") console.error("API runner is waiting for a valid release.", error);
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
await stop();
