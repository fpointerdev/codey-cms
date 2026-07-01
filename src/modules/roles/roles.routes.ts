import type { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import type { ModuleContext } from "../../core/types/module.js";
import { asyncHandler } from "../../core/http/async-handler.js";
import { sendCreated, sendSuccess } from "../../core/http/response.js";
import { validateRequest } from "../../core/http/validation.middleware.js";
import { requirePermission } from "../auth/auth.middleware.js";
import { createRoleSchema, roleIdParams, updateRoleSchema } from "./roles.schemas.js";

const roleInclude = {
  permissions: {
    include: {
      permission: true
    }
  }
} as const;

type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export function registerRoleRoutes(router: Router, context: ModuleContext) {
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
      const { permissionIds, ...roleData } = req.body as {
        name: string;
        description?: string;
        permissionIds: string[];
      };

      const role = await context.prisma.role.create({
        data: {
          ...roleData,
          permissions: {
            create: permissionIds.map((permissionId) => ({ permissionId }))
          }
        },
        include: roleInclude
      });

      return sendCreated(res, { role });
    })
  );

  router.patch(
    "/:id",
    requirePermission(context, "update", "roles"),
    validateRequest({ params: roleIdParams, body: updateRoleSchema }),
    asyncHandler(async (req, res) => {
      const { permissionIds, ...roleData } = req.body as {
        name?: string;
        description?: string;
        permissionIds?: string[];
      };

      const role = await context.prisma.$transaction(async (tx: TransactionClient) => {
        if (permissionIds) {
          await tx.rolePermission.deleteMany({ where: { roleId: req.params.id } });
          await tx.rolePermission.createMany({
            data: permissionIds.map((permissionId) => ({
              roleId: req.params.id,
              permissionId
            })),
            skipDuplicates: true
          });
        }

        return tx.role.update({
          where: { id: req.params.id },
          data: roleData,
          include: roleInclude
        });
      });

      return sendSuccess(res, { role });
    })
  );
}
