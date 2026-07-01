import type { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import type { ModuleContext } from "../../core/types/module.js";
import { asyncHandler } from "../../core/http/async-handler.js";
import { sendSuccess } from "../../core/http/response.js";
import { validateRequest } from "../../core/http/validation.middleware.js";
import { requireAuth, requirePermission } from "../auth/auth.middleware.js";
import { listUsersQuery, updateUserSchema, userIdParams } from "./users.schemas.js";

const publicUserSelect = {
  id: true,
  email: true,
  name: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  roles: {
    select: {
      role: {
        select: {
          id: true,
          name: true
        }
      }
    }
  }
} as const;

type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export function registerUserRoutes(router: Router, context: ModuleContext) {
  router.get(
    "/me",
    requireAuth(context),
    asyncHandler(async (req, res) => {
      const user = await context.prisma.user.findUniqueOrThrow({
        where: { id: req.user!.id },
        select: publicUserSelect
      });

      return sendSuccess(res, { user });
    })
  );

  router.get(
    "/",
    requirePermission(context, "read", "users"),
    validateRequest({ query: listUsersQuery }),
    asyncHandler(async (req, res) => {
      const { page, limit, search } = req.query as unknown as {
        page: number;
        limit: number;
        search?: string;
      };
      const skip = (page - 1) * limit;
      const where = search
        ? {
            OR: [
              { email: { contains: search, mode: "insensitive" as const } },
              { name: { contains: search, mode: "insensitive" as const } }
            ]
          }
        : undefined;

      const [users, total] = await Promise.all([
        context.prisma.user.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          select: publicUserSelect
        }),
        context.prisma.user.count({ where })
      ]);

      return sendSuccess(res, { users }, { page, limit, total });
    })
  );

  router.get(
    "/:id",
    requirePermission(context, "read", "users"),
    validateRequest({ params: userIdParams }),
    asyncHandler(async (req, res) => {
      const user = await context.prisma.user.findUniqueOrThrow({
        where: { id: req.params.id },
        select: publicUserSelect
      });

      return sendSuccess(res, { user });
    })
  );

  router.patch(
    "/:id",
    requirePermission(context, "update", "users"),
    validateRequest({ params: userIdParams, body: updateUserSchema }),
    asyncHandler(async (req, res) => {
      const { roleIds, ...userData } = req.body as {
        name?: string;
        status?: "ACTIVE" | "INVITED" | "SUSPENDED";
        roleIds?: string[];
      };

      const user = await context.prisma.$transaction(async (tx: TransactionClient) => {
        if (roleIds) {
          await tx.userRole.deleteMany({ where: { userId: req.params.id } });
          await tx.userRole.createMany({
            data: roleIds.map((roleId) => ({
              userId: req.params.id,
              roleId
            })),
            skipDuplicates: true
          });
        }

        return tx.user.update({
          where: { id: req.params.id },
          data: userData,
          select: publicUserSelect
        });
      });

      return sendSuccess(res, { user });
    })
  );
}
