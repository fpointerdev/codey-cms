import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../src/config/index.js";
import { AppError } from "../src/core/errors/app-error.js";
import { hashPassword } from "../src/core/security/password.js";
import { decryptSecretEnvelope, encryptSecretEnvelope } from "../src/core/security/secret-envelope.js";
import {
  clearRefreshTokenCookie,
  exposeAccessToken,
  refreshTokenCookieName,
  refreshTokenFromRequest
} from "../src/modules/auth/auth-session-cookie.js";
import { changePasswordSchema, refreshSchema, sessionIdParams } from "../src/modules/auth/auth.schemas.js";
import { AuthService } from "../src/modules/auth/auth.service.js";
import { hashToken } from "../src/modules/auth/auth-token.js";
import { hashMfaRecoveryCode } from "../src/modules/auth/mfa.js";

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
  security: {
    credentialEncryptionKey: "test-credential-encryption-key-with-32-characters",
    auditIntegrityKey: "test-security-integrity-key-with-32-characters",
    auditPreviousIntegrityKeys: [],
    loginProtection: {
      windowMs: 15 * 60_000,
      accountFreeAttempts: 5,
      ipFreeAttempts: 20,
      maxDelayMs: 15 * 60_000
    }
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

test("session IDs accept current token families and reject path injection", () => {
  assert.equal(sessionIdParams.safeParse({ id: "family_1234567890-safe" }).success, true);
  assert.equal(sessionIdParams.safeParse({ id: "../../other-user" }).success, false);
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
    authThrottle: {
      findMany: async () => [],
      deleteMany: async () => ({ count: 0 })
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

test("reusing a rotated refresh token revokes its active token family", async () => {
  const calls = {
    transactionCompleted: false,
    revokedWhere: undefined as unknown,
    audit: undefined as Record<string, unknown> | undefined
  };
  const tx = {
    refreshToken: {
      findUnique: async () => ({
        id: "refresh-1",
        userId: "user-1",
        familyId: "family-1",
        authVersion: 1,
        revokedAt: new Date(),
        replacedByTokenHash: "replacement-hash",
        expiresAt: new Date(Date.now() + 60_000),
        user: authUser(1)
      }),
      updateMany: async ({ where }: { where: unknown }) => {
        calls.revokedWhere = where;
        return { count: 2 };
      }
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        calls.audit = data;
        return data;
      }
    }
  };
  const service = new AuthService({
    $transaction: async (callback: (database: typeof tx) => Promise<unknown>) => {
      const result = await callback(tx);
      calls.transactionCompleted = true;
      return result;
    }
  } as unknown as PrismaClient, config);

  await assert.rejects(
    () => service.refresh("r".repeat(64), { requestId: "request-1" }),
    (error) => error instanceof AppError && error.code === "invalid_refresh_token"
  );

  assert.equal(calls.transactionCompleted, true);
  assert.deepEqual(calls.revokedWhere, { familyId: "family-1", revokedAt: null });
  assert.equal(calls.audit?.action, "refresh_token.replay_detected");
  assert.equal(calls.audit?.outcome, "DENIED");
  assert.equal(calls.audit?.severity, "HIGH");
});

test("MFA secrets created with the former audit key survive key separation", () => {
  const formerAuditKey = "former-audit-integrity-key-with-32-characters";
  const service = new AuthService({} as PrismaClient, {
    ...config,
    security: {
      ...config.security,
      auditIntegrityKey: "rotated-audit-integrity-key-with-32-characters",
      auditPreviousIntegrityKeys: [formerAuditKey]
    }
  });
  const encrypted = encryptSecretEnvelope(formerAuditKey, { secret: "MFA-SECRET" });
  const readMfaSecret = (service as unknown as {
    readMfaSecret: (envelope: string) => { secret: string; key: string };
  }).readMfaSecret.bind(service);

  assert.deepEqual(readMfaSecret(encrypted), { secret: "MFA-SECRET", key: formerAuditKey });
});

test("using a legacy MFA recovery code migrates the secret envelope", async () => {
  const formerAuditKey = "former-audit-integrity-key-with-32-characters";
  const recoveryCode = "ABCDE-23456";
  let updatedData: Record<string, any> | undefined;
  const rotatedConfig = {
    ...config,
    security: {
      ...config.security,
      auditIntegrityKey: "rotated-audit-integrity-key-with-32-characters",
      auditPreviousIntegrityKeys: [formerAuditKey]
    }
  };
  const service = new AuthService({
    userMfaCredential: {
      findUnique: async () => ({
        id: "mfa-1",
        enabledAt: new Date(),
        secretEnvelope: encryptSecretEnvelope(formerAuditKey, { secret: "MFA-SECRET" }),
        recoveryCodeHashes: [hashMfaRecoveryCode(recoveryCode, formerAuditKey)]
      }),
      updateMany: async ({ data }: { data: Record<string, any> }) => {
        updatedData = data;
        return { count: 1 };
      }
    }
  } as unknown as PrismaClient, rotatedConfig);
  const verifyMfaCode = (service as unknown as {
    verifyMfaCode: (userId: string, code: string) => Promise<boolean>;
  }).verifyMfaCode.bind(service);

  assert.equal(await verifyMfaCode("user-1", recoveryCode), true);
  assert.deepEqual(
    decryptSecretEnvelope(rotatedConfig.security.credentialEncryptionKey, updatedData?.secretEnvelope),
    { secret: "MFA-SECRET" }
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

test("active sessions are scoped to the user and never expose token hashes", async () => {
  const currentRefreshToken = "current-refresh-token-with-enough-entropy";
  let query: Record<string, unknown> | undefined;
  const service = new AuthService({
    refreshToken: {
      findMany: async (args: Record<string, unknown>) => {
        query = args;
        return [{
          tokenHash: hashToken(currentRefreshToken),
          familyId: "family_1234567890-safe",
          userAgent: "Test Browser",
          ipAddress: "127.0.0.1",
          authenticatedAt: new Date("2026-01-01T00:00:00.000Z"),
          mfaVerifiedAt: null,
          createdAt: new Date("2026-01-02T00:00:00.000Z"),
          expiresAt: new Date("2026-02-01T00:00:00.000Z")
        }];
      }
    }
  } as unknown as PrismaClient, config);

  const result = await service.listSessions("user-1", currentRefreshToken);

  assert.equal(result.sessions[0]?.current, true);
  assert.equal(result.sessions[0]?.id, "family_1234567890-safe");
  assert.equal("tokenHash" in (result.sessions[0] || {}), false);
  assert.deepEqual((query?.where as { userId?: string }).userId, "user-1");
  assert.equal(query?.take, 50);

  const apiSessionList = await service.listSessions("user-1");
  assert.equal(apiSessionList.sessions[0]?.current, false);
});

test("one session family can be revoked only for its authenticated owner", async () => {
  const currentRefreshToken = "current-refresh-token-with-enough-entropy";
  const calls = {
    lookup: undefined as unknown,
    update: undefined as unknown,
    audits: [] as Array<{ action: string; subjectId?: string }>
  };
  const tx = {
    refreshToken: {
      findFirst: async (args: Record<string, unknown>) => {
        calls.lookup = args;
        return { tokenHash: hashToken(currentRefreshToken) };
      },
      updateMany: async (args: Record<string, unknown>) => {
        calls.update = args;
        return { count: 1 };
      }
    },
    auditLog: {
      create: async ({ data }: { data: { action: string; subjectId?: string } }) => {
        calls.audits.push(data);
        return data;
      }
    }
  };
  const service = new AuthService({
    $transaction: async (callback: (database: typeof tx) => Promise<unknown>) => callback(tx)
  } as unknown as PrismaClient, config);

  const result = await service.revokeSession(
    "user-1",
    "family_1234567890-safe",
    currentRefreshToken,
    { ipAddress: "127.0.0.1" }
  );

  assert.deepEqual(result, { revoked: true, current: true, refreshTokensRevoked: 1 });
  assert.deepEqual((calls.lookup as { where: unknown }).where, {
    userId: "user-1",
    familyId: "family_1234567890-safe",
    revokedAt: null,
    expiresAt: { gt: (calls.lookup as { where: { expiresAt: { gt: Date } } }).where.expiresAt.gt }
  });
  assert.deepEqual((calls.update as { where: unknown }).where, {
    userId: "user-1",
    familyId: "family_1234567890-safe",
    revokedAt: null
  });
  assert.deepEqual(calls.audits.map(({ action, subjectId }) => ({ action, subjectId })), [{
    action: "sessions.revoke",
    subjectId: "family_1234567890-safe"
  }]);

  const otherDevice = await service.revokeSession(
    "user-1",
    "family_1234567890-safe",
    "different-refresh-token-with-enough-entropy",
    {}
  );
  assert.equal(otherDevice.current, false);
});

test("individual session revocation handles expired sessions and concurrent removal", async () => {
  const unavailableService = new AuthService({
    $transaction: async (callback: (database: unknown) => Promise<unknown>) => callback({
      refreshToken: { findFirst: async () => null }
    })
  } as unknown as PrismaClient, config);
  await assert.rejects(
    () => unavailableService.revokeSession("user-1", "family_1234567890-safe", undefined, {}),
    (error) => error instanceof AppError && error.code === "session_not_found"
  );

  const racedService = new AuthService({
    $transaction: async (callback: (database: unknown) => Promise<unknown>) => callback({
      refreshToken: {
        findFirst: async () => ({ tokenHash: "stored-hash" }),
        updateMany: async () => ({ count: 0 })
      }
    })
  } as unknown as PrismaClient, config);
  await assert.rejects(
    () => racedService.revokeSession("user-1", "family_1234567890-safe", undefined, {}),
    (error) => error instanceof AppError && error.code === "session_not_found"
  );
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
  const { loadUser } = await import("../apps/web/web/session-actions.js");

  assert.equal(values.has("cms_access_token"), false);
  assert.equal(values.has("cms_refresh_token"), false);
  assert.equal((await loadUser())?.id, "user-1");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url.endsWith("/auth/refresh"), true);
  assert.equal(requests[0]?.body, "{}");

  state.token = "expired-access";
  assert.equal((await api("/auth/me")).user.id, "user-1");
  assert.equal(requests.length, 4);
  assert.equal(requests[1]?.authorization, "Bearer expired-access");
  assert.equal(requests[2]?.body, "{}");
  assert.equal(requests[3]?.authorization, "Bearer memory-access");
  assert.equal(state.token, "memory-access");
  assert.equal(values.has("cms_access_token"), false);
  assert.equal(values.has("cms_refresh_token"), false);
});
