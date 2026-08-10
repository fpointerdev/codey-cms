import type { AppModule, ModuleContext } from "../../core/types/module.js";
import { sendSuccess } from "../../core/http/response.js";
import { asyncHandler } from "../../core/http/async-handler.js";
import { EmailSettingsService } from "../../infrastructure/email/email-settings.service.js";
import { readBackupHealth } from "../../infrastructure/operations/backup-status.js";
import { createStorageAdapter } from "../../infrastructure/storage/s3-storage.js";
import { requirePermission } from "../auth/auth.middleware.js";
import { inventoryReservationDiagnostics } from "../orders/inventory-reservation.service.js";

type CheckStatus = "pass" | "fail" | "skipped";

type ReadinessCheck = {
  status: CheckStatus;
  blocking: boolean;
  message?: string;
  details?: Record<string, unknown>;
};

async function runtimeReadiness(context: ModuleContext) {
  const [database, storage, email] = await Promise.all([
    databaseReadinessCheck(context),
    storageReadinessCheck(context),
    emailReadinessCheck(context)
  ]);
  const checks = { database, storage, email };

  return {
    ready: Object.values(checks).every(
      (check) => check.status !== "fail" || !check.blocking
    ),
    checks
  };
}

async function runtimeDiagnostics(context: ModuleContext) {
  const [runtime, backup, inventory] = await Promise.all([
    runtimeReadiness(context),
    readBackupHealth(context.config.backup),
    context.config.features.orders
      ? inventoryReservationDiagnostics(context)
      : Promise.resolve({ status: "skipped", blocking: false })
  ]);
  const operationallyHealthy = runtime.ready && (backup.status !== "fail" || !backup.blocking);

  return {
    ready: runtime.ready,
    operationallyHealthy,
    checks: { ...runtime.checks, backup },
    inventory
  };
}

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
        return sendSuccess(res, { status: "ok" });
      })
    );

    router.get(
      "/ready",
      asyncHandler(async (_req, res) => {
        const { ready } = await runtimeReadiness(context);
        const data = { status: ready ? "ready" : "not_ready" };

        if (ready) {
          return sendSuccess(res, data);
        }

        return res.status(503).json({
          success: false,
          data,
          error: {
            code: "runtime_not_ready",
            message: "Runtime readiness checks failed.",
            details: null
          },
          meta: {
            requestId: res.locals.requestId,
            traceId: res.locals.traceId
          }
        });
      })
    );

    router.get(
      "/diagnostics",
      requirePermission(context, "manage", "modules"),
      asyncHandler(async (_req, res) => {
        const diagnostics = await runtimeDiagnostics(context);
        const memory = process.memoryUsage();

        return sendSuccess(res, {
          status: diagnostics.operationallyHealthy ? "healthy" : "attention",
          runtime: {
            status: diagnostics.ready ? "ready" : "not_ready",
            app: context.config.app.name,
            mode: context.config.app.mode,
            env: context.config.env,
            checks: {
              database: diagnostics.checks.database,
              storage: diagnostics.checks.storage,
              email: diagnostics.checks.email
            }
          },
          operations: {
            backup: diagnostics.checks.backup,
            inventory: diagnostics.inventory
          },
          metrics: {
            uptimeSeconds: Math.round(process.uptime()),
            memory: {
              rssBytes: memory.rss,
              heapTotalBytes: memory.heapTotal,
              heapUsedBytes: memory.heapUsed,
              externalBytes: memory.external
            },
            node: process.version
          }
        });
      })
    );

    router.get(
      "/metrics",
      requirePermission(context, "manage", "modules"),
      asyncHandler(async (_req, res) => {
        const memory = process.memoryUsage();
        const [backup, inventory] = await Promise.all([
          readBackupHealth(context.config.backup),
          context.config.features.orders
            ? inventoryReservationDiagnostics(context)
            : Promise.resolve({ status: "skipped", blocking: false })
        ]);

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
          operations: { backup, inventory }
        });
      })
    );
  }
};
