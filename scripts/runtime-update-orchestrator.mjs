export async function executeRuntimeUpdate({ request, previousRelease, operations }) {
  let switched = false;
  let runtimeStopped = false;
  let backupId;
  let backupManifestPath;
  let targetRelease;

  try {
    await operations.beforeApply();
    const backup = await operations.createBackup();
    backupId = backup.backupId;
    backupManifestPath = backup.manifestPath;
    await operations.afterBackup(backup);

    await operations.stopRuntime();
    runtimeStopped = true;
    targetRelease = await operations.prepareRelease(previousRelease, request);
    await operations.switchCurrent(targetRelease);
    switched = true;
    await operations.startRuntime();
    runtimeStopped = false;
    await operations.waitForReadiness();

    return {
      status: "SUCCEEDED",
      backupId,
      targetRelease
    };
  } catch (error) {
    let message = errorMessage(error);
    operations.onUpdateError?.(message, error);
    let recovered = false;

    if (runtimeStopped || switched) {
      try {
        if (switched) {
          await operations.stopRuntime();
          if (!backupManifestPath) throw new Error("The rollback backup manifest is unavailable.");
          await operations.restoreBackup(backupManifestPath);
          await operations.switchCurrent(previousRelease);
        }
        await operations.startRuntime();
        runtimeStopped = false;
        await operations.waitForReadiness();
        recovered = true;
      } catch (rollbackError) {
        const rollbackMessage = errorMessage(rollbackError);
        message = `${message} Rollback failed: ${rollbackMessage}`;
        operations.onRollbackError?.(rollbackError);
      }
    }

    return {
      status: switched && recovered ? "ROLLED_BACK" : "FAILED",
      backupId,
      error: message,
      recovered,
      switched
    };
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
