import type { Response, Router } from "express";
import type { ModuleContext } from "../../core/types/module.js";
import { AppError } from "../../core/errors/app-error.js";
import { asyncHandler } from "../../core/http/async-handler.js";
import { sendSuccess } from "../../core/http/response.js";
import { validateRequest } from "../../core/http/validation.middleware.js";
import { AuthService } from "./auth.service.js";
import {
  acceptInviteSchema,
  changePasswordSchema,
  confirmEmailVerificationSchema,
  confirmPasswordResetSchema,
  createInviteSchema,
  inviteIdParams,
  listInvitesQuery,
  loginSchema,
  logoutSchema,
  mfaConfirmSchema,
  mfaDisableSchema,
  mfaSetupSchema,
  refreshSchema,
  registerSchema,
  requestEmailVerificationSchema,
  requestPasswordResetSchema
} from "./auth.schemas.js";
import { requireAuth, requirePermission } from "./auth.middleware.js";
import {
  clearRefreshTokenCookie,
  exposeAccessToken,
  refreshTokenFromRequest
} from "./auth-session-cookie.js";
import type { TokenPair } from "./auth.types.js";

function requestMeta(req: {
  header: (name: string) => string | undefined;
  ip?: string;
  requestId?: string;
}) {
  return {
    userAgent: req.header("user-agent"),
    ipAddress: req.ip,
    requestId: req.requestId
  };
}

function secureSessionResult<T extends { tokens: TokenPair | null }>(
  res: Response,
  result: T,
  context: ModuleContext
) {
  if (!result.tokens) return result;

  return {
    ...result,
    tokens: exposeAccessToken(res, result.tokens, context.config)
  };
}

