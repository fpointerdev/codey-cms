import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const secretNames = [
  "postgres_password",
  "postgres_runtime_password",
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

test("existing self-host installs derive a stable runtime database password during upgrade", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "codey-selfhost-upgrade-"));
  const environment = {
    ...process.env,
    CODEY_SECRET_DIR: directory,
    DATABASE_URL: "",
    MIGRATION_DATABASE_URL: "",
    POSTGRES_DB: "codey_site",
    POSTGRES_USER: "codey",
    POSTGRES_RUNTIME_USER: "codey_runtime",
    POSTGRES_HOST: "postgres",
    POSTGRES_PORT: "5432"
  };

  try {
    await execFileAsync(process.execPath, ["scripts/init-selfhost-secrets.mjs"], { env: environment });
    await unlink(path.join(directory, "postgres_runtime_password"));
    const command = [
      "scripts/run-with-runtime-secrets.mjs",
      "--",
      process.execPath,
      "-e",
      "process.stdout.write(process.env.DATABASE_URL)"
    ];
    const first = await execFileAsync(process.execPath, command, { env: environment });
    const second = await execFileAsync(process.execPath, command, { env: environment });

    assert.equal(first.stdout, second.stdout);
    const databaseUrl = new URL(first.stdout);
    assert.equal(databaseUrl.username, "codey_runtime");
    assert.ok(databaseUrl.password.length >= 32);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("self-host launchers load a generated export override when present", async () => {
  const [shellLauncher, windowsLauncher, composeFile] = await Promise.all([
    readFile("start-codey.sh", "utf8"),
    readFile("start-codey.cmd", "utf8"),
    readFile("docker-compose.selfhost.yml", "utf8")
  ]);

  assert.match(shellLauncher, /CODEY_COMPOSE_OVERRIDE_FILE:-docker-compose\.override\.yml/);
  assert.match(shellLauncher, /-f "\$override_file"/);
  assert.match(shellLauncher, /compose run --rm --no-deps secrets/);
  assert.match(shellLauncher, /command -v docker/);
  assert.match(shellLauncher, /docker info/);
  assert.match(shellLauncher, /\.codey-local-port/);
  assert.match(shellLauncher, /APP_PUBLIC_URL="\$\{APP_PUBLIC_URL:-http:\/\/localhost:\$\{API_PORT\}\}"/);
  assert.match(windowsLauncher, /CODEY_COMPOSE_OVERRIDE_FILE=docker-compose\.override\.yml/);
  assert.match(windowsLauncher, /-f %CODEY_COMPOSE_OVERRIDE_FILE%/);
  assert.match(windowsLauncher, /docker compose %COMPOSE_FILES% run/);
  assert.match(windowsLauncher, /where docker/);
  assert.match(windowsLauncher, /Get-NetTCPConnection/);
  assert.match(windowsLauncher, /\.codey-local-port/);
  assert.match(windowsLauncher, /%APP_PUBLIC_URL%\/install#token=%INSTALL_TOKEN%/);
  assert.match(composeFile, /backup:[\s\S]*healthcheck:[\s\S]*process\.kill\(1, 0\)/);
  assert.doesNotMatch(composeFile, /backup:[\s\S]*healthcheck:\s*\n\s*disable:\s*true/);
});

test("self-host shell launcher selects and remembers an available port", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "codey-selfhost-launcher-"));
  const binDirectory = path.join(directory, "bin");
  const dockerLog = path.join(directory, "docker.log");
  const openedUrl = path.join(directory, "opened-url.txt");

  try {
    await mkdir(binDirectory);
    await writeExecutable(path.join(directory, "start-codey.sh"), await readFile("start-codey.sh", "utf8"));
    await writeExecutable(path.join(binDirectory, "docker"), [
      "#!/bin/sh",
      "printf '%s\\n' \"$*\" >> \"$CODEY_DOCKER_LOG\"",
      'case "$*" in',
      "  *--print-install-token*) printf 'test-install-token' ;;",
      "esac"
    ].join("\n"));
    await writeExecutable(path.join(binDirectory, "lsof"), [
      "#!/bin/sh",
      'case "$*" in',
      "  *:4000*) exit 0 ;;",
      "  *) exit 1 ;;",
      "esac"
    ].join("\n"));
    await writeExecutable(path.join(binDirectory, "uname"), "#!/bin/sh\nprintf 'Linux\\n'\n");
    await writeExecutable(path.join(binDirectory, "xdg-open"), "#!/bin/sh\nprintf '%s' \"$1\" > \"$CODEY_OPENED_URL\"\n");

    const result = await execFileAsync("sh", ["start-codey.sh"], {
      cwd: directory,
      env: {
        ...process.env,
        API_PORT: "",
        APP_PUBLIC_URL: "",
        CORS_ORIGINS: "",
        CODEY_SETUP_URL: "",
        PATH: `${binDirectory}:${process.env.PATH || ""}`,
        CODEY_DOCKER_LOG: dockerLog,
        CODEY_OPENED_URL: openedUrl
      }
    });

    assert.match(result.stdout, /http:\/\/localhost:4001/);
    assert.equal((await readFile(path.join(directory, ".codey-local-port"), "utf8")).trim(), "4001");
    assert.match(await readFile(dockerLog, "utf8"), /up -d --build --wait --wait-timeout 180/);
    assert.equal(
      await readFile(openedUrl, "utf8"),
      "http://localhost:4001/install#token=test-install-token"
    );

    await unlink(openedUrl);
    const headless = await execFileAsync("sh", ["start-codey.sh", "--no-open"], {
      cwd: directory,
      env: {
        ...process.env,
        API_PORT: "",
        APP_PUBLIC_URL: "",
        CORS_ORIGINS: "",
        CODEY_SETUP_URL: "",
        PATH: `${binDirectory}:${process.env.PATH || ""}`,
        CODEY_DOCKER_LOG: dockerLog,
        CODEY_OPENED_URL: openedUrl
      }
    });
    assert.match(headless.stdout, /Open this one-time setup URL:[\s\S]*http:\/\/localhost:4001\/install#token=/);
    await assert.rejects(readFile(openedUrl, "utf8"), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runtime database role setup emits executable SQL without logging its password", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "codey-runtime-role-"));
  const capturePath = path.join(directory, "role.sql");
  const psqlPath = path.join(directory, "psql");

  try {
    await writeFile(psqlPath, '#!/bin/sh\ncat > "$CODEY_SQL_CAPTURE"\n', { mode: 0o755 });
    await execFileAsync(process.execPath, ["scripts/configure-runtime-database-role.mjs"], {
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH || ""}`,
        CODEY_SQL_CAPTURE: capturePath,
        MIGRATION_DATABASE_URL: "postgresql://codey:owner-password@localhost:5432/codey_site?schema=public",
        DATABASE_URL: "postgresql://codey_runtime:runtime-password-with-at-least-32-characters@localhost:5432/codey_site?schema=public"
      }
    });

    const sql = await readFile(capturePath, "utf8");
    assert.match(sql, /SET log_statement = 'none';[\s\S]*DO \$codey\$[\s\S]*RESET log_statement;/);
    assert.match(sql, /REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public\."AuditLog" FROM "codey_runtime";/);
    assert.doesNotMatch(sql, /gexec/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function readSecrets(directory: string) {
  return Object.fromEntries(await Promise.all(secretNames.map(async (name) => [
    name,
    (await readFile(path.join(directory, name), "utf8")).trim()
  ]))) as Record<string, string>;
}

async function writeExecutable(filePath: string, contents: string) {
  await writeFile(filePath, contents, { mode: 0o755 });
}
