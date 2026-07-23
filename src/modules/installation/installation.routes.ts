import { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import type { AppConfig } from "../../config/index.js";
import { asyncHandler } from "../../core/http/async-handler.js";
import { sendSuccess } from "../../core/http/response.js";
import { validateRequest } from "../../core/http/validation.middleware.js";
import type { AppLogger } from "../../infrastructure/logging/logger.js";
import type { PrismaClient } from "@prisma/client";
import { completeInstallationSchema } from "./installation.schemas.js";
import { InstallationService } from "./installation.service.js";

type InstallationContext = {
  config: AppConfig;
  prisma: PrismaClient;
  logger: AppLogger;
};

export function createInstallationRouter(context: InstallationContext) {
  const router = Router();
  const service = new InstallationService(context.prisma, context.config);
  const completeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skipSuccessfulRequests: true
  });

  router.get(
    "/status",
    asyncHandler(async (_req, res) => sendSuccess(res, await service.status()))
  );
  router.post(
    "/complete",
    completeLimiter,
    validateRequest({ body: completeInstallationSchema }),
    asyncHandler(async (req, res) => {
      const result = await service.complete(req.body, {
        ipAddress: req.ip,
        userAgent: req.header("user-agent"),
        requestId: req.requestId
      });

      return sendSuccess(res, result, undefined, 201);
    })
  );

  return { router, service };
}

export function createInstallationGate(service: InstallationService, config: AppConfig) {
  let cachedInstalled = false;
  let cacheExpiresAt = 0;

  return async function installationGate(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    if (isInstallationSafePath(req.path, config.api.prefix)) {
      next();
      return;
    }

    try {
      if (!cachedInstalled || Date.now() >= cacheExpiresAt) {
        const status = await service.status();
        cachedInstalled = status.installed;
        cacheExpiresAt = cachedInstalled ? Date.now() + 60_000 : 0;
      }
      if (cachedInstalled) {
        next();
        return;
      }

      const apiRequest = req.path === config.api.prefix || req.path.startsWith(`${config.api.prefix}/`);
      if (!apiRequest && req.method === "GET" && req.accepts("html")) {
        res.redirect(302, "/install");
        return;
      }

      res.status(503).json({
        success: false,
        data: null,
        error: {
          code: "installation_required",
          message: "Complete CodeY CMS setup before using this endpoint.",
          details: null
        },
        meta: {
          requestId: res.locals.requestId,
          traceId: res.locals.traceId
        }
      });
    } catch (error) {
      next(error);
    }
  };
}

function isInstallationSafePath(requestPath: string, apiPrefix: string) {
  return requestPath === "/install" ||
    requestPath === "/install.html" ||
    requestPath === "/favicon.ico" ||
    requestPath.startsWith("/styles/") ||
    requestPath.startsWith("/web/install") ||
    requestPath.startsWith(`${apiPrefix}/install`) ||
    requestPath.startsWith(`${apiPrefix}/health`);
}
