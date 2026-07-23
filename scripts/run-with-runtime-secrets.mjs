import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const separator = process.argv.indexOf("--");
const command = separator >= 0 ? process.argv[separator + 1] : process.argv[2];
const args = separator >= 0 ? process.argv.slice(separator + 2) : process.argv.slice(3);

if (!command) {
  throw new Error("Pass the runtime command after --.");
}

const secretDirectory = path.resolve(process.env.CODEY_SECRET_DIR || "/run/codey-secrets");
const postgresPassword = await readSecret("postgres_password");
const databaseName = process.env.POSTGRES_DB || "codey_site";
const databaseUser = process.env.POSTGRES_USER || "codey";
const databaseHost = process.env.POSTGRES_HOST || "postgres";
const databasePort = process.env.POSTGRES_PORT || "5432";

process.env.DATABASE_URL ||= `postgresql://${encodeURIComponent(databaseUser)}:${encodeURIComponent(postgresPassword)}@${databaseHost}:${databasePort}/${encodeURIComponent(databaseName)}?schema=public`;
process.env.JWT_ACCESS_SECRET ||= await readSecret("jwt_access_secret");
process.env.CMS_CREDENTIAL_ENCRYPTION_KEY ||= await readSecret("credential_encryption_key");
process.env.BACKUP_ENCRYPTION_KEY ||= await readSecret("backup_encryption_key");
process.env.CODEY_INSTALL_TOKEN ||= await readSecret("install_token");

const child = spawn(command, args, {
  env: process.env,
  stdio: "inherit"
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});

async function readSecret(name) {
  const value = (await readFile(path.join(secretDirectory, name), "utf8")).trim();
  if (value.length < 32) throw new Error(`Runtime secret ${name} is missing or invalid.`);
  return value;
}
