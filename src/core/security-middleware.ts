import type { PrismaClient } from "@prisma/client";
import cors from "cors";
import type { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import type { AppConfig } from "../config/index.js";
import { safeWriteAuditLog } from "./audit/audit-log.js";

export function normalizeAllowedOrigin(origin: string | undefined) {
  if (!origin) return undefined;

  try {
    return new URL(origin).origin;
  } catch {
    return origin.replace(/\/+$/, "");
  }
}

function createCorsOptions(config: AppConfig) {
  const allowedOrigins = new Set(
    [...config.cors.origins, config.app.publicUrl]
      .map(normalizeAllowedOrigin)
      .filter((origin): origin is string => Boolean(origin))
  );

  if (!config.isProduction) {
    allowedOrigins.add(`http://localhost:${config.api.port}`);
    allowedOrigins.add(`http://127.0.0.1:${config.api.port}`);
  }

  return {
    origin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
      const normalizedOrigin = normalizeAllowedOrigin(origin);

      if (!normalizedOrigin || allowedOrigins.size === 0 || allowedOrigins.has(normalizedOrigin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: true
  };
}

function createRateLimiter(
  config: AppConfig,
  prisma: PrismaClient,
  code: string,
  message: string,
  limit: number,
  options: { writeOnly?: boolean } = {}
) {
  return rateLimit({
    windowMs: config.rateLimits.platform.windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      if (!config.rateLimits.platform.enabled) return true;
      if (!options.writeOnly) return false;
      return !["POST", "PUT", "PATCH", "DELETE"].includes(req.method.toUpperCase());
    },
    handler: (req: Request, res: Response) => {
      const rateLimitInfo = (req as Request & {
        rateLimit?: { limit: number; used: number };
      }).rateLimit;
      if (!rateLimitInfo || rateLimitInfo.used === rateLimitInfo.limit + 1) {
        void safeWriteAuditLog(prisma, {
          actorUserId: req.user?.id,
          action: "rate_limit.exceeded",
          subject: "api",
          ipAddress: req.ip,
          userAgent: req.header("user-agent"),
          requestId: req.requestId,
          outcome: "DENIED",
          severity: "HIGH",
          metadata: {
            code,
            method: req.method,
            path: req.originalUrl.split("?", 1)[0],
            windowMs: config.rateLimits.platform.windowMs,
            limit
          }
        });
      }
      res.status(429).json({
        success: false,
        data: null,
        error: {
          code,
          message,
          details: {
            windowMs: config.rateLimits.platform.windowMs,
            limit
          }
        },
        meta: {
          requestId: res.locals.requestId
        }
      });
    }
  });
}

function createHelmetOptions(config: AppConfig) {
  const openerPolicy = config.features.payments
    ? "same-origin-allow-popups" as const
    : "same-origin" as const;
  const stripeScriptSources = [
    "https://js.stripe.com",
    "https://*.js.stripe.com",
    "https://maps.googleapis.com"
  ];
  const stripeFrameSources = [
    "https://js.stripe.com",
    "https://*.js.stripe.com",
    "https://hooks.stripe.com"
  ];
  const contentSecurityPolicyDirectives = {
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "script-src": ["'self'", ...(config.features.payments ? stripeScriptSources : [])],
    "connect-src": [
      "'self'",
      "blob:",
      ...(config.features.payments ? ["https://api.stripe.com", "https://maps.googleapis.com"] : [])
    ],
    "frame-src": ["'self'", "blob:", ...(config.features.payments ? stripeFrameSources : [])],
    "child-src": ["'self'", "blob:", ...(config.features.payments ? stripeFrameSources : [])],
    ...(config.env === "production" ? {} : { "upgrade-insecure-requests": null })
  };

  return {
    contentSecurityPolicy: {
      directives: contentSecurityPolicyDirectives
    },
    crossOriginOpenerPolicy: {
      policy: openerPolicy
    }
  };
}

export function createPlatformSecurityMiddleware(config: AppConfig, prisma: PrismaClient) {
  const writeLimiter = { writeOnly: true };

  return {
    cors: cors(createCorsOptions(config)),
    headers: helmet(createHelmetOptions(config)),
    apiLimiter: createRateLimiter(
      config,
      prisma,
      "rate_limit_exceeded",
      "Too many API requests.",
      config.rateLimits.platform.apiMax
    ),
    authLimiter: createRateLimiter(
      config,
      prisma,
      "auth_rate_limit_exceeded",
      "Too many authentication attempts.",
      config.rateLimits.platform.authMax,
      writeLimiter
    ),
    adminWriteLimiter: createRateLimiter(
      config,
      prisma,
      "admin_write_rate_limit_exceeded",
      "Too many admin write requests. Please wait before trying again.",
      config.rateLimits.platform.adminMax,
      writeLimiter
    )
  };
}
