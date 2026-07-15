import type { Router } from "express";
import type { ModuleContext } from "../../core/types/module.js";
import { asyncHandler } from "../../core/http/async-handler.js";
import { sendSuccess } from "../../core/http/response.js";
import { validateRequest } from "../../core/http/validation.middleware.js";
import { AuthService } from "./auth.service.js";
import {
  acceptInviteSchema,
  confirmEmailVerificationSchema,
  confirmPasswordResetSchema,
  createInviteSchema,
  inviteIdParams,
  listInvitesQuery,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  requestEmailVerificationSchema,
  requestPasswordResetSchema
} from "./auth.schemas.js";
import { requireAuth, requirePermission } from "./auth.middleware.js";

function requestMeta(req: { header: (name: string) => string | undefined; ip?: string }) {
  return {
    userAgent: req.header("user-agent"),
    ipAddress: req.ip
  };
}

export function registerAuthRoutes(router: Router, context: ModuleContext) {
  const authService = new AuthService(context.prisma, context.config);

  router.post(
    "/register",
    validateRequest({ body: registerSchema }),
    asyncHandler(async (req, res) => {
      const result = await authService.register(req.body, requestMeta(req));
      return sendSuccess(res, result, undefined, 201);
    })
  );

  router.post(
    "/login",
    validateRequest({ body: loginSchema }),
    asyncHandler(async (req, res) => {
      const result = await authService.login(req.body, requestMeta(req));
      return sendSuccess(res, result);
    })
  );

  router.post(
    "/refresh",
    validateRequest({ body: refreshSchema }),
    asyncHandler(async (req, res) => {
      const result = await authService.refresh(req.body.refreshToken, requestMeta(req));
      return sendSuccess(res, result);
    })
  );

  router.post(
    "/logout",
    validateRequest({ body: logoutSchema }),
    asyncHandler(async (req, res) => {
      await authService.logout(req.body.refreshToken, requestMeta(req));
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
      return sendSuccess(res, result, undefined, 201);
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
