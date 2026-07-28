import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";
import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../src/config/index.js";
import { AppError } from "../src/core/errors/app-error.js";
import { verifyAuditLogIntegrity, writeAuditLog } from "../src/core/audit/audit-log.js";
import { encryptSecretEnvelope } from "../src/core/security/secret-envelope.js";
import { AuthService } from "../src/modules/auth/auth.service.js";
import { LoginProtectionService } from "../src/modules/auth/login-protection.service.js";
import { writeScriptAuditLog } from "../scripts/audit-log.mjs";
import {
  hashMfaRecoveryCode,
  normalizeRecoveryCode,
  verifyTotpCode
} from "../src/modules/auth/mfa.js";

const execFileAsync = promisify(execFile);

const securityConfig = {
  auth: {
    accessTokenSecret: "test-access-secret-with-at-least-32-characters"
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
  }
} as AppConfig;

const productionEnvironment = {
  NODE_ENV: "production",
  APP_ENV: "production",
  APP_PUBLIC_URL: "https://example.com",
  DATABASE_URL: "postgresql://codey:codey@localhost:5432/codey",
  JWT_ACCESS_SECRET: "production-access-secret-with-at-least-32-characters",
  CMS_CREDENTIAL_ENCRYPTION_KEY: "production-credential-key-with-at-least-32-characters",
  CODEY_INSTALL_TOKEN: "production-install-token-with-at-least-32-characters",
  CORS_ORIGINS: "https://example.com",
  AUTH_RECOVERY_TOKEN_DELIVERY: "disabled",
  STORAGE_DRIVER: "s3",
  STORAGE_S3_ENDPOINT: "https://storage.example.com",
  STORAGE_S3_BUCKET: "codey",
  STORAGE_S3_ACCESS_KEY_ID: "access-key",
  STORAGE_S3_SECRET_ACCESS_KEY: "secret-key",
  STORAGE_KEY_PREFIX: "sites/example"
};

test("production rejects blanket proxy trust but accepts an exact hop count", async () => {
  const inspectProxy = (trustProxy: string) => execFileAsync(process.execPath, [
    "--import",
    "tsx",
    "--input-type=module",
    "--eval",
    "import('./src/config/env.ts').then(({ env }) => process.stdout.write(JSON.stringify(env.TRUST_PROXY)))"
  ], {
    env: { ...productionEnvironment, TRUST_PROXY: trustProxy }
  });

  await assert.rejects(
    inspectProxy("true"),
    (error: any) => error.stderr?.includes("TRUST_PROXY=true is not allowed")
  );
  const exactHop = await inspectProxy("1");
  assert.equal(exactHop.stdout, "1");
});

test("off-site backup claims require mandatory backups and a mirror", async () => {
  const inspectBackup = (overrides: Record<string, string>) => execFileAsync(process.execPath, [
    "--import",
    "tsx",
    "--input-type=module",
    "--eval",
    "import('./src/config/env.ts').then(({ env }) => process.stdout.write(JSON.stringify({ required: env.BACKUP_REQUIRED, offsiteRequired: env.BACKUP_OFFSITE_REQUIRED, protected: env.BACKUP_OFFSITE_PROTECTED })))"
  ], {
    env: { ...productionEnvironment, ...overrides }
  });

  await assert.rejects(
    inspectBackup({ BACKUP_REQUIRED: "false", BACKUP_OFFSITE_REQUIRED: "true" }),
    (error: any) => error.stderr?.includes("BACKUP_REQUIRED must be enabled")
  );
  await assert.rejects(
    inspectBackup({
      BACKUP_REQUIRED: "true",
      BACKUP_OFFSITE_REQUIRED: "true",
      BACKUP_OFFSITE_PROTECTED: "true"
    }),
    (error: any) => error.stderr?.includes("BACKUP_MIRROR_DIR is required")
  );

  const valid = await inspectBackup({
    BACKUP_REQUIRED: "true",
    BACKUP_OFFSITE_REQUIRED: "true",
    BACKUP_OFFSITE_PROTECTED: "true",
    BACKUP_MIRROR_DIR: "/offsite/backups"
  });
  assert.deepEqual(JSON.parse(valid.stdout), {
    required: true,
    offsiteRequired: true,
    protected: true
  });
});

test("TOTP verification follows the standard time window", () => {
  const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

  assert.equal(verifyTotpCode(rfcSecret, "287082", 59_000), true);
  assert.equal(verifyTotpCode(rfcSecret, "287083", 59_000), false);
  assert.equal(verifyTotpCode(rfcSecret, "287082", 149_000), false);
});

