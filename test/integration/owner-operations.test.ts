import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import bcrypt from "bcryptjs";
import { config } from "../../src/config/index.js";
import { createApp } from "../../src/core/app.js";
import { prisma } from "../../src/infrastructure/database/prisma.js";
import { runRequestedBackup, writeBackupHeartbeat } from "../../scripts/backup-control.mjs";

test("owner operations require management access and create an encrypted backup through the worker", { timeout: 90_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "codey-owner-operations-"));
  const before = { ...config.backup };
  Object.assign(config.backup, { dir: directory, encrypted: true, required: true, requireEncryption: true, offsiteRequired: false });
  const app = await createApp();
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  let userId = "";
  const request = (route: string, token = "", method = "GET", body?: unknown) => fetch(`${base}${route}`, {
    method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const login = async (email: string, password: string) => {
    const response = await request("/auth/login", "", "POST", { email, password });
    assert.equal(response.status, 200);
    return (await response.json()).data.tokens.accessToken;
  };
  try {
    assert.equal((await request("/config/backup")).status, 401);
    assert.equal((await request("/config/launch-readiness")).status, 401);
    const owner = await login(process.env.INTEGRATION_ADMIN_EMAIL || "integration-owner@example.com", process.env.INTEGRATION_ADMIN_PASSWORD || "IntegrationOwner123!");
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "designer" } });
    const user = await prisma.user.create({ data: {
      email: `operations-${Date.now()}@example.com`, name: "Designer", status: "ACTIVE",
      passwordHash: await bcrypt.hash("DesignerOperations123!", 4), roles: { create: { roleId: role.id } }
    } });
    userId = user.id;
    const designer = await login(user.email, "DesignerOperations123!");
    for (const endpoint of ["/config/backup", "/config/launch-readiness"]) {
      assert.equal((await request(endpoint, designer)).status, 403);
    }
    assert.equal((await request("/config/backup", designer, "POST", {})).status, 403);
    const readiness = (await (await request("/config/launch-readiness", owner)).json()).data;
    assert.equal(readiness.readiness.scope, "installation-configuration");
    assert.equal(readiness.readiness.evidence.ownerJourneyVerified, false);
    assert.equal(readiness.runtime.product, "codey-cms");
    assert.equal((await request("/config/backup", owner, "POST", {})).status, 503);
    await writeBackupHeartbeat(directory, false);
    assert.equal((await request("/config/backup", owner, "POST", { command: "anything" })).status, 422);
    const queued = await request("/config/backup", owner, "POST", {});
    assert.equal(queued.status, 202);
    const control = (await queued.json()).data.control;
    assert.equal(control.status, "queued");
    const media = path.join(directory, "media");
    await mkdir(media);
    await runRequestedBackup(directory, async () => {
      await promisify(execFile)(process.execPath, ["scripts/backup-runtime.mjs"], { env: {
        ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL,
        BACKUP_DIR: directory, BACKUP_MIRROR_DIR: path.join(directory, "mirror"),
        BACKUP_ENCRYPTION_KEY: "owner-operations-test-encryption-key", BACKUP_REQUIRE_ENCRYPTION: "true",
        BACKUP_REQUIRED: "true", BACKUP_OFFSITE_REQUIRED: "false", BACKUP_OFFSITE_PROTECTED: "false",
        BACKUP_ALERT_WEBHOOK_URL: "", STORAGE_DRIVER: "local", STORAGE_LOCAL_DIR: media
      }, timeout: 60_000 });
      return true;
    });
    const completed = (await (await request("/config/backup", owner)).json()).data;
    assert.equal(completed.control.status, "succeeded");
    assert.equal(completed.control.requestId, control.requestId);
    assert.equal(completed.health.status, "pass");
    assert.equal(completed.health.details.encrypted, true);
    assert.equal(completed.health.details.offsiteProtected, false);
    assert.equal(completed.health.details.backupId, completed.control.backupId);
    assert.equal((await request("/config/backup", owner, "POST", {})).status, 429);
    assert.equal(await prisma.auditLog.count({ where: { action: "backup.request", subjectId: control.requestId } }), 1);
  } finally {
    if (userId) await prisma.user.delete({ where: { id: userId } });
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.$disconnect();
    Object.assign(config.backup, before);
    await rm(directory, { recursive: true, force: true });
  }
});
