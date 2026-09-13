import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import type { AppConfig } from "../src/config/index.js";
import { BackupControlService } from "../src/infrastructure/operations/backup-control.service.js";
import {
  acquireBackupLock, backupControlStatus, requestBackup, runRequestedBackup, writeBackupHeartbeat
} from "../scripts/backup-control.mjs";

async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), "codey-backup-control-"));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test("backup requests require a live worker and reject stale or future heartbeats", async () => {
  await fixture(async (directory) => {
    assert.equal((await backupControlStatus(directory)).available, false);
    await assert.rejects(requestBackup(directory), { code: "backup_worker_unavailable" });
    for (const offset of [-31_000, 60_000]) {
      await writeBackupHeartbeat(directory, false, Date.now() + offset);
      assert.equal((await backupControlStatus(directory)).available, false);
    }
  });
});

test("container healthcheck rejects a missing or stale worker heartbeat", async () => {
  await fixture(async (directory) => {
    const check = () => promisify(execFile)(process.execPath, ["scripts/check-backup-worker.mjs"], {
      env: { ...process.env, BACKUP_DIR: directory }
    });
    await assert.rejects(check(), { code: 1 });
    await writeBackupHeartbeat(directory, false);
    await check();
    await writeBackupHeartbeat(directory, false, Date.now() - 31_000);
    await assert.rejects(check(), { code: 1 });
  });
});

test("concurrent backup requests enqueue a single job, and completed requests are rate limited", async () => {
  await fixture(async (directory) => {
    await writeBackupHeartbeat(directory, false);
    const results = await Promise.all([requestBackup(directory), requestBackup(directory)]);
    assert.equal(results[0].requestId, results[1].requestId);
    assert.equal(results[0].status, "queued");
    let calls = 0;
    const run = async ({ requested }: { requested: boolean }) => {
      assert.equal(requested, true);
      calls += 1;
      await writeFile(path.join(directory, "latest.json"), JSON.stringify({ status: "success", encrypted: true, backupId: "new-snapshot", completedAt: new Date().toISOString() }));
      return true;
    };
    assert.equal(await runRequestedBackup(directory, run), true);
    assert.equal(await runRequestedBackup(directory, run), false);
    assert.equal(calls, 1);
    const status = await backupControlStatus(directory);
    assert.equal(status.status, "succeeded");
    assert.equal(status.backupId, "new-snapshot");
    await assert.rejects(requestBackup(directory), { code: "backup_request_cooldown" });
  });
});

test("failed or stale backup results never report a requested snapshot as completed", async () => {
  for (const result of [false, true]) {
    await fixture(async (directory) => {
      await writeBackupHeartbeat(directory, false);
      const previous = { status: "success", backupId: "old-snapshot", completedAt: "2020-01-01T00:00:00.000Z" };
      await writeFile(path.join(directory, "latest.json"), JSON.stringify(previous));
      await requestBackup(directory);
      await runRequestedBackup(directory, async () => result);
      const status = await backupControlStatus(directory);
      assert.equal(status.status, "failed");
      assert.equal(status.backupId, null);
      assert.deepEqual(JSON.parse(await readFile(path.join(directory, "latest.json"), "utf8")), previous);
    });
  }
});

test("a request during a scheduled snapshot queues a separate encrypted job", async () => {
  await fixture(async (directory) => {
    const scheduled = runRequestedBackup(directory, async ({ requested }: { requested: boolean }) => {
      assert.equal(requested, false);
      const first = await requestBackup(directory);
      const second = await requestBackup(directory);
      assert.equal(first.status, "queued");
      assert.ok(first.requestId);
      assert.equal(second.requestId, first.requestId);
      await writeFile(path.join(directory, "latest.json"), JSON.stringify({
        status: "success", encrypted: false, backupId: "scheduled", completedAt: new Date().toISOString()
      }));
      return true;
    }, true);
    await scheduled;
    assert.equal((await backupControlStatus(directory)).status, "queued");
    await runRequestedBackup(directory, async ({ requested }: { requested: boolean }) => {
      assert.equal(requested, true);
      await writeFile(path.join(directory, "latest.json"), JSON.stringify({
        status: "success", encrypted: true, backupId: "requested", completedAt: new Date().toISOString()
      }));
      return true;
    });
    const completed = await backupControlStatus(directory);
    assert.equal(completed.status, "succeeded");
    assert.equal(completed.backupId, "requested");
  });
});

test("a requested job cannot report an unencrypted snapshot as successful", async () => {
  await fixture(async (directory) => {
    await writeBackupHeartbeat(directory, false);
    await requestBackup(directory);
    await runRequestedBackup(directory, async () => {
      await writeFile(path.join(directory, "latest.json"), JSON.stringify({ status: "success", encrypted: false, completedAt: new Date().toISOString() }));
      return true;
    });
    assert.equal((await backupControlStatus(directory)).status, "failed");
  });
});

test("backup jobs resume after worker restart and cleanup does not rerun a completed snapshot", async () => {
  await fixture(async (directory) => {
    await writeBackupHeartbeat(directory, false);
    const request = await requestBackup(directory);
    const pending = JSON.parse(await readFile(path.join(directory, "requested-backup.json"), "utf8"));
    await writeFile(path.join(directory, "backup-request-status.json"), JSON.stringify({ ...pending, status: "succeeded" }));
    let called = false;
    await runRequestedBackup(directory, async () => { called = true; return true; });
    assert.equal(called, false);
    assert.equal((await backupControlStatus(directory)).requestId, request.requestId);
    assert.equal((await backupControlStatus(directory)).busy, false);
  });
});

test("scheduled backups run without a dashboard job and share an exclusive artifact lock", async () => {
  await fixture(async (directory) => {
    const release = await acquireBackupLock(directory);
    await assert.rejects(acquireBackupLock(directory), { code: "backup_in_progress" });
    await release();
    const nextRelease = await acquireBackupLock(directory);
    await nextRelease();
    let calls = 0;
    await runRequestedBackup(directory, async () => { calls += 1; return false; }, true);
    assert.equal(calls, 1);
    assert.equal((await backupControlStatus(directory)).status, "idle");
  });
});

test("backup API service requires encryption, maps worker errors, and exposes no caller paths", async () => {
  await fixture(async (directory) => {
    const config = { backup: { dir: directory, encrypted: false } } as AppConfig;
    const service = new BackupControlService(config);
    assert.equal((await service.status()).canRequest, false);
    await assert.rejects(service.request(), { statusCode: 409, code: "backup_encryption_required" });
    config.backup.encrypted = true;
    await assert.rejects(service.request(), { statusCode: 503, code: "backup_worker_unavailable" });
    await writeBackupHeartbeat(directory, false);
    assert.equal((await service.status()).canRequest, true);
    assert.equal((await service.request()).status, "queued");
    assert.equal((await service.status()).canRequest, false);
    await runRequestedBackup(directory, async () => false);
    await assert.rejects(service.request(), { statusCode: 429, code: "backup_request_cooldown" });
    await writeFile(path.join(directory, "backup-worker.json"), "invalid json");
    await assert.rejects(service.request(), SyntaxError);
  });
});
