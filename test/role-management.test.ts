import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { AppError } from "../src/core/errors/app-error.js";
import { createRoleSchema, updateRoleSchema } from "../src/modules/roles/roles.schemas.js";
import { RoleService } from "../src/modules/roles/roles.service.js";

const permissionIds = {
  readCms: "cm12345678901234567890123",
  updateCms: "cm12345678901234567890124",
  manageAll: "cm12345678901234567890125"
};

const owner = {
  id: "owner-1",
  email: "owner@example.com",
  name: "Owner",
  roles: ["owner"],
  permissions: [{ action: "manage", subject: "all" }]
};

const editor = {
  id: "editor-1",
  email: "editor@example.com",
  name: "Editor",
  roles: ["editor"],
  permissions: [{ action: "update", subject: "roles" }]
};

function permission(id: string, action: string, subject: string) {
  return { id, action, subject };
}

function role(id: string, name: string, permissions: ReturnType<typeof permission>[]) {
  return {
    id,
    name,
    description: null,
    permissions: permissions.map((item) => ({ permission: item }))
  };
}

test("role schemas reject duplicate permissions and empty updates", () => {
  assert.equal(createRoleSchema.safeParse({
    name: "Editor",
    permissionIds: [permissionIds.readCms, permissionIds.readCms]
  }).success, false);
  assert.equal(updateRoleSchema.safeParse({}).success, false);
  assert.equal(updateRoleSchema.safeParse({ permissionIds: [] }).success, true);
});

test("limited administrators cannot create roles with permissions they do not hold", async () => {
  let created = false;
  const tx = {
    permission: {
      findMany: async () => [permission(permissionIds.readCms, "read", "cms")]
    },
    role: {
      create: async () => {
        created = true;
        return role("role-1", "content_editor", []);
      }
    }
  };
  const service = new RoleService({
    $transaction: async (callback: (database: typeof tx) => Promise<unknown>) => callback(tx)
  } as unknown as PrismaClient);

  await assert.rejects(
    () => service.create({
      name: "content_editor",
      permissionIds: [permissionIds.readCms]
    }, { actor: editor }),
    (error) => error instanceof AppError && error.code === "permission_grant_forbidden"
  );
  assert.equal(created, false);
});

test("limited administrators cannot modify roles above their own access", async () => {
  const elevatedRole = role("role-owner", "owner", [
    permission(permissionIds.manageAll, "manage", "all")
  ]);
  let updated = false;
  const tx = {
    role: {
      findUnique: async () => elevatedRole,
      update: async () => {
        updated = true;
        return elevatedRole;
      }
    }
  };
  const service = new RoleService({
    $transaction: async (callback: (database: typeof tx) => Promise<unknown>) => callback(tx)
  } as unknown as PrismaClient);

  await assert.rejects(
    () => service.update(elevatedRole.id, { name: "renamed_owner" }, { actor: editor }),
    (error) => error instanceof AppError && error.code === "role_assignment_forbidden"
  );
  assert.equal(updated, false);
});

test("role updates reject unknown permissions and protect the final full-access role", async () => {
  const managerRole = role("role-owner", "owner", [
    permission(permissionIds.manageAll, "manage", "all")
  ]);
  let permissionsDeleted = false;
  const tx = {
    role: {
      findUnique: async () => managerRole,
      update: async () => managerRole
    },
    permission: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.includes(permissionIds.readCms)
          ? [permission(permissionIds.readCms, "read", "cms")]
          : []
    },
    user: {
      count: async () => 0
    },
    rolePermission: {
      deleteMany: async () => {
        permissionsDeleted = true;
        return { count: 1 };
      }
    }
  };
  const service = new RoleService({
    $transaction: async (callback: (database: typeof tx) => Promise<unknown>) => callback(tx)
  } as unknown as PrismaClient);

  await assert.rejects(
    () => service.update(managerRole.id, {
      permissionIds: [permissionIds.updateCms]
    }, { actor: owner }),
    (error) => error instanceof AppError && error.code === "invalid_role_permissions"
  );

  await assert.rejects(
    () => service.update(managerRole.id, {
      permissionIds: [permissionIds.readCms]
    }, { actor: owner }),
    (error) => error instanceof AppError && error.code === "last_manager_required"
  );
  assert.equal(permissionsDeleted, false);
});

test("role updates replace permissions and record the audit event", async () => {
  const currentRole = role("role-editor", "editor", [
    permission(permissionIds.readCms, "read", "cms")
  ]);
  const updatedRole = role("role-editor", "content_editor", [
    permission(permissionIds.updateCms, "update", "cms")
  ]);
  const calls = {
    deleted: 0,
    created: 0,
    audits: [] as string[]
  };
  const tx = {
    role: {
      findUnique: async () => currentRole,
      update: async () => updatedRole
    },
    permission: {
      findMany: async () => [permission(permissionIds.updateCms, "update", "cms")]
    },
    rolePermission: {
      deleteMany: async () => {
        calls.deleted += 1;
        return { count: 1 };
      },
      createMany: async () => {
        calls.created += 1;
        return { count: 1 };
      }
    },
    auditLog: {
      create: async ({ data }: { data: { action: string } }) => {
        calls.audits.push(data.action);
        return data;
      }
    }
  };
  const service = new RoleService({
    $transaction: async (callback: (database: typeof tx) => Promise<unknown>) => callback(tx)
  } as unknown as PrismaClient);

  const result = await service.update(currentRole.id, {
    name: "content_editor",
    permissionIds: [permissionIds.updateCms]
  }, { actor: owner });

  assert.equal(result.name, "content_editor");
  assert.equal(calls.deleted, 1);
  assert.equal(calls.created, 1);
  assert.deepEqual(calls.audits, ["role.update"]);
});
