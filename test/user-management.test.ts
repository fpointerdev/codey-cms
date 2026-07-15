import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { AppError } from "../src/core/errors/app-error.js";
import { listUsersQuery, updateUserSchema } from "../src/modules/users/users.schemas.js";
import { UserService } from "../src/modules/users/users.service.js";

const actor = {
  id: "actor-1",
  email: "owner@example.com",
  name: "Owner",
  roles: ["owner"],
  permissions: [{ action: "manage", subject: "all" }]
};

function accessUser(options: {
  id?: string;
  status?: "ACTIVE" | "SUSPENDED";
  manager?: boolean;
  roleId?: string;
} = {}) {
  return {
    id: options.id || "user-1",
    status: options.status || "ACTIVE",
    roles: [{
      role: {
        id: options.roleId || "role-editor",
        permissions: options.manager
          ? [{ permission: { action: "manage", subject: "all" } }]
          : [{ permission: { action: "read", subject: "cms" } }]
      }
    }]
  };
}

function publicUser(id = "user-1", status: "ACTIVE" | "SUSPENDED" = "ACTIVE") {
  return {
    id,
    email: `${id}@example.com`,
    name: "Editor",
    status,
    emailVerifiedAt: new Date(),
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    roles: [{ role: { id: "role-editor", name: "editor", description: "Editor" } }]
  };
}

test("user schemas support filters and reject empty or unsafe role updates", () => {
  assert.deepEqual(listUsersQuery.parse({ status: "ACTIVE", page: "2" }), {
    status: "ACTIVE",
    page: 2,
    limit: 20
  });
  assert.equal(updateUserSchema.safeParse({}).success, false);
  assert.equal(updateUserSchema.safeParse({ status: "INVITED" }).success, false);
  assert.equal(updateUserSchema.safeParse({ roleIds: [] }).success, false);
  assert.equal(updateUserSchema.safeParse({ name: "Updated name" }).success, true);
});

test("updating a user changes roles, suspends sessions, and writes an audit event", async () => {
  const calls = {
    deletedRoles: 0,
    createdRoles: [] as unknown[],
    revokedTokens: 0,
    audits: [] as Array<{ data: { action: string } }>
  };
  const updatedUser = publicUser("user-1", "SUSPENDED");
  const tx = {
    user: {
      findUnique: async () => accessUser({ roleId: "role-viewer" }),
      update: async () => updatedUser,
      count: async () => 1
    },
    role: {
      findMany: async () => [{
        id: "role-editor",
        permissions: [{ permission: { action: "read", subject: "cms" } }]
      }]
    },
    userRole: {
      deleteMany: async () => {
        calls.deletedRoles += 1;
        return { count: 1 };
      },
      createMany: async (args: unknown) => {
        calls.createdRoles.push(args);
        return { count: 1 };
      }
    },
    refreshToken: {
      updateMany: async () => {
        calls.revokedTokens += 1;
        return { count: 2 };
      }
    },
    auditLog: {
      create: async (args: { data: { action: string } }) => {
        calls.audits.push(args);
        return args.data;
      }
    }
  };
  const prisma = {
    $transaction: async (callback: (database: typeof tx) => Promise<unknown>) => callback(tx)
  } as unknown as PrismaClient;
  const service = new UserService(prisma);

  const result = await service.update("user-1", {
    name: "Updated editor",
    status: "SUSPENDED",
    roleIds: ["role-editor"]
  }, { actor });

  assert.equal(result.status, "SUSPENDED");
  assert.equal(calls.deletedRoles, 1);
  assert.equal(calls.createdRoles.length, 1);
  assert.equal(calls.revokedTokens, 1);
  assert.equal(calls.audits[0]?.data.action, "user.update");
});

test("a user cannot change their own access or assign permissions they do not have", async () => {
  const selfTx = {
    user: { findUnique: async () => accessUser({ id: actor.id, manager: true }) }
  };
  const selfService = new UserService({
    $transaction: async (callback: (database: typeof selfTx) => Promise<unknown>) => callback(selfTx)
  } as unknown as PrismaClient);

  await assert.rejects(
    () => selfService.update(actor.id, { status: "SUSPENDED" }, { actor }),
    (error) => error instanceof AppError && error.code === "cannot_change_own_access"
  );

  const restrictedActor = {
    ...actor,
    id: "limited-actor",
    permissions: [{ action: "update", subject: "users" }]
  };
  const restrictedTx = {
    user: { findUnique: async () => accessUser() },
    role: {
      findMany: async () => [{
        id: "role-owner",
        permissions: [{ permission: { action: "manage", subject: "all" } }]
      }]
    }
  };
  const restrictedService = new UserService({
    $transaction: async (callback: (database: typeof restrictedTx) => Promise<unknown>) => callback(restrictedTx)
  } as unknown as PrismaClient);

  await assert.rejects(
    () => restrictedService.update("user-1", { roleIds: ["role-owner"] }, { actor: restrictedActor }),
    (error) => error instanceof AppError && error.code === "role_assignment_forbidden"
  );
});

test("deletion protects the current user and the final active administrator", async () => {
  const service = new UserService({} as PrismaClient);
  await assert.rejects(
    () => service.delete(actor.id, { actor }),
    (error) => error instanceof AppError && error.code === "cannot_delete_own_user"
  );

  let deleted = false;
  const tx = {
    user: {
      findUnique: async () => accessUser({ id: "owner-2", manager: true }),
      count: async () => 0,
      delete: async () => {
        deleted = true;
        return publicUser("owner-2");
      }
    }
  };
  const lastManagerService = new UserService({
    $transaction: async (callback: (database: typeof tx) => Promise<unknown>) => callback(tx)
  } as unknown as PrismaClient);

  await assert.rejects(
    () => lastManagerService.delete("owner-2", { actor }),
    (error) => error instanceof AppError && error.code === "last_manager_required"
  );
  assert.equal(deleted, false);
});

test("deleting a regular user returns the account and records the action", async () => {
  const audits: string[] = [];
  const tx = {
    user: {
      findUnique: async () => accessUser({ id: "editor-2" }),
      delete: async () => publicUser("editor-2")
    },
    auditLog: {
      create: async (args: { data: { action: string } }) => {
        audits.push(args.data.action);
        return args.data;
      }
    }
  };
  const service = new UserService({
    $transaction: async (callback: (database: typeof tx) => Promise<unknown>) => callback(tx)
  } as unknown as PrismaClient);

  const deleted = await service.delete("editor-2", { actor });
  assert.equal(deleted.id, "editor-2");
  assert.deepEqual(audits, ["user.delete"]);
});