export function registerAuthRoutes(router: Router, context: ModuleContext) {
  const authService = new AuthService(context.prisma, context.config);

  router.post(
    "/register",
    validateRequest({ body: registerSchema }),
    asyncHandler(async (req, res) => {
      const result = await authService.register(req.body, requestMeta(req));
      return sendSuccess(res, secureSessionResult(res, result, context), undefined, 201);
    })
  );

  router.post(
    "/login",
    validateRequest({ body: loginSchema }),
    asyncHandler(async (req, res) => {
      const result = await authService.login(req.body, requestMeta(req));
      return sendSuccess(res, secureSessionResult(res, result, context));
    })
  );

  router.post(
    "/refresh",
    validateRequest({ body: refreshSchema }),
    asyncHandler(async (req, res) => {
      const refreshToken = refreshTokenFromRequest(req);
      if (!refreshToken) {
        throw new AppError(401, "invalid_refresh_token", "Refresh token is invalid or expired.");
      }

      const result = await authService.refresh(refreshToken, requestMeta(req));
      return sendSuccess(res, secureSessionResult(res, result, context));
    })
  );

  router.post(
    "/logout",
    validateRequest({ body: logoutSchema }),
    asyncHandler(async (req, res) => {
      const refreshToken = refreshTokenFromRequest(req);
      if (refreshToken) await authService.logout(refreshToken, requestMeta(req));
      clearRefreshTokenCookie(res, context.config);
      return sendSuccess(res, { loggedOut: true });
    })
  );

  router.post(
    "/password-reset/request",
    validateRequest({ body: requestPasswordResetSchema }),
    asyncHandler(async (req, res) => {
      const result = await authService.requestPasswordReset(req.body, requestMeta(req));
      return sendSuccess(res, result);
    })
  );

  router.post(
    "/password-reset/confirm",
    validateRequest({ body: confirmPasswordResetSchema }),
    asyncHandler(async (req, res) => {
      const result = await authService.confirmPasswordReset(req.body, requestMeta(req));
      clearRefreshTokenCookie(res, context.config);
      return sendSuccess(res, result);
    })
  );

  router.post(
    "/email-verification/request",
    validateRequest({ body: requestEmailVerificationSchema }),
    asyncHandler(async (req, res) => {
      const result = await authService.requestEmailVerification(req.body, requestMeta(req));
      return sendSuccess(res, result);
    })
  );

  router.post(
    "/email-verification/confirm",
    validateRequest({ body: confirmEmailVerificationSchema }),
    asyncHandler(async (req, res) => {
      const result = await authService.confirmEmailVerification(req.body, requestMeta(req));
      return sendSuccess(res, result);
    })
  );

  router.post(
    "/invites",
    requirePermission(context, "invite", "users"),
    validateRequest({ body: createInviteSchema }),
    asyncHandler(async (req, res) => {
      const result = await authService.createInvite(req.body, {
        actorUserId: req.user!.id,
        actorPermissions: req.user!.permissions,
        ...requestMeta(req)
      });
      return sendSuccess(res, result, undefined, 201);
    })
  );

  router.get(
    "/invites",
    requirePermission(context, "invite", "users"),
    validateRequest({ query: listInvitesQuery }),
    asyncHandler(async (req, res) => {
      const result = await authService.listInvites(req.query as unknown as {
        page: number;
        limit: number;
        search?: string;
        status?: "PENDING" | "ACCEPTED" | "REVOKED";
      });
      return sendSuccess(res, result, result.pagination);
    })
  );

  router.post(
    "/invites/:id/resend",
    requirePermission(context, "invite", "users"),
    validateRequest({ params: inviteIdParams }),
    asyncHandler(async (req, res) => {
      const result = await authService.resendInvite(req.params.id, {
        actorUserId: req.user!.id,
        actorPermissions: req.user!.permissions,
        ...requestMeta(req)
      });
      return sendSuccess(res, result);
    })
  );

  router.delete(
    "/invites/:id",
    requirePermission(context, "invite", "users"),
    validateRequest({ params: inviteIdParams }),
    asyncHandler(async (req, res) => {
      const invite = await authService.revokeInvite(req.params.id, {
        actorUserId: req.user!.id,
        actorPermissions: req.user!.permissions,
        ...requestMeta(req)
      });
      return sendSuccess(res, { revoked: true, invite });
    })
  );

  router.post(
    "/invites/accept",
    validateRequest({ body: acceptInviteSchema }),
    asyncHandler(async (req, res) => {
      const result = await authService.acceptInvite(req.body, requestMeta(req));
      return sendSuccess(res, secureSessionResult(res, result, context), undefined, 201);
    })
  );

  router.patch(
    "/password",
    requireAuth(context),
    validateRequest({ body: changePasswordSchema }),
    asyncHandler(async (req, res) => {
      const result = await authService.changePassword(req.user!.id, req.body, requestMeta(req));
      return sendSuccess(res, secureSessionResult(res, result, context));
    })
  );

  router.delete(
    "/sessions",
    requireAuth(context),
    asyncHandler(async (req, res) => {
      const result = await authService.revokeAllSessions(req.user!.id, requestMeta(req));
      clearRefreshTokenCookie(res, context.config);
      return sendSuccess(res, result);
    })
  );

  router.get(
    "/mfa",
    requireAuth(context),
    asyncHandler(async (req, res) => {
      return sendSuccess(res, { mfa: await authService.mfaStatus(req.user!.id) });
    })
  );

  router.post(
    "/mfa/setup",
    requireAuth(context),
    validateRequest({ body: mfaSetupSchema }),
    asyncHandler(async (req, res) => {
      const setup = await authService.beginMfaSetup(req.user!.id, req.body, requestMeta(req));
      return sendSuccess(res, { setup });
    })
  );

  router.post(
    "/mfa/confirm",
    requireAuth(context),
    validateRequest({ body: mfaConfirmSchema }),
    asyncHandler(async (req, res) => {
      const result = await authService.confirmMfaSetup(req.user!.id, req.body, requestMeta(req));
      return sendSuccess(res, secureSessionResult(res, result, context));
    })
  );

  router.delete(
    "/mfa",
    requireAuth(context),
    validateRequest({ body: mfaDisableSchema }),
    asyncHandler(async (req, res) => {
      const result = await authService.disableMfa(req.user!.id, req.body, requestMeta(req));
      return sendSuccess(res, secureSessionResult(res, result, context));
    })
  );

  router.get(
    "/me",
    requireAuth(context),
    asyncHandler(async (req, res) => {
      return sendSuccess(res, { user: req.user });
    })
  );
}
