import type { RequestHandler } from "express";
import type { ModuleContext } from "../../core/types/module.js";
import { AppError } from "../../core/errors/app-error.js";
import { asyncHandler } from "../../core/http/async-handler.js";
import { AuthService } from "./auth.service.js";
import type { AuthenticatedUser } from "./auth.types.js";

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

export function requirePermission(
  context: ModuleContext,
  action: string,
  subject: string
): RequestHandler[] {
  return [
    requireAuth(context),
    (req, _res, next) => {
      if (!hasPermission(req.user, action, subject)) {
        throw new AppError(403, "forbidden", "You do not have permission to perform this action.");
      }

      next();
    }
  ];
}
