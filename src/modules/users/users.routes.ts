import type { Router } from "express";
import type { ModuleContext } from "../../core/types/module.js";
import { asyncHandler } from "../../core/http/async-handler.js";
import { sendSuccess } from "../../core/http/response.js";
import { validateRequest } from "../../core/http/validation.middleware.js";
import { requireAuth, requirePermission } from "../auth/auth.middleware.js";
import { listUsersQuery, updateUserSchema, userIdParams } from "./users.schemas.js";
import { UserService } from "./users.service.js";

function requestMeta(req: { header: (name: string) => string | undefined; ip?: string }) {
  return {
    userAgent: req.header("user-agent"),
    ipAddress: req.ip
  };
}

export function registerUserRoutes(router: Router, context: ModuleContext) {
  const userService = new UserService(context.prisma);

  router.get(
    "/me",
    requireAuth(context),
    asyncHandler(async (req, res) => {
      const user = await userService.get(req.user!.id);

      return sendSuccess(res, { user });
    })
  );

  router.get(
    "/",
    requirePermission(context, "read", "users"),
    validateRequest({ query: listUsersQuery }),
    asyncHandler(async (req, res) => {
      const { page, limit, search, status } = req.query as unknown as {
        page: number;
        limit: number;
        search?: string;
        status?: "ACTIVE" | "INVITED" | "SUSPENDED";
      };
      const result = await userService.list({ page, limit, search, status });

      return sendSuccess(res, result, result.pagination);
    })
  );

  router.get(
    "/:id",
    requirePermission(context, "read", "users"),
    validateRequest({ params: userIdParams }),
    asyncHandler(async (req, res) => {
      const user = await userService.get(req.params.id);

      return sendSuccess(res, { user });
    })
  );

  router.patch(
    "/:id",
    requirePermission(context, "update", "users"),
    validateRequest({ params: userIdParams, body: updateUserSchema }),
    asyncHandler(async (req, res) => {
      const user = await userService.update(req.params.id, req.body, {
        actor: req.user!,
        ...requestMeta(req)
      });

      return sendSuccess(res, { user });
    })
  );

  router.delete(
    "/:id",
    requirePermission(context, "delete", "users"),
    validateRequest({ params: userIdParams }),
    asyncHandler(async (req, res) => {
      const user = await userService.delete(req.params.id, {
        actor: req.user!,
        ...requestMeta(req)
      });

      return sendSuccess(res, { deleted: true, user });
    })
  );
}
