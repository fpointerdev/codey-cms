import type { RequestHandler } from "express";
import type { ModuleContext } from "../../core/types/module.js";
import { AppError } from "../../core/errors/app-error.js";
import { asyncHandler } from "../../core/http/async-handler.js";
import { AuthService } from "./auth.service.js";
import type { AuthenticatedUser } from "./auth.types.js";
import { safeWriteAuditLog } from "../../core/audit/audit-log.js";

function readBearerToken(header?: string) {
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

export function requireAuth(context: ModuleContext): RequestHandler {
  const authService = new AuthService(context.prisma, context.config);

  return asyncHandler(async (req, _res, next) => {
    const token = readBearerToken(req.header("authorization"));
    if (!token) {
      throw new AppError(401, "unauthorized", "Authentication required.");
    }

    req.user = await authService.verifyAccessToken(token);
    next();
  });
}

export function optionalAuth(context: ModuleContext): RequestHandler {
  const authService = new AuthService(context.prisma, context.config);

  return asyncHandler(async (req, _res, next) => {
    const token = readBearerToken(req.header("authorization"));
    if (token) {
      req.user = await authService.verifyAccessToken(token);
    }

    next();
  });
}

export function hasPermission(
  user: AuthenticatedUser | undefined,
  action: string,
  subject: string
) {
  return user?.permissions.some((permission) => {
    const exactMatch = permission.action === action && permission.subject === subject;
    const globalMatch = permission.action === "manage" && permission.subject === "all";
    return exactMatch || globalMatch;
  }) ?? false;
}

export function assertRecentSensitiveAuthentication(
  user: AuthenticatedUser | undefined,
  now = Date.now(),
  maximumAgeMs = 15 * 60_000
) {
  if (!user) {
    throw new AppError(401, "unauthorized", "Authentication required.");
  }
  const verifiedAt = user.mfaEnabled ? user.mfaVerifiedAt : user.authenticatedAt;
  const code = user.mfaEnabled ? "recent_mfa_required" : "recent_authentication_required";
  const message = user.mfaEnabled
    ? "Sign in with two-step verification again before changing secrets."
    : "Sign in again before changing secrets.";
  if (!verifiedAt || verifiedAt.getTime() < now - maximumAgeMs) {
    throw new AppError(403, code, message);
  }
}

export function requirePermission(
  context: ModuleContext,
  action: string,
  subject: string
): RequestHandler[] {
  return [
    requireAuth(context),
    asyncHandler(async (req, _res, next) => {
      if (!hasPermission(req.user, action, subject)) {
        await safeWriteAuditLog(context.prisma, {
          actorUserId: req.user?.id,
          action: "authorization.denied",
          subject,
          ipAddress: req.ip,
          userAgent: req.header("user-agent"),
          requestId: req.requestId,
          outcome: "DENIED",
          severity: "HIGH",
          metadata: {
            requiredAction: action,
            method: req.method,
            path: req.originalUrl.split("?", 1)[0]
          }
        });
        throw new AppError(403, "forbidden", "You do not have permission to perform this action.");
      }

      next();
    })
  ];
}
