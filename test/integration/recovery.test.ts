import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  const mediaFile = path.join(mediaDirectory, "recovery-marker.txt");
  const slug = `recovery-marker-${Date.now()}`;
  let prisma = new PrismaClient();

  try {
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

    prisma = new PrismaClient();
    await prisma.cmsPage.delete({ where: { locale_slug: { locale: "en", slug } } });
    await prisma.$disconnect();
    await writeFile(mediaFile, "changed after backup\n", "utf8");

    const manifestPath = path.join(backupDirectory, latest.manifestFile);
    await runScript("scripts/restore-runtime.mjs", [manifestPath], {
      ...environment,
      ALLOW_PRODUCTION_RESTORE: "true",
      RESTORE_MEDIA: "true",
      RESTORE_REPLACE_MEDIA: "true"
    });

    prisma = new PrismaClient();
    const restoredPage = await prisma.cmsPage.findUnique({
      where: { locale_slug: { locale: "en", slug } }
    });
    assert.equal(restoredPage?.title, "Recovery marker");
    assert.equal(await readFile(mediaFile, "utf8"), "original media\n");
    await prisma.cmsPage.delete({ where: { locale_slug: { locale: "en", slug } } });
  } finally {
    await prisma.$disconnect().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});

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
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";

    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} exited with code ${code}: ${output.slice(-2000)}`));
    });
  });
}
