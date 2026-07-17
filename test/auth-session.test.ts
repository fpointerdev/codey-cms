import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../src/config/index.js";
import { AppError } from "../src/core/errors/app-error.js";
import { hashPassword } from "../src/core/security/password.js";
import {
  clearRefreshTokenCookie,
  exposeAccessToken,
  refreshTokenCookieName,
  refreshTokenFromRequest
} from "../src/modules/auth/auth-session-cookie.js";
import { changePasswordSchema, refreshSchema } from "../src/modules/auth/auth.schemas.js";
import { AuthService } from "../src/modules/auth/auth.service.js";

const config = {
  isProduction: false,
  api: { prefix: "/api/v1" },
  app: { name: "CodeY CMS", publicUrl: "http://localhost:4000" },
  auth: {
    accessTokenSecret: "test-access-secret-with-at-least-32-characters",
    accessTokenTtl: "15m",
    refreshTokenTtl: "30d",
    allowRegistration: false,
    requireEmailVerification: false,
    recoveryTokenDelivery: "disabled"
  },
  email: { driver: "disabled" }
} as AppConfig;

function authUser(authVersion = 1, passwordHash = "password-hash") {
  return {
    id: "user-1",
    email: "owner@example.com",
    name: "Owner",
    passwordHash,
    authVersion,
    status: "ACTIVE" as const,
    emailVerifiedAt: new Date(),
    roles: [{
      role: {
        name: "owner",
        permissions: [{ permission: { action: "manage", subject: "all" } }]
      }
    }]
  };
}

test("refresh cookies are HttpOnly and refresh credentials are not exposed", () => {
  const cookieCalls: unknown[][] = [];
  const clearCalls: unknown[][] = [];
  const response = {
    cookie: (...args: unknown[]) => cookieCalls.push(args),
    clearCookie: (...args: unknown[]) => clearCalls.push(args)
  };
  const access = exposeAccessToken(response, {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    tokenType: "Bearer",
    expiresIn: 900
  }, config);

  assert.equal("refreshToken" in access, false);
  assert.deepEqual(cookieCalls[0]?.slice(0, 2), [refreshTokenCookieName, "refresh-token"]);
  assert.deepEqual(cookieCalls[0]?.[2], {
    httpOnly: true,
    secure: false,
    sameSite: "strict",
    path: "/api/v1/auth",
    maxAge: 2_592_000_000
  });

  clearRefreshTokenCookie(response, config);
  assert.deepEqual(clearCalls[0], [refreshTokenCookieName, {
    httpOnly: true,
    secure: false,
    sameSite: "strict",
    path: "/api/v1/auth"
  }]);
  assert.equal(refreshTokenFromRequest({
    cookies: { [refreshTokenCookieName]: "cookie-token" },
    body: { refreshToken: "body-token" }
  } as never), "cookie-token");
  assert.equal(refreshTokenFromRequest({
    cookies: {},
    body: { refreshToken: "body-token" }
  } as never), "body-token");

  exposeAccessToken(response, {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    tokenType: "Bearer",
    expiresIn: 900
  }, { ...config, isProduction: true });
  assert.equal((cookieCalls[1]?.[2] as { secure?: boolean }).secure, true);
});

test("password schema rejects reuse and accepts a distinct strong password", () => {
  assert.equal(changePasswordSchema.safeParse({
    currentPassword: "CurrentPass123!",
    newPassword: "CurrentPass123!"
  }).success, false);
  assert.equal(changePasswordSchema.safeParse({
    currentPassword: "CurrentPass123!",
    newPassword: "NewStrongPass123!"
  }).success, true);
});

test("cookie-backed refresh and logout accept an empty request body", () => {
  assert.deepEqual(refreshSchema.parse(undefined), {});
});

