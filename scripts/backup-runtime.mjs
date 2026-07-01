import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}.`));
    });
  });
}

const databaseUrl = requireEnv("DATABASE_URL");
const backupDir = path.resolve(process.env.BACKUP_DIR ?? "backups");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputFile = path.join(backupDir, `runtime-${timestamp}.dump`);

await mkdir(backupDir, { recursive: true });
await run("pg_dump", [
  "--format=custom",
  "--no-owner",
  "--no-privileges",
  "--file",
  outputFile,
  databaseUrl
]);

console.log(`Backup created: ${outputFile}`);
