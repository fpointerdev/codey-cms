import type { Prisma, PrismaClient } from "@prisma/client";
import { writeAuditLog } from "../../core/audit/audit-log.js";
import { AppError } from "../../core/errors/app-error.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import {
  assertPermissionsCanBeGranted,
  assertRolesCanBeAssigned,
  type PermissionKey
} from "./role-assignment.js";

export const roleInclude = {
  permissions: {
    include: {
      permission: true
    }
  }
} as const;

type RoleAuditMeta = {
  actor: AuthenticatedUser;
  ipAddress?: string;
  userAgent?: string;
};

type CreateRoleInput = {
  name: string;
  description?: string;
  permissionIds: string[];
};

type UpdateRoleInput = {
  name?: string;
  description?: string;
  permissionIds?: string[];
};

function hasManageAll(permissions: PermissionKey[]) {
  return permissions.some(
    (permission) => permission.action === "manage" && permission.subject === "all"
  );
}

function sameIds(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
}

export class RoleService {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateRoleInput, audit: RoleAuditMeta) {
    return this.prisma.$transaction(async (tx) => {
      const permissions = await this.resolvePermissions(tx, input.permissionIds);
      assertPermissionsCanBeGranted(audit.actor.permissions, permissions);

      const role = await tx.role.create({
        data: {
          name: input.name,
          description: input.description,
          permissions: input.permissionIds.length
            ? {
                create: input.permissionIds.map((permissionId) => ({ permissionId }))
              }
            : undefined
        },
        include: roleInclude
      });

      await writeAuditLog(tx, {
        actorUserId: audit.actor.id,
        action: "role.create",
        subject: "role",
        subjectId: role.id,
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
        metadata: {
          name: role.name,
          permissionIds: role.permissions.map(({ permission }) => permission.id)
        }
      });

      return role;
    }, { isolationLevel: "Serializable" });
  }

  async update(roleId: string, input: UpdateRoleInput, audit: RoleAuditMeta) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.role.findUnique({
        where: { id: roleId },
        include: roleInclude
      });
      if (!existing) throw new AppError(404, "role_not_found", "Role not found.");

      assertRolesCanBeAssigned(audit.actor.permissions, [existing]);
      const currentPermissionIds = existing.permissions.map(({ permission }) => permission.id);
      const permissionsChanged = input.permissionIds !== undefined &&
        !sameIds(input.permissionIds, currentPermissionIds);
      const permissions = permissionsChanged
        ? await this.resolvePermissions(tx, input.permissionIds!)
        : null;

      if (permissions) {
        assertPermissionsCanBeGranted(audit.actor.permissions, permissions);
        const currentlyManagesAll = hasManageAll(
          existing.permissions.map(({ permission }) => permission)
        );
        if (currentlyManagesAll && !hasManageAll(permissions)) {
          await this.assertAnotherManagerExists(tx, roleId);
        }

        await tx.rolePermission.deleteMany({ where: { roleId } });
        if (input.permissionIds!.length) {
          await tx.rolePermission.createMany({
            data: input.permissionIds!.map((permissionId) => ({ roleId, permissionId })),
            skipDuplicates: true
          });
        }
      }

      const role = await tx.role.update({
        where: { id: roleId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {})
        },
        include: roleInclude
      });

      await writeAuditLog(tx, {
        actorUserId: audit.actor.id,
        action: "role.update",
        subject: "role",
        subjectId: role.id,
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
        metadata: {
          name: role.name,
          permissionIds: role.permissions.map(({ permission }) => permission.id)
        }
      });

      return role;
    }, { isolationLevel: "Serializable" });
  }

  private async resolvePermissions(tx: Prisma.TransactionClient, permissionIds: string[]) {
    if (!permissionIds.length) return [];

    const permissions = await tx.permission.findMany({
      where: { id: { in: permissionIds } }
    });
    if (permissions.length !== permissionIds.length) {
      throw new AppError(
        422,
        "invalid_role_permissions",
        "One or more selected permissions do not exist."
      );
    }

    return permissions;
  }

  private async assertAnotherManagerExists(tx: Prisma.TransactionClient, excludedRoleId: string) {
    const managerCount = await tx.user.count({
      where: {
        status: "ACTIVE",
        roles: {
          some: {
            role: {
              id: { not: excludedRoleId },
              permissions: {
                some: {
                  permission: {
                    action: "manage",
                    subject: "all"
                  }
                }
              }
            }
          }
        }
      }
    });

    if (managerCount === 0) {
      throw new AppError(
        409,
        "last_manager_required",
        "At least one active administrator with full access must remain."
      );
    }
  }
}