test("recovery codes normalize safely before keyed hashing", () => {
  assert.equal(normalizeRecoveryCode("abcde-23456"), "ABCDE23456");
  assert.equal(
    hashMfaRecoveryCode("ABCDE-23456", securityConfig.security.credentialEncryptionKey),
    hashMfaRecoveryCode("abcde 23456", securityConfig.security.credentialEncryptionKey)
  );
});

test("concurrent recovery-code use cannot restore a consumed code", async () => {
  const key = securityConfig.security.credentialEncryptionKey;
  const codes = ["ABCDE-23456", "FGHJK-67890"];
  let credential = {
    id: "mfa-1",
    userId: "user-1",
    enabledAt: new Date(),
    pendingExpiresAt: null,
    secretEnvelope: encryptSecretEnvelope(key, { secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" }),
    recoveryCodeHashes: codes.map((code) => hashMfaRecoveryCode(code, key)),
    lastUsedAt: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const model = {
    findUnique: async () => ({ ...credential, recoveryCodeHashes: [...credential.recoveryCodeHashes] }),
    update: async () => credential,
    updateMany: async ({ where, data }: any) => {
      const expected = where.recoveryCodeHashes.equals;
      if (JSON.stringify(expected) !== JSON.stringify(credential.recoveryCodeHashes)) {
        return { count: 0 };
      }
      credential = {
        ...credential,
        recoveryCodeHashes: [...data.recoveryCodeHashes.set],
        lastUsedAt: data.lastUsedAt
      };
      return { count: 1 };
    }
  };
  const service = new AuthService({ userMfaCredential: model } as unknown as PrismaClient, securityConfig);

  assert.deepEqual(
    await Promise.all(codes.map((code) => (service as any).verifyMfaCode("user-1", code))),
    [true, true]
  );
  assert.deepEqual(credential.recoveryCodeHashes, []);
  assert.equal(await (service as any).verifyMfaCode("user-1", codes[0]), false);
});

test("login throttling persists per account and delays repeated failures", async () => {
  const records = new Map<string, Record<string, unknown>>();
  let nextId = 1;
  const model = {
    findMany: async ({ where }: any) => [...records.values()].filter((record: any) =>
      where.OR.some((key: any) => key.scope === record.scope && key.keyHash === record.keyHash) &&
      record.blockedUntil instanceof Date && record.blockedUntil > where.blockedUntil.gt
    ).sort((left: any, right: any) => right.blockedUntil.getTime() - left.blockedUntil.getTime()),
    deleteMany: async ({ where }: any) => {
      let count = 0;
      for (const [key, record] of records) {
        const matchesKey = !where.scope || (
          record.scope === where.scope && record.keyHash === where.keyHash
        );
        if (matchesKey && (!where.lastFailedAt || (record.lastFailedAt as Date) < where.lastFailedAt.lt)) {
          records.delete(key);
          count += 1;
        }
      }
      return { count };
    },
    upsert: async ({ where, create }: any) => {
      const key = `${where.scope_keyHash.scope}:${where.scope_keyHash.keyHash}`;
      const existing: any = records.get(key);
      const value: any = existing
        ? { ...existing, failureCount: existing.failureCount + 1, lastFailedAt: new Date() }
        : { id: `attempt-${nextId++}`, ...create, blockedUntil: null };
      records.set(key, value);
      return value;
    },
    update: async ({ where, data }: any) => {
      const entry = [...records.entries()].find(([, record]) => record.id === where.id)!;
      const value = { ...entry[1], ...data };
      records.set(entry[0], value);
      return value;
    }
  };
  const prisma = {
    authThrottle: model,
    $transaction: async (callback: (database: { authThrottle: typeof model }) => Promise<unknown>) =>
      callback({ authThrottle: model })
  } as unknown as PrismaClient;
  const service = new LoginProtectionService(prisma, securityConfig);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    await service.recordFailure("owner@example.com", "203.0.113.10");
  }

  await assert.rejects(
    () => service.assertAllowed("owner@example.com", "198.51.100.8"),
    (error) => error instanceof AppError &&
      error.code === "login_temporarily_delayed" &&
      Number(error.details?.retryAfterSeconds) >= 1
  );
  await service.recordSuccess("owner@example.com");
  await service.assertAllowed("owner@example.com", "198.51.100.8");

  for (const record of records.values()) record.lastFailedAt = new Date(0);
  await service.recordFailure("another@example.com", "203.0.113.11");
  assert.equal(records.size, 2);
});

test("audit records detect database-side mutation", async () => {
  process.env.SECURITY_AUDIT_KEY = securityConfig.security.auditIntegrityKey;
  let stored: any;
  const prisma = {
    auditLog: {
      create: async ({ data }: any) => {
        stored = {
          id: "audit-1",
          ...data,
          actorUserId: data.actorUserId ?? null,
          subjectId: data.subjectId ?? null,
          ipAddress: data.ipAddress ?? null,
          userAgent: data.userAgent ?? null,
          requestId: data.requestId ?? null,
          metadata: data.metadata ?? null
        };
        return stored;
      }
    }
  } as unknown as PrismaClient;

  await writeAuditLog(prisma, {
    actorUserId: "owner-1",
    action: "page.update",
    subject: "cms",
    subjectId: "page-1",
    requestId: "request-1234",
    metadata: { status: "PUBLISHED" }
  });

  assert.equal(verifyAuditLogIntegrity(stored), "valid");
  assert.equal(verifyAuditLogIntegrity({ ...stored, action: "page.delete" }), "invalid");
});

test("operational scripts produce audit records accepted by the API verifier", async () => {
  process.env.SECURITY_AUDIT_KEY = securityConfig.security.auditIntegrityKey;
  let stored: any;
  const prisma = {
    auditLog: {
      create: async ({ data }: any) => {
        stored = { id: "script-audit-1", ...data };
        return stored;
      }
    }
  };

  await writeScriptAuditLog(prisma, {
    action: "runtime.update.succeeded",
    subject: "runtime",
    subjectId: "update-1",
    metadata: { fromVersion: "0.8.0", toVersion: "0.9.0" }
  });

  assert.equal(verifyAuditLogIntegrity(stored), "valid");
});

test("audit key rotation verifies retained history without re-signing it", async () => {
  const originalCurrentKey = process.env.SECURITY_AUDIT_KEY;
  const originalPreviousKeys = process.env.SECURITY_AUDIT_PREVIOUS_KEYS;
  const formerKey = "former-audit-integrity-key-with-at-least-32-characters";
  const currentKey = "current-audit-integrity-key-with-at-least-32-characters";
  let stored: any;
  const prisma = {
    auditLog: {
      create: async ({ data }: any) => {
        stored = { id: "audit-rotation-1", ...data };
        return stored;
      }
    }
  } as unknown as PrismaClient;

  try {
    process.env.SECURITY_AUDIT_KEY = formerKey;
    delete process.env.SECURITY_AUDIT_PREVIOUS_KEYS;
    await writeAuditLog(prisma, {
      action: "security.key_rotation.prepare",
      subject: "runtime"
    });

    process.env.SECURITY_AUDIT_KEY = currentKey;
    process.env.SECURITY_AUDIT_PREVIOUS_KEYS = formerKey;
    assert.equal(verifyAuditLogIntegrity(stored), "valid");

    delete process.env.SECURITY_AUDIT_PREVIOUS_KEYS;
    assert.equal(verifyAuditLogIntegrity(stored), "unknown-key");
  } finally {
    if (originalCurrentKey === undefined) delete process.env.SECURITY_AUDIT_KEY;
    else process.env.SECURITY_AUDIT_KEY = originalCurrentKey;
    if (originalPreviousKeys === undefined) delete process.env.SECURITY_AUDIT_PREVIOUS_KEYS;
    else process.env.SECURITY_AUDIT_PREVIOUS_KEYS = originalPreviousKeys;
  }
});

test("audit chains detect a deleted predecessor", async () => {
  const originalCurrentKey = process.env.SECURITY_AUDIT_KEY;
  process.env.SECURITY_AUDIT_KEY = securityConfig.security.auditIntegrityKey;
  const records: any[] = [];
  const prisma = {
    auditLog: {
      findFirst: async () => {
        const latest = records.at(-1);
        return latest ? { eventHash: latest.eventHash, createdAt: latest.createdAt } : null;
      },
      create: async ({ data }: any) => {
        const stored = { id: `audit-${records.length + 1}`, ...data };
        records.push(stored);
        return stored;
      }
    }
  } as unknown as PrismaClient;

  try {
    const first = await writeAuditLog(prisma, { action: "page.create", subject: "cms" });
    const second = await writeAuditLog(prisma, { action: "page.publish", subject: "cms" });
    assert.equal(second.previousEventHash, first.eventHash);
    assert.equal(verifyAuditLogIntegrity(second, {
      knownPreviousEventHashes: new Set([first.eventHash!])
    }), "valid");
    assert.equal(verifyAuditLogIntegrity(second, {
      knownPreviousEventHashes: new Set()
    }), "invalid");
  } finally {
    if (originalCurrentKey === undefined) delete process.env.SECURITY_AUDIT_KEY;
    else process.env.SECURITY_AUDIT_KEY = originalCurrentKey;
  }
});
