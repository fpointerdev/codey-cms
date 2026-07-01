import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
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
const backupFile = process.argv[2] ?? process.env.BACKUP_FILE;

if (!backupFile) {
  throw new Error("Pass a backup file path as an argument or set BACKUP_FILE.");
}

if (process.env.NODE_ENV === "production" && process.env.ALLOW_PRODUCTION_RESTORE !== "true") {
  throw new Error("Set ALLOW_PRODUCTION_RESTORE=true to restore into production.");
}

const inputFile = path.resolve(backupFile);
await access(inputFile);

if (inputFile.endsWith(".dump") || inputFile.endsWith(".backup")) {
  await run("pg_restore", [
    "--clean",
    "--if-exists",
    "--no-owner",
    "--no-privileges",
    "--dbname",
    databaseUrl,
    inputFile
  ]);
} else {
  await run("psql", ["--set", "ON_ERROR_STOP=1", databaseUrl, "--file", inputFile]);
}

console.log(`Restore completed: ${inputFile}`);
