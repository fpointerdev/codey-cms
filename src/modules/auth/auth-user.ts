import type { AuthenticatedUser } from "./auth.types.js";

export const authUserInclude = {
  mfaCredential: {
    select: {
      enabledAt: true
    }
  },
  roles: {
    include: {
      role: {
        include: {
          permissions: {
            include: {
              permission: true
            }
          }
        }
      }
    }
  }
} as const;

export function toAuthenticatedUser(user: {
  id: string;
  email: string;
  name: string | null;
  roles: Array<{
    role: {
      name: string;
      permissions: Array<{
        permission: {
          action: string;
          subject: string;
        };
      }>;
    };
  }>;
  mfaCredential?: { enabledAt: Date | null } | null;
}): AuthenticatedUser {
  const permissions = user.roles.flatMap((userRole) =>
    userRole.role.permissions.map((rolePermission) => ({
      action: rolePermission.permission.action,
      subject: rolePermission.permission.subject
    }))
  );

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    roles: user.roles.map((userRole) => userRole.role.name),
    permissions,
    mfaEnabled: Boolean(user.mfaCredential?.enabledAt)
  };
}