test("access tokens stop working after the user session version changes", async () => {
  const passwordHash = await hashPassword("CurrentPass123!");
  let authVersion = 1;
  const prisma = {
    user: {
      findUnique: async () => authUser(authVersion, passwordHash),
      update: async () => authUser(authVersion, passwordHash)
    },
    refreshToken: {
      create: async ({ data }: { data: Record<string, unknown> }) => data
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => data
    }
  } as unknown as PrismaClient;
  const service = new AuthService(prisma, config);
  const session = await service.login({
    email: "owner@example.com",
    password: "CurrentPass123!"
  }, {});

  assert.equal((await service.verifyAccessToken(session.tokens.accessToken)).id, "user-1");
  authVersion = 2;
  await assert.rejects(
    () => service.verifyAccessToken(session.tokens.accessToken),
    (error) => error instanceof AppError && error.code === "unauthorized"
  );
});

test("refresh tokens cannot cross a session-version boundary", async () => {
  const tx = {
    refreshToken: {
      findUnique: async () => ({
        id: "refresh-1",
        userId: "user-1",
        authVersion: 1,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        user: authUser(2)
      })
    }
  };
  const service = new AuthService({
    $transaction: async (callback: (database: typeof tx) => Promise<unknown>) => callback(tx)
  } as unknown as PrismaClient, config);

  await assert.rejects(
    () => service.refresh("r".repeat(64), {}),
    (error) => error instanceof AppError && error.code === "invalid_refresh_token"
  );
});

test("changing a password revokes old sessions and issues a versioned replacement", async () => {
  const passwordHash = await hashPassword("CurrentPass123!");
  const calls = {
    authVersion: 1,
    refreshVersions: [] as number[],
    refreshTokensRevoked: 0,
    audits: [] as string[]
  };
  const tx = {
    user: {
      updateMany: async () => {
        calls.authVersion = 2;
        return { count: 1 };
      },
      findUniqueOrThrow: async () => authUser(calls.authVersion, passwordHash)
    },
    refreshToken: {
      updateMany: async () => {
        calls.refreshTokensRevoked += 1;
        return { count: 3 };
      },
      create: async ({ data }: { data: { authVersion: number } }) => {
        calls.refreshVersions.push(data.authVersion);
        return data;
      }
    },
    auditLog: {
      create: async ({ data }: { data: { action: string } }) => {
        calls.audits.push(data.action);
        return data;
      }
    }
  };
  const prisma = {
    user: {
      findUnique: async () => authUser(1, passwordHash)
    },
    $transaction: async (callback: (database: typeof tx) => Promise<unknown>) => callback(tx)
  } as unknown as PrismaClient;
  const service = new AuthService(prisma, config);

  const result = await service.changePassword("user-1", {
    currentPassword: "CurrentPass123!",
    newPassword: "NewStrongPass123!"
  }, {});

  assert.ok(result.tokens.accessToken);
  assert.equal(calls.refreshTokensRevoked, 1);
  assert.deepEqual(calls.refreshVersions, [2]);
  assert.deepEqual(calls.audits, ["password.change"]);

  await assert.rejects(
    () => service.changePassword("user-1", {
      currentPassword: "WrongPass123!",
      newPassword: "AnotherPass123!"
    }, {}),
    (error) => error instanceof AppError && error.code === "invalid_current_password"
  );
});

test("revoking every session increments the user version and audits the action", async () => {
  const calls = { versionUpdates: 0, revoked: 0, audits: [] as string[] };
  const tx = {
    user: {
      updateMany: async () => {
        calls.versionUpdates += 1;
        return { count: 1 };
      }
    },
    refreshToken: {
      updateMany: async () => {
        calls.revoked += 1;
        return { count: 4 };
      }
    },
    auditLog: {
      create: async ({ data }: { data: { action: string } }) => {
        calls.audits.push(data.action);
        return data;
      }
    }
  };
  const service = new AuthService({
    $transaction: async (callback: (database: typeof tx) => Promise<unknown>) => callback(tx)
  } as unknown as PrismaClient, config);

  const result = await service.revokeAllSessions("user-1", {});
  assert.deepEqual(result, { revoked: true, refreshTokensRevoked: 4 });
  assert.equal(calls.versionUpdates, 1);
  assert.equal(calls.revoked, 1);
  assert.deepEqual(calls.audits, ["sessions.revoke_all"]);
});

