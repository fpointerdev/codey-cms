import assert from "node:assert/strict";
import test from "node:test";
import { executeRuntimeUpdate } from "../scripts/runtime-update-orchestrator.mjs";

const request = { updateId: "update-test-0001", fromVersion: "0.9.0", toVersion: "0.9.1" };
const previousRelease = "/runtime/releases/0.9.0";
const targetRelease = "/runtime/releases/0.9.1";
const backup = { backupId: "backup-test-0001", manifestPath: "/backups/backup-test-0001.json" };

test("runtime update completes after backup, switch, and readiness", async () => {
  const events: string[] = [];
  const result = await executeRuntimeUpdate({
    request,
    previousRelease,
    operations: operations(events)
  });

  assert.deepEqual(result, {
    status: "SUCCEEDED",
    backupId: backup.backupId,
    targetRelease
  });
  assert.deepEqual(events, [
    "before",
    "backup",
    "after-backup",
    "stop",
    "prepare",
    `switch:${targetRelease}`,
    "start",
    "ready"
  ]);
});

test("runtime update restores the backup and previous release after a failed readiness check", async () => {
  const events: string[] = [];
  let readinessChecks = 0;
  const configured = operations(events);
  configured.waitForReadiness = async () => {
    events.push("ready");
    readinessChecks += 1;
    if (readinessChecks === 1) throw new Error("new runtime is unhealthy");
  };

  const result = await executeRuntimeUpdate({ request, previousRelease, operations: configured });

  assert.equal(result.status, "ROLLED_BACK");
  assert.equal(result.backupId, backup.backupId);
  assert.equal(result.recovered, true);
  assert.match(result.error || "", /new runtime is unhealthy/);
  assert.deepEqual(events.slice(-6), [
    "update-error:new runtime is unhealthy",
    "stop",
    `restore:${backup.manifestPath}`,
    `switch:${previousRelease}`,
    "start",
    "ready"
  ]);
  assert.ok(events.includes(`restore:${backup.manifestPath}`));
  assert.deepEqual(events.filter((event) => event.startsWith("switch:")), [
    `switch:${targetRelease}`,
    `switch:${previousRelease}`
  ]);
});

test("runtime update restarts the previous release when preparation fails before switching", async () => {
  const events: string[] = [];
  const configured = operations(events);
  configured.prepareRelease = async () => {
    events.push("prepare");
    throw new Error("artifact preparation failed");
  };

  const result = await executeRuntimeUpdate({ request, previousRelease, operations: configured });

  assert.equal(result.status, "FAILED");
  assert.equal(result.recovered, true);
  assert.equal(result.switched, false);
  assert.equal(events.includes(`restore:${backup.manifestPath}`), false);
  assert.deepEqual(events.slice(-2), ["start", "ready"]);
});

test("runtime update reports a failed recovery when backup restoration fails", async () => {
  const events: string[] = [];
  let readinessChecks = 0;
  const configured = operations(events);
  configured.waitForReadiness = async () => {
    events.push("ready");
    readinessChecks += 1;
    if (readinessChecks === 1) throw new Error("new runtime is unhealthy");
  };
  configured.restoreBackup = async () => {
    events.push("restore-failed");
    throw new Error("backup could not be restored");
  };

  const result = await executeRuntimeUpdate({ request, previousRelease, operations: configured });

  assert.equal(result.status, "FAILED");
  assert.equal(result.recovered, false);
  assert.match(result.error || "", /Rollback failed: backup could not be restored/);
  assert.ok(events.includes("rollback-error"));
});

function operations(events: string[]) {
  return {
    beforeApply: async () => { events.push("before"); },
    createBackup: async () => {
      events.push("backup");
      return backup;
    },
    afterBackup: async () => { events.push("after-backup"); },
    stopRuntime: async () => { events.push("stop"); },
    prepareRelease: async () => {
      events.push("prepare");
      return targetRelease;
    },
    switchCurrent: async (release: string) => { events.push(`switch:${release}`); },
    startRuntime: async () => { events.push("start"); },
    waitForReadiness: async () => { events.push("ready"); },
    restoreBackup: async (manifestPath: string) => { events.push(`restore:${manifestPath}`); },
    onUpdateError: (message: string) => { events.push(`update-error:${message}`); },
    onRollbackError: () => { events.push("rollback-error"); }
  };
}
