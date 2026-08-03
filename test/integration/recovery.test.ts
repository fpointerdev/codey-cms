import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const encryptionKey = "codey-recovery-test-encryption-key-2026";

test("encrypted backup restores database records and local media", { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "codey-recovery-integration-"));
  const backupDirectory = path.join(directory, "backups");
  const mirrorDirectory = path.join(directory, "mirror");
  const mediaDirectory = path.join(directory, "uploads");
  const restoredMediaDirectory = path.join(directory, "restored-uploads");
  const mediaFile = path.join(mediaDirectory, "recovery-marker.txt");
  const slug = `recovery-marker-${Date.now()}`;
  const targetDatabaseName = `codey_recovery_${Date.now()}`;
  const sourceDatabaseUrl = process.env.TEST_DATABASE_URL || "";
  const targetDatabaseUrl = databaseUrlFor(sourceDatabaseUrl, targetDatabaseName);
  let prisma = new PrismaClient();
  let restoredPrisma: PrismaClient | undefined;

  try {
    await createDatabase(sourceDatabaseUrl, targetDatabaseName);
    await mkdir(mediaDirectory, { recursive: true });
    await writeFile(mediaFile, "original media\n", "utf8");
    await prisma.cmsPage.create({
      data: {
        title: "Recovery marker",
        slug,
        content: { source: "recovery-integration" },
        status: "PUBLISHED",
        publishedAt: new Date()
      }
    });
    await prisma.$disconnect();

    const environment = recoveryEnvironment({
      BACKUP_DIR: backupDirectory,
      BACKUP_MIRROR_DIR: mirrorDirectory,
      STORAGE_LOCAL_DIR: mediaDirectory
    });
    await runScript("scripts/backup-runtime.mjs", [], environment);

    const latest = JSON.parse(await readFile(path.join(backupDirectory, "latest.json"), "utf8"));
    const mirrored = JSON.parse(await readFile(path.join(mirrorDirectory, "latest.json"), "utf8"));
    assert.equal(latest.status, "success");
    assert.equal(latest.encrypted, true);
    assert.equal(latest.mirrored, true);
    assert.equal(mirrored.backupId, latest.backupId);

    const manifestPath = path.join(mirrorDirectory, latest.manifestFile);
    await runScript("scripts/restore-runtime.mjs", [manifestPath], {
      ...environment,
      DATABASE_URL: targetDatabaseUrl,
      STORAGE_LOCAL_DIR: restoredMediaDirectory,
      ALLOW_PRODUCTION_RESTORE: "true",
      RESTORE_MEDIA: "true",
      RESTORE_REPLACE_MEDIA: "true"
    });

    restoredPrisma = new PrismaClient({ datasourceUrl: targetDatabaseUrl });
    const restoredPage = await restoredPrisma.cmsPage.findUnique({
      where: { locale_slug: { locale: "en", slug } }
    });
    assert.equal(restoredPage?.title, "Recovery marker");
    assert.equal(await readFile(path.join(restoredMediaDirectory, "recovery-marker.txt"), "utf8"), "original media\n");
    assert.deepEqual(
      (await readdir(restoredMediaDirectory)).filter((name) => name.startsWith(".codey-")),
      []
    );
    await restoredPrisma.$disconnect();
    restoredPrisma = undefined;

    prisma = new PrismaClient();
    await prisma.cmsPage.delete({ where: { locale_slug: { locale: "en", slug } } });
  } finally {
    await restoredPrisma?.$disconnect().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    await dropDatabase(sourceDatabaseUrl, targetDatabaseName).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});

function databaseUrlFor(sourceUrl: string, databaseName: string) {
  const url = new URL(sourceUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function maintenanceDatabaseUrl(sourceUrl: string) {
  const url = new URL(databaseUrlFor(sourceUrl, "postgres"));
  url.searchParams.delete("schema");
  return url.toString();
}

async function createDatabase(sourceUrl: string, databaseName: string) {
  await runCommand("psql", [maintenanceDatabaseUrl(sourceUrl), "-v", "ON_ERROR_STOP=1", "-c", `CREATE DATABASE ${databaseName}`]);
}

async function dropDatabase(sourceUrl: string, databaseName: string) {
  await runCommand("psql", [maintenanceDatabaseUrl(sourceUrl), "-v", "ON_ERROR_STOP=1", "-c", `DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`]);
}

function recoveryEnvironment(overrides: Record<string, string>) {
  return {
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: process.env.TEST_DATABASE_URL || "",
    APP_NAME: "CodeY CMS Recovery Test",
    APP_MODE: "cms",
    STORAGE_DRIVER: "local",
    BACKUP_REQUIRED: "true",
    BACKUP_REQUIRE_ENCRYPTION: "true",
    BACKUP_ENCRYPTION_KEY: encryptionKey,
    BACKUP_RETENTION_DAYS: "1",
    ...overrides
  };
}

function runScript(script: string, args: string[], env: NodeJS.ProcessEnv) {
  return runCommand(process.execPath, [script, ...args], env);
}

function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";

    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}: ${output.slice(-2000)}`));
    });
  });
}