test("requesting a password reset invalidates earlier reset links", async () => {
  const tokenUpdates: Array<Record<string, unknown>> = [];
  const tokenCreates: Array<Record<string, unknown>> = [];
  const tx = {
    passwordResetToken: {
      updateMany: async (args: Record<string, unknown>) => {
        tokenUpdates.push(args);
        return { count: 1 };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        tokenCreates.push(data);
        return data;
      }
    }
  };
  const service = new AuthService({
    user: { findUnique: async () => authUser() },
    auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => data },
    $transaction: async (callback: (database: typeof tx) => Promise<unknown>) => callback(tx)
  } as unknown as PrismaClient, {
    ...config,
    auth: { ...config.auth, recoveryTokenDelivery: "response" }
  });

  const result = await service.requestPasswordReset({ email: "owner@example.com" }, {});

  assert.ok(result.token);
  assert.deepEqual(tokenUpdates[0]?.where, { userId: "user-1", consumedAt: null });
  assert.equal(tokenCreates.length, 1);
});

test("confirming a password reset consumes every outstanding reset link", async () => {
  const tokenUpdates: Array<Record<string, unknown>> = [];
  const tx = {
    passwordResetToken: {
      findUnique: async () => ({
        id: "reset-1",
        userId: "user-1",
        consumedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        user: { status: "ACTIVE" }
      }),
      updateMany: async (args: Record<string, unknown>) => {
        tokenUpdates.push(args);
        return { count: 1 };
      }
    },
    user: { update: async () => authUser(2) },
    refreshToken: { updateMany: async () => ({ count: 2 }) },
    auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => data }
  };
  const service = new AuthService({
    $transaction: async (callback: (database: typeof tx) => Promise<unknown>) => callback(tx)
  } as unknown as PrismaClient, config);

  await service.confirmPasswordReset({
    token: "reset-token-value-with-enough-length",
    password: "NewStrongPass123!"
  }, {});

  assert.equal(tokenUpdates.length, 2);
  assert.deepEqual(tokenUpdates[0]?.where, { id: "reset-1", consumedAt: null });
  assert.deepEqual(tokenUpdates[1]?.where, { userId: "user-1", consumedAt: null });
});

test("browser sessions restore through cookies without persisting credentials", async () => {
  const values = new Map([
    ["cms_access_token", "legacy-access"],
    ["cms_refresh_token", "legacy-refresh"],
    ["cms_session_hint", "1"]
  ]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) || null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value)
    }
  });
  const requests: Array<{ url: string; authorization?: string; body?: string }> = [];
  let meRequests = 0;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (url: string, options: { headers?: Record<string, string>; body?: string } = {}) => {
      requests.push({
        url,
        authorization: options.headers?.authorization,
        body: options.body
      });
      if (url.endsWith("/auth/refresh")) {
        return Response.json({
          success: true,
          data: {
            user: { id: "user-1", permissions: [] },
            tokens: { accessToken: "memory-access", tokenType: "Bearer", expiresIn: 900 }
          }
        });
      }
      meRequests += 1;
      if (meRequests === 1) {
        return Response.json({ success: false, error: { message: "Authentication required." } }, { status: 401 });
      }

      return Response.json({ success: true, data: { user: { id: "user-1" } } });
    }
  });
  const { api, state } = await import("../apps/web/web/core.js");

  assert.equal(values.has("cms_access_token"), false);
  assert.equal(values.has("cms_refresh_token"), false);
  assert.equal((await api("/auth/me")).user.id, "user-1");
  assert.equal(requests.length, 3);
  assert.equal(requests[1]?.body, "{}");
  assert.equal(requests[2]?.authorization, "Bearer memory-access");
  assert.equal(state.token, "memory-access");
  assert.equal(values.has("cms_access_token"), false);
  assert.equal(values.has("cms_refresh_token"), false);
});
