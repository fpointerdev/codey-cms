import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
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

test("API bootstrap exposes only runtime secrets and strips inherited privileged credentials", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "codey-api-secrets-"));
  const apiDirectory = path.join(directory, "api");
  try {
    await Promise.all([0, 1].map(() => execFileAsync(process.execPath, ["scripts/init-selfhost-secrets.mjs"], {
      env: { ...process.env, CODEY_SECRET_DIR: directory, CODEY_API_SECRET_DIR: apiDirectory }
    })));
    assert.deepEqual((await readdir(apiDirectory)).sort(), [
      "credential_encryption_key", "install_token", "jwt_access_secret", "postgres_runtime_password"
    ]);
    const result = await execFileAsync(process.execPath, [
      "scripts/run-with-runtime-secrets.mjs", "--api", "--", process.execPath, "-e",
      `process.stdout.write(JSON.stringify({
        database: new URL(process.env.DATABASE_URL).username,
        migration: process.env.MIGRATION_DATABASE_URL,
        postgres: process.env.POSTGRES_PASSWORD,
        backup: process.env.BACKUP_ENCRYPTION_KEY,
        worker: process.env.BACKUP_WORKER_MANAGED,
        manageRole: process.env.CODEY_MANAGE_RUNTIME_DB_ROLE
      }))`
    ], { env: { ...process.env, CODEY_SECRET_DIR: apiDirectory,
      DATABASE_URL: "postgresql://owner:secret@postgres/codey_site",
      MIGRATION_DATABASE_URL: "privileged", POSTGRES_PASSWORD: "privileged", BACKUP_ENCRYPTION_KEY: "privileged"
    } });
    assert.deepEqual(JSON.parse(result.stdout), { database: "codey_runtime", worker: "true", manageRole: "false" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("self-host API mounts cannot modify releases or backup artifacts", async () => {
  const compose = await readFile("docker-compose.selfhost.yml", "utf8");
  const backend = compose.split("  backend:\n")[1].split("  supervisor:\n")[0];
  assert.match(backend, /codey_api_secrets:\/run\/codey-secrets:ro/);
  assert.match(backend, /codey_backups:\/app\/backups:ro/);
  assert.match(backend, /codey_runtime:\/runtime:ro/);
  assert.doesNotMatch(backend, /codey_secrets:|codey_backup_mirror:/);
  assert.match(backend, /scripts\/selfhost-api-runner\.mjs/);
  const supervisor = compose.split("  supervisor:\n")[1].split("  backup:\n")[0];
  assert.match(supervisor, /CODEY_EXTERNAL_RUNTIME: "true"/);
  assert.doesNotMatch(supervisor, /ports:|docker.sock/);
  assert.match(supervisor, /scripts\/check-update-supervisor\.mjs/);
});

test("update supervisor health requires a recent heartbeat", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "codey-supervisor-health-"));
  const check = () => execFileAsync(process.execPath, ["scripts/check-update-supervisor.mjs"], {
    env: { ...process.env, CODEY_RUNTIME_ROOT: directory }
  });
  try {
    await assert.rejects(check());
    for (const updatedAt of [Date.now() - 31_000, Date.now() + 60_000, "invalid"]) {
      await writeFile(path.join(directory, "supervisor-health.json"), JSON.stringify({ updatedAt }));
      await assert.rejects(check());
    }
    await writeFile(path.join(directory, "supervisor-health.json"), JSON.stringify({ updatedAt: Date.now() }));
    await check();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("worker status writes cannot follow precreated temporary symlinks", async () => {
  for (const file of ["selfhost-api-runner.mjs", "selfhost-supervisor.mjs", "backup-control.mjs"]) {
    const source = await readFile(`scripts/${file}`, "utf8");
    assert.match(source, /randomUUID\(\).*\.tmp/);
    assert.match(source, /flag: "wx"/);
  }
  const supervisor = await readFile("scripts/selfhost-supervisor.mjs", "utf8");
  assert.match(supervisor, /path.join\(runtimeRoot, "update-history"\)/);
  assert.doesNotMatch(supervisor, /path.join\(path.dirname\(controlFile\), "history"\)/);
});

test("the image preparation launcher migrates an older runtime without importing or serving it", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "codey-prepare-runtime-"));
  const log = path.join(directory, "steps.log");
  try {
    for (const folder of ["scripts", "node_modules/prisma/build", "dist/src", "codey/export"]) {
      await mkdir(path.join(directory, folder), { recursive: true });
    }
    for (const [file, label] of Object.entries({
      "scripts/build-prisma-schema.mjs": "schema",
      "node_modules/prisma/build/index.js": "migration",
      "scripts/configure-runtime-database-role.mjs": "role",
      "scripts/apply-export-website-spec.mjs": "import",
      "dist/src/server.js": "server"
    })) {
      await writeFile(path.join(directory, file), `import { appendFileSync } from 'node:fs'; appendFileSync(${JSON.stringify(log)}, ${JSON.stringify(`${label}\n`)});`);
    }
    await writeFile(path.join(directory, "codey/export/website-spec.json"), "{}");
    await execFileAsync(process.execPath, ["scripts/start-production.mjs", "--prepare-only", "--runtime-root", directory], {
      env: { ...process.env, CODEY_MANAGE_RUNTIME_DB_ROLE: "true", CODEY_EXPORT_APPLY_ON_START: "true" }
    });
    assert.equal(await readFile(log, "utf8"), "schema\nmigration\nrole\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

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

test("self-host launchers load generated and public overrides when requested", async () => {
  const [shellLauncher, windowsLauncher, composeFile, publicComposeFile, supervisor] = await Promise.all([
    readFile("start-codey.sh", "utf8"),
    readFile("start-codey.cmd", "utf8"),
    readFile("docker-compose.selfhost.yml", "utf8"),
    readFile("docker-compose.public.yml", "utf8"),
    readFile("scripts/selfhost-supervisor.mjs", "utf8")
  ]);

  assert.match(shellLauncher, /CODEY_COMPOSE_OVERRIDE_FILE:-docker-compose\.override\.yml/);
  assert.match(shellLauncher, /-f "\$override_file"/);
  assert.match(shellLauncher, /compose run --rm --no-deps secrets/);
  assert.match(shellLauncher, /command -v docker/);
  assert.match(shellLauncher, /docker info/);
  assert.match(shellLauncher, /\.codey-local-port/);
  assert.match(shellLauncher, /APP_PUBLIC_URL="\$\{APP_PUBLIC_URL:-http:\/\/localhost:\$\{API_PORT\}\}"/);
  assert.match(shellLauncher, /--domain/);
  assert.match(shellLauncher, /docker-compose\.public\.yml/);
  assert.match(windowsLauncher, /CODEY_COMPOSE_OVERRIDE_FILE=docker-compose\.override\.yml/);
  assert.match(windowsLauncher, /-f %CODEY_COMPOSE_OVERRIDE_FILE%/);
  assert.match(windowsLauncher, /docker compose %COMPOSE_FILES% run/);
  assert.match(windowsLauncher, /where docker/);
  assert.match(windowsLauncher, /Get-NetTCPConnection/);
  assert.match(windowsLauncher, /\.codey-local-port/);
  assert.match(windowsLauncher, /%APP_PUBLIC_URL%\/install#token=%INSTALL_TOKEN%/);
  assert.match(windowsLauncher, /--domain/);
  assert.match(windowsLauncher, /docker-compose\.public\.yml/);
  assert.match(composeFile, /backup:[\s\S]*healthcheck:[\s\S]*scripts\/check-backup-worker\.mjs/);
  assert.doesNotMatch(composeFile, /process\.kill\(1, 0\)/);
  assert.match(composeFile, /secrets:[\s\S]*healthcheck:\s*\n\s*disable:\s*true/);
  assert.match(composeFile, /CODEY_SEED_DEMO_CONTENT: \$\{CODEY_SEED_DEMO_CONTENT:-false\}/);
  assert.doesNotMatch(composeFile, /backup:[\s\S]*healthcheck:\s*\n\s*disable:\s*true/);
  assert.match(composeFile, /BACKUP_REQUIRED: \$\{BACKUP_REQUIRED:-true\}/);
  assert.match(composeFile, /BACKUP_OFFSITE_REQUIRED: \$\{BACKUP_OFFSITE_REQUIRED:-true\}/);
  assert.match(composeFile, /BACKUP_OFFSITE_PROTECTED: \$\{BACKUP_OFFSITE_PROTECTED:-false\}/);
  assert.match(composeFile, /COREPACK_HOME: \/runtime\/corepack/);
  assert.match(composeFile, /XDG_DATA_HOME: \/runtime\/xdg-data/);
  assert.match(supervisor, /COREPACK_HOME: corepackHome/);
  assert.match(composeFile, /dockerfile: Dockerfile\.postgres/);
  assert.match(await readFile("Dockerfile.postgres", "utf8"), /postgres:16-alpine@sha256:[a-f0-9]{64}/);
  assert.match(composeFile, /127\.0\.0\.1:\$\{API_PORT:-4000\}:4000/);
  assert.match(publicComposeFile, /dockerfile: Dockerfile\.caddy/);
  assert.match(await readFile("Dockerfile.caddy", "utf8"), /caddy:2\.11\.9-alpine@sha256:[a-f0-9]{64}/);
  assert.match(publicComposeFile, /TRUST_PROXY: "1"/);
  assert.match(publicComposeFile, /"443:443\/udp"/);
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

    const publicResult = await execFileAsync("sh", ["start-codey.sh", "--domain", "cms.example.com", "--no-open"], {
      cwd: directory,
      env: {
        ...process.env,
        API_PORT: "4001",
        APP_PUBLIC_URL: "",
        CORS_ORIGINS: "",
        CODEY_DOMAIN: "",
        PATH: `${binDirectory}:${process.env.PATH || ""}`,
        CODEY_DOCKER_LOG: dockerLog,
        CODEY_OPENED_URL: openedUrl
      }
    });
    assert.match(publicResult.stdout, /https:\/\/cms\.example\.com\/install#token=/);
    assert.match(await readFile(dockerLog, "utf8"), /-f docker-compose\.public\.yml up/);
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
