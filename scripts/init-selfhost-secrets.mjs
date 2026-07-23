import { randomBytes } from "node:crypto";
import { link, mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";

const secretDirectory = path.resolve(process.env.CODEY_SECRET_DIR || "/run/codey-secrets");
const secrets = {
  postgres_password: 32,
  jwt_access_secret: 48,
  credential_encryption_key: 48,
  backup_encryption_key: 48,
  install_token: 32
};

await mkdir(secretDirectory, { recursive: true, mode: 0o700 });

for (const [name, bytes] of Object.entries(secrets)) {
  await ensureSecret(name, bytes);
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
