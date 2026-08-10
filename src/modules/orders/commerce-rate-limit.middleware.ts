import type { RequestHandler } from "express";
import type { ModuleContext } from "../../core/types/module.js";
import { AppError } from "../../core/errors/app-error.js";
import { CommerceAbuseService, type CommerceRateScope } from "./commerce-abuse.service.js";

export function createSharedCommerceLimiter(
  context: ModuleContext,
  scope: CommerceRateScope
): RequestHandler {
  const service = new CommerceAbuseService(context.prisma, context.config);

  return (req, res, next) => {
    void service.consumeRateLimit(scope, req.ip || req.socket.remoteAddress || "unknown")
      .then((result) => {
        res.setHeader("RateLimit-Limit", String(result.limit));
        res.setHeader("RateLimit-Remaining", String(result.remaining));
        res.setHeader("RateLimit-Reset", String(result.retryAfterSeconds));
        next();
      })
      .catch((error: unknown) => {
        if (error instanceof AppError && error.statusCode === 429) {
          const retryAfterSeconds = !Array.isArray(error.details)
            ? error.details?.retryAfterSeconds
            : undefined;
          if (typeof retryAfterSeconds === "number") {
            res.setHeader("Retry-After", String(retryAfterSeconds));
          }
        }
        next(error);
      });
  };
}
