import type { Router } from "express";
import type { ModuleContext } from "../../core/types/module.js";
import { asyncHandler } from "../../core/http/async-handler.js";
import { sendCreated, sendSuccess } from "../../core/http/response.js";
import { validateRequest } from "../../core/http/validation.middleware.js";
import { requirePermission } from "../auth/auth.middleware.js";
import { createRoleSchema, roleIdParams, updateRoleSchema } from "./roles.schemas.js";
import { roleInclude, RoleService } from "./roles.service.js";

function requestMeta(req: { header: (name: string) => string | undefined; ip?: string }) {
  return {
    userAgent: req.header("user-agent"),
    ipAddress: req.ip
  };
}

export function registerRoleRoutes(router: Router, context: ModuleContext) {
  const roleService = new RoleService(context.prisma);
  router.get(
    "/permissions",
    requirePermission(context, "read", "roles"),
    asyncHandler(async (_req, res) => {
      const permissions = await context.prisma.permission.findMany({
        orderBy: [{ subject: "asc" }, { action: "asc" }]
      });

      return sendSuccess(res, { permissions });
    })
  );

  router.get(
    "/",
    requirePermission(context, "read", "roles"),
    asyncHandler(async (_req, res) => {
      const roles = await context.prisma.role.findMany({
        include: roleInclude,
        orderBy: { name: "asc" }
      });

      return sendSuccess(res, { roles });
    })
  );

  router.post(
    "/",
    requirePermission(context, "create", "roles"),
    validateRequest({ body: createRoleSchema }),
    asyncHandler(async (req, res) => {
      const role = await roleService.create(req.body, {
        actor: req.user!,
        ...requestMeta(req)
      });

      return sendCreated(res, { role });
    })
  );

  router.patch(
    "/:id",
    requirePermission(context, "update", "roles"),
    validateRequest({ params: roleIdParams, body: updateRoleSchema }),
    asyncHandler(async (req, res) => {
      const role = await roleService.update(req.params.id, req.body, {
        actor: req.user!,
        ...requestMeta(req)
      });

      return sendSuccess(res, { role });
    })
  );
}
