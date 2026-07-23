import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const secretNames = [
  "postgres_password",
  "jwt_access_secret",
  "credential_encryption_key",
  "backup_encryption_key",
  "install_token"
];

test("self-host bootstrap creates persistent secrets once", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "codey-selfhost-secrets-"));
  const environment = { ...process.env, CODEY_SECRET_DIR: directory };

  try {
    await Promise.all([
      execFileAsync(process.execPath, ["scripts/init-selfhost-secrets.mjs"], { env: environment }),
      execFileAsync(process.execPath, ["scripts/init-selfhost-secrets.mjs"], { env: environment })
    ]);
    const initial = await readSecrets(directory);

    await execFileAsync(process.execPath, ["scripts/init-selfhost-secrets.mjs"], { env: environment });
    assert.deepEqual(await readSecrets(directory), initial);

    const printed = await execFileAsync(
      process.execPath,
      ["scripts/init-selfhost-secrets.mjs", "--print-install-token"],
      { env: environment }
    );
    assert.equal(printed.stdout, initial.install_token);

    for (const name of secretNames) {
      assert.ok(initial[name].length >= 32);
      assert.equal((await stat(path.join(directory, name))).mode & 0o777, 0o444);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("self-host bootstrap refuses to rotate a damaged persisted secret", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "codey-selfhost-secrets-"));
  const environment = { ...process.env, CODEY_SECRET_DIR: directory };

  try {
    await execFileAsync(process.execPath, ["scripts/init-selfhost-secrets.mjs"], { env: environment });
    await chmod(path.join(directory, "install_token"), 0o644);
    await writeFile(path.join(directory, "install_token"), "broken\n", { mode: 0o644 });

    await assert.rejects(
      execFileAsync(process.execPath, ["scripts/init-selfhost-secrets.mjs"], { env: environment }),
      /exists but is invalid/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("self-host launchers load a generated export override when present", async () => {
  const [shellLauncher, windowsLauncher] = await Promise.all([
    readFile("start-codey.sh", "utf8"),
    readFile("start-codey.cmd", "utf8")
  ]);

  assert.match(shellLauncher, /-f "docker-compose\.override\.yml"/);
  assert.match(shellLauncher, /compose run --rm --no-deps secrets/);
  assert.match(windowsLauncher, /-f docker-compose\.override\.yml/);
  assert.match(windowsLauncher, /docker compose %COMPOSE_FILES% run/);
});

async function readSecrets(directory: string) {
  return Object.fromEntries(await Promise.all(secretNames.map(async (name) => [
    name,
    (await readFile(path.join(directory, name), "utf8")).trim()
  ]))) as Record<string, string>;
}
