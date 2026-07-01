import type { AppModule, ModuleContext } from "../../core/types/module.js";
import { sendSuccess } from "../../core/http/response.js";
import { asyncHandler } from "../../core/http/async-handler.js";

type CheckStatus = "pass" | "fail" | "skipped";

type ReadinessCheck = {
  status: CheckStatus;
  message?: string;
  details?: Record<string, unknown>;
};

type ReadinessChecks = Record<"database" | "storage" | "email", ReadinessCheck>;

function storageReadinessCheck(context: ModuleContext): ReadinessCheck {
  const storage = context.config.storage;

  if (storage.driver === "disabled") {
    return context.config.isProduction
      ? { status: "fail", message: "Storage is disabled in production." }
      : { status: "skipped", message: "Storage is disabled for this runtime." };
  }

  if (storage.driver === "local") {
    return context.config.isProduction
      ? { status: "fail", message: "Local storage is not allowed in production." }
      : { status: "pass", message: "Local storage is configured for this runtime." };
  }

  const missingFields = [
    ["STORAGE_S3_ENDPOINT", storage.endpoint],
    ["STORAGE_S3_BUCKET", storage.bucket],
    ["STORAGE_S3_ACCESS_KEY_ID", storage.accessKeyId],
    ["STORAGE_S3_SECRET_ACCESS_KEY", storage.secretAccessKey]
  ]
    .filter(([, value]) => !value)
    .map(([field]) => field);

  if (missingFields.length > 0) {
    return {
      status: "fail",
      message: "S3 storage configuration is incomplete.",
      details: { missingFields }
    };
  }

  return { status: "pass" };
}

function emailReadinessCheck(context: ModuleContext): ReadinessCheck {
  const email = context.config.email;

  if (email.driver === "disabled") {
    const needsShopEmail = context.config.app.mode === "shop" || context.config.features.orders;

    return context.config.isProduction && needsShopEmail
      ? { status: "fail", message: "Shop order email delivery is disabled in production." }
      : { status: "skipped", message: "Transactional email is disabled for this runtime." };
  }

  const missingFields = [
    ["EMAIL_FROM", email.from],
    ["EMAIL_HTTP_ENDPOINT", email.httpEndpoint]
  ]
    .filter(([, value]) => !value)
    .map(([field]) => field);

  if (missingFields.length > 0) {
    return {
      status: "fail",
      message: "Transactional email configuration is incomplete.",
      details: { missingFields }
    };
  }

  return { status: "pass" };
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
        const checks: ReadinessChecks = {
          database: { status: "pass" },
          storage: storageReadinessCheck(context),
          email: emailReadinessCheck(context)
        };

        try {
          await context.prisma.$queryRaw`SELECT 1`;
        } catch (error) {
          checks.database = {
            status: "fail",
            message: "Database query failed.",
            details: {
              error: error instanceof Error ? error.message : "Unknown database error."
            }
          };
        }

        const ready = Object.values(checks).every((check) => check.status !== "fail");
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
          }
        });
      })
    );
  }
};
