import { randomBytes } from "node:crypto";
import { link, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const secretDirectory = path.resolve(process.env.CODEY_SECRET_DIR || "/run/codey-secrets");
const secrets = {
  postgres_password: 32,
  postgres_runtime_password: 32,
  jwt_access_secret: 48,
  credential_encryption_key: 48,
  backup_encryption_key: 48,
  install_token: 32
};

await mkdir(secretDirectory, { recursive: true, mode: 0o700 });

for (const [name, bytes] of Object.entries(secrets)) {
  await ensureSecret(name, bytes);
}

if (process.env.CODEY_API_SECRET_DIR) {
  const apiDirectory = path.resolve(process.env.CODEY_API_SECRET_DIR);
  if (apiDirectory === secretDirectory) throw new Error("API secrets must use a separate directory.");
  await mkdir(apiDirectory, { recursive: true, mode: 0o755 });
  for (const name of ["postgres_runtime_password", "jwt_access_secret", "credential_encryption_key", "install_token"]) {
    const temporary = path.join(apiDirectory, `${name}.${randomBytes(12).toString("hex")}.tmp`);
    try {
      await writeFile(temporary, await readSecret(name), { flag: "wx", mode: 0o444 });
      await rename(temporary, path.join(apiDirectory, name));
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
}

if (process.argv.includes("--print-install-token")) {
  process.stdout.write(await readSecret("install_token"));
} else {
  console.log("Self-hosted runtime secrets are ready.");
}

async function ensureSecret(name, bytes) {
  const filePath = secretPath(name);
  try {
    const existing = await readFile(filePath, "utf8");
    if (existing.trim().length < 32) {
      throw new Error(`Runtime secret ${name} exists but is invalid. Restore it from the installation backup.`);
    }
    return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const temporaryPath = `${filePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  const handle = await open(temporaryPath, "wx", 0o444);
  try {
    await handle.writeFile(`${randomBytes(bytes).toString("base64url")}\n`, "utf8");
  } finally {
    await handle.close();
  }

  try {
    await link(temporaryPath, filePath);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }

  return ensureSecret(name, bytes);
}

function readSecret(name) {
  return readFile(secretPath(name), "utf8").then((value) => value.trim());
}

function secretPath(name) {
  if (!(name in secrets)) throw new Error(`Unknown self-hosted secret: ${name}.`);
  return path.join(secretDirectory, name);
}
