import { Prisma } from "@prisma/client";
import type { RequestHandler } from "express";
import type { AppConfig } from "../../config/index.js";
import type { AppLogger } from "../../infrastructure/logging/logger.js";
import type { PrismaClient } from "@prisma/client";
import { asyncHandler } from "./async-handler.js";

type MaintenanceSettings = {
  enabled?: boolean;
  message?: string;
  allowedPaths?: string[];
};

const defaultAllowedPaths = ["/health", "/auth", "/config"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMaintenanceSettings(value: unknown): MaintenanceSettings {
  if (!isRecord(value)) return {};

  return {
    enabled: value.enabled === true,
    message: typeof value.message === "string" ? value.message : undefined,
    allowedPaths: Array.isArray(value.allowedPaths)
      ? value.allowedPaths.filter((item): item is string => typeof item === "string")
      : undefined
  };
}

function isAllowedPath(path: string, apiPrefix: string, allowedPaths: string[]) {
  const normalized = path.startsWith(apiPrefix) ? path.slice(apiPrefix.length) || "/" : path;

  return allowedPaths.some((allowedPath) => {
    if (allowedPath === "/") return normalized === "/";
    return normalized === allowedPath || normalized.startsWith(`${allowedPath}/`);
  });
}

function resolveMaintenanceSettings(config: AppConfig, dbMaintenance: MaintenanceSettings) {
  const dbEnabled = dbMaintenance.enabled === true;
  const enabled = config.maintenance.enabled || dbEnabled;

  return {
    enabled,
    message: dbEnabled
      ? dbMaintenance.message ?? config.maintenance.message
      : config.maintenance.message,
    allowedPaths: dbEnabled
      ? dbMaintenance.allowedPaths ?? config.maintenance.allowedPaths
      : config.maintenance.allowedPaths,
    forcedByEnv: config.maintenance.enabled
  };
}

export function createMaintenanceMiddleware(input: {
  config: AppConfig;
  prisma: PrismaClient;
  logger: AppLogger;
}): RequestHandler {
  return asyncHandler(async (req, res, next) => {
    try {
      const envMaintenance: MaintenanceSettings = input.config.maintenance.enabled
        ? {
            enabled: true,
            message: input.config.maintenance.message,
            allowedPaths: input.config.maintenance.allowedPaths
          }
        : {};
      const setting = await input.prisma.moduleSetting.findFirst({
        where: {
          moduleId: "config",
          key: "maintenance",
          site: {
            slug: "default"
          }
        },
        select: {
          value: true
        }
      });
      const dbMaintenance = parseMaintenanceSettings(setting?.value);
      const maintenance = resolveMaintenanceSettings(input.config, {
        ...envMaintenance,
        ...dbMaintenance,
        allowedPaths: dbMaintenance.allowedPaths ?? envMaintenance.allowedPaths ?? defaultAllowedPaths
      });

      if (!maintenance.enabled || isAllowedPath(req.path, input.config.api.prefix, maintenance.allowedPaths)) {
        next();
        return;
      }

      res.setHeader("retry-after", "300");
      res.setHeader("x-maintenance-mode", "true");
      res.status(503).json({
        success: false,
        data: {
          maintenance: true
        },
        error: {
          code: "maintenance_mode",
          message: maintenance.message ?? "This site is temporarily unavailable for maintenance.",
          details: null
        },
        meta: {
          requestId: res.locals.requestId,
          traceId: res.locals.traceId
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
        next();
        return;
      }

      input.logger.error({ err: error, requestId: res.locals.requestId }, "Maintenance check failed");
      next(error);
    }
  });
}
