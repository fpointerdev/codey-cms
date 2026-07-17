import type { AppModule, ModuleContext } from "../../core/types/module.js";
import { sendSuccess } from "../../core/http/response.js";
import { asyncHandler } from "../../core/http/async-handler.js";
import { EmailSettingsService } from "../../infrastructure/email/email-settings.service.js";
import { readBackupHealth } from "../../infrastructure/operations/backup-status.js";
import { createStorageAdapter } from "../../infrastructure/storage/s3-storage.js";

type CheckStatus = "pass" | "fail" | "skipped";

type ReadinessCheck = {
  status: CheckStatus;
  blocking: boolean;
  message?: string;
  details?: Record<string, unknown>;
};

type ReadinessChecks = Record<"database" | "storage" | "email" | "backup", ReadinessCheck>;

async function databaseReadinessCheck(context: ModuleContext): Promise<ReadinessCheck> {
  try {
    await context.prisma.$queryRaw`SELECT 1`;
    return { status: "pass", blocking: true };
  } catch (error) {
    return {
      status: "fail",
      blocking: true,
      message: "Database query failed.",
      details: {
        error: error instanceof Error ? error.message : "Unknown database error."
      }
    };
  }
}

async function storageReadinessCheck(context: ModuleContext): Promise<ReadinessCheck> {
  const storage = context.config.storage;

  if (storage.driver === "disabled") {
    return context.config.isProduction
      ? { status: "fail", blocking: true, message: "Storage is disabled in production." }
      : { status: "skipped", blocking: false, message: "Storage is disabled for this runtime." };
  }

  try {
    await createStorageAdapter(storage).checkConnection();
    return {
      status: "pass",
      blocking: true,
      details: { driver: storage.driver }
    };
  } catch (error) {
    return {
      status: "fail",
      blocking: true,
      message: "Storage connectivity check failed.",
      details: {
        driver: storage.driver,
        error: error instanceof Error ? error.message : "Unknown storage error."
      }
    };
  }
}

async function emailReadinessCheck(context: ModuleContext): Promise<ReadinessCheck> {
  const required =
    context.config.auth.recoveryTokenDelivery === "email" ||
    context.config.isProduction && (
      context.config.app.mode === "shop" ||
      context.config.features.orders
    );

  try {
    const status = await new EmailSettingsService(context.prisma, context.config).getAdminStatus();

    if (!status.configured) {
      return required
        ? { status: "fail", blocking: true, message: "Required transactional email is not configured." }
        : { status: "skipped", blocking: false, message: "Transactional email is not configured." };
    }

    if (status.lastTestSucceeded === false) {
      return {
        status: "fail",
        blocking: required,
        message: "The most recent transactional email test failed.",
        details: { source: status.source, lastTestedAt: status.lastTestedAt }
      };
    }
    if (context.config.isProduction && status.lastTestSucceeded !== true) {
      return {
        status: "fail",
        blocking: required,
        message: "Transactional email has not passed a provider test.",
        details: { source: status.source }
      };
    }

    return {
      status: "pass",
      blocking: required,
      details: {
        source: status.source,
        lastTestedAt: status.lastTestedAt
      }
    };
  } catch (error) {
    return {
      status: "fail",
      blocking: required,
      message: "Transactional email readiness check failed.",
      details: {
        error: error instanceof Error ? error.message : "Unknown email error."
      }
    };
  }
}

export const healthModule: AppModule = {
  id: "health",
  basePath: "/health",
  enabled: (config) => config.features.health,
  register: (router, context) => {
    router.get(
      "/",
      asyncHandler(async (_req, res) => {
        await context.prisma.$queryRaw`SELECT 1`;
        return sendSuccess(res, {
          status: "ok",
          app: context.config.app.name,
          mode: context.config.app.mode,
          env: context.config.env
        });
      })
    );

    router.get(
      "/ready",
      asyncHandler(async (_req, res) => {
        const [database, storage, email, backup] = await Promise.all([
          databaseReadinessCheck(context),
          storageReadinessCheck(context),
          emailReadinessCheck(context),
          readBackupHealth(context.config.backup)
        ]);
        const checks: ReadinessChecks = {
          database,
          storage,
          email,
          backup
        };

        const ready = Object.values(checks).every(
          (check) => check.status !== "fail" || !check.blocking
        );
        const data = {
          status: ready ? "ready" : "not_ready",
          app: context.config.app.name,
          mode: context.config.app.mode,
          env: context.config.env,
          checks
        };

        if (ready) {
          return sendSuccess(res, data);
        }

        return res.status(503).json({
          success: false,
          data,
          error: {
            code: "runtime_not_ready",
            message: "Runtime readiness checks failed.",
            details: checks
          },
          meta: {
            requestId: res.locals.requestId,
            traceId: res.locals.traceId
          }
        });
      })
    );

    router.get(
      "/metrics",
      asyncHandler(async (_req, res) => {
        const memory = process.memoryUsage();
        const backup = await readBackupHealth(context.config.backup);

        return sendSuccess(res, {
          status: "ok",
          uptimeSeconds: Math.round(process.uptime()),
          memory: {
            rssBytes: memory.rss,
            heapTotalBytes: memory.heapTotal,
            heapUsedBytes: memory.heapUsed,
            externalBytes: memory.external
          },
          runtime: {
            node: process.version,
            env: context.config.env,
            mode: context.config.app.mode
          },
          operations: { backup }
        });
      })
    );
  }
};
