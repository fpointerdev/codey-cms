import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../config/index.js";
import { AppError } from "../core/errors/app-error.js";
import type { AppLogger } from "../infrastructure/logging/logger.js";
import { RuntimeUpdateService } from "./runtime-update.service.js";

type SchedulerContext = {
  prisma: PrismaClient;
  config: AppConfig;
  logger: AppLogger;
};

export function startRuntimeUpdateScheduler(context: SchedulerContext) {
  if (!context.config.updates.enabled || !context.config.updates.autoApply) {
    return () => undefined;
  }

  const service = new RuntimeUpdateService(context.prisma, context.config, context.logger);
  const intervalMs = context.config.updates.checkIntervalHours * 60 * 60 * 1000;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const schedule = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(run, delay);
    timer.unref();
  };
  const run = async () => {
    try {
      const result = await service.stageLatest();
      context.logger.info(
        { staged: result.staged, latestVersion: result.latestVersion },
        result.staged ? "Automatic runtime update staged" : "Automatic runtime update check complete"
      );
    } catch (error) {
      const expectedConflict = error instanceof AppError && [
        "installation_required",
        "runtime_update_active",
        "release_key_missing"
      ].includes(error.code);
      const log = expectedConflict ? context.logger.info.bind(context.logger) : context.logger.warn.bind(context.logger);
      log(
        { err: error },
        expectedConflict ? "Automatic runtime update deferred" : "Automatic runtime update check failed"
      );
    } finally {
      schedule(intervalMs);
    }
  };

  schedule(60_000);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
