import { AppError } from "../../core/errors/app-error.js";

export type PermissionKey = {
  action: string;
  subject: string;
};

type RoleWithPermissions = {
  permissions: Array<{
    permission: PermissionKey;
  }>;
};

function permissionKey(permission: PermissionKey) {
  return `${permission.action}:${permission.subject}`;
}

export function assertPermissionsCanBeGranted(
  actorPermissions: PermissionKey[],
  permissions: PermissionKey[]
) {
  const canManageAll = actorPermissions.some(
    (permission) => permission.action === "manage" && permission.subject === "all"
  );
  if (canManageAll) return;

  const availablePermissions = new Set(actorPermissions.map(permissionKey));
  const exceedsActorAccess = permissions.some(
    (permission) => !availablePermissions.has(permissionKey(permission))
  );

  if (exceedsActorAccess) {
    throw new AppError(
      403,
      "permission_grant_forbidden",
      "You cannot grant permissions you do not have."
    );
  }
}

export function assertRolesCanBeAssigned(
  actorPermissions: PermissionKey[],
  roles: RoleWithPermissions[]
) {
  try {
    assertPermissionsCanBeGranted(
      actorPermissions,
      roles.flatMap((role) => role.permissions.map(({ permission }) => permission))
    );
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== "permission_grant_forbidden") throw error;
    throw new AppError(
      403,
      "role_assignment_forbidden",
      "You cannot assign a role with permissions you do not have."
    );
  }
}
