import type { Prisma, PrismaClient, UserStatus } from "@prisma/client";
import { writeAuditLog } from "../../core/audit/audit-log.js";
import { AppError } from "../../core/errors/app-error.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { assertRolesCanBeAssigned } from "../roles/role-assignment.js";

export const publicUserSelect = {
  id: true,
  email: true,
  name: true,
  status: true,
  emailVerifiedAt: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  roles: {
    select: {
      role: {
        select: {
          id: true,
          name: true,
          description: true
        }
      }
    }
  }
} as const;

const accessUserSelect = {
  id: true,
  status: true,
  roles: {
    select: {
      role: {
        select: {
          id: true,
          permissions: {
            select: {
              permission: {
                select: {
                  action: true,
                  subject: true
                }
              }
            }
          }
        }
      }
    }
  }
} as const;

const assignableRoleInclude = {
  permissions: {
    include: {
      permission: true
    }
  }
} as const;

type UserAuditMeta = {
  actor: AuthenticatedUser;
  ipAddress?: string;
  userAgent?: string;
};

type UpdateUserInput = {
  name?: string;
  status?: "ACTIVE" | "SUSPENDED";
  roleIds?: string[];
};

function isActiveManager(user: Prisma.UserGetPayload<{ select: typeof accessUserSelect }>) {
  return user.status === "ACTIVE" && user.roles.some(({ role }) =>
    role.permissions.some(({ permission }) =>
      permission.action === "manage" && permission.subject === "all"
    )
  );
}

function sameIds(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
}

function assertUserAccessCanBeManaged(
  actor: AuthenticatedUser,
  user: Prisma.UserGetPayload<{ select: typeof accessUserSelect }>
) {
  try {
    assertRolesCanBeAssigned(actor.permissions, user.roles.map(({ role }) => role));
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== "role_assignment_forbidden") throw error;
    throw new AppError(
      403,
      "user_access_forbidden",
      "You cannot manage a user whose access exceeds your own."
    );
  }
}

export class UserService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(input: {
    page: number;
    limit: number;
    search?: string;
    status?: UserStatus;
  }) {
    const skip = (input.page - 1) * input.limit;
    const where: Prisma.UserWhereInput = {
      ...(input.status ? { status: input.status } : {}),
      ...(input.search
        ? {
            OR: [
              { email: { contains: input.search, mode: "insensitive" } },
              { name: { contains: input.search, mode: "insensitive" } }
            ]
          }
        : {})
    };
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: input.limit,
        orderBy: { createdAt: "desc" },
        select: publicUserSelect
      }),
      this.prisma.user.count({ where })
    ]);

    return {
      users,
      pagination: {
        page: input.page,
        limit: input.limit,
        total,
        pages: Math.max(1, Math.ceil(total / input.limit))
      }
    };
  }

  async get(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: publicUserSelect
    });
    if (!user) throw new AppError(404, "user_not_found", "User not found.");

    return user;
  }

  async update(userId: string, input: UpdateUserInput, audit: UserAuditMeta) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({
        where: { id: userId },
        select: accessUserSelect
      });
      if (!existing) throw new AppError(404, "user_not_found", "User not found.");

      const currentRoleIds = existing.roles.map(({ role }) => role.id);
      const rolesChanged = input.roleIds !== undefined && !sameIds(input.roleIds, currentRoleIds);
      const accessChanged =
        (input.status !== undefined && input.status !== existing.status) ||
        rolesChanged;

      if (userId === audit.actor.id && accessChanged) {
        throw new AppError(
          409,
          "cannot_change_own_access",
          "Use another administrator to change your status or roles."
        );
      }

      if (accessChanged) assertUserAccessCanBeManaged(audit.actor, existing);

      const roles = rolesChanged
        ? await tx.role.findMany({
            where: { id: { in: input.roleIds! } },
            include: assignableRoleInclude
          })
        : null;

      if (roles && roles.length !== input.roleIds!.length) {
        throw new AppError(422, "invalid_user_roles", "One or more selected roles do not exist.");
      }
      if (roles) assertRolesCanBeAssigned(audit.actor.permissions, roles);

      const remainsManager = roles
        ? input.status !== "SUSPENDED" && roles.some((role) =>
            role.permissions.some(({ permission }) =>
              permission.action === "manage" && permission.subject === "all"
            )
          )
        : input.status === "SUSPENDED" ? false : isActiveManager(existing);

      if (isActiveManager(existing) && !remainsManager) {
        await this.assertAnotherManagerExists(tx, userId);
      }

      if (rolesChanged) {
        await tx.userRole.deleteMany({ where: { userId } });
        await tx.userRole.createMany({
          data: input.roleIds!.map((roleId) => ({ userId, roleId })),
          skipDuplicates: true
        });
      }

      const user = await tx.user.update({
        where: { id: userId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(accessChanged ? { authVersion: { increment: 1 } } : {})
        },
        select: publicUserSelect
      });

      if (accessChanged) {
        await tx.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() }
        });
      }

      await writeAuditLog(tx, {
        actorUserId: audit.actor.id,
        action: "user.update",
        subject: "user",
        subjectId: userId,
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
        metadata: {
          status: user.status,
          roleIds: user.roles.map(({ role }) => role.id)
        }
      });

      return user;
    }, { isolationLevel: "Serializable" });
  }

  async delete(userId: string, audit: UserAuditMeta) {
    if (userId === audit.actor.id) {
      throw new AppError(409, "cannot_delete_own_user", "You cannot delete your own account.");
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({
        where: { id: userId },
        select: accessUserSelect
      });
      if (!existing) throw new AppError(404, "user_not_found", "User not found.");
      assertUserAccessCanBeManaged(audit.actor, existing);
      if (isActiveManager(existing)) await this.assertAnotherManagerExists(tx, userId);

      const user = await tx.user.delete({
        where: { id: userId },
        select: publicUserSelect
      });

      await writeAuditLog(tx, {
        actorUserId: audit.actor.id,
        action: "user.delete",
        subject: "user",
        subjectId: userId,
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
        metadata: {
          email: user.email,
          roles: user.roles.map(({ role }) => role.name)
        }
      });

      return user;
    }, { isolationLevel: "Serializable" });
  }

  private async assertAnotherManagerExists(tx: Prisma.TransactionClient, excludedUserId: string) {
    const managerCount = await tx.user.count({
      where: {
        id: { not: excludedUserId },
        status: "ACTIVE",
        roles: {
          some: {
            role: {
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
