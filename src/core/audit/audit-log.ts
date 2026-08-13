import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import pino from "pino";

const auditChainLockId = 1129271873;

const auditLogger = pino({
  level: process.env.NODE_TEST_CONTEXT ? "silent" : process.env.LOG_LEVEL || "info",
  base: {
    service: process.env.APP_NAME || "CodeY CMS",
    module: "security-audit"
  }
});

export type AuditOutcome = "SUCCESS" | "DENIED" | "FAILURE";
export type AuditSeverity = "INFO" | "WARN" | "HIGH" | "CRITICAL";

export type AuditMeta = {
  actorUserId?: string;
  action: string;
  subject: string;
  subjectId?: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  outcome?: AuditOutcome;
  severity?: AuditSeverity;
  metadata?: Prisma.InputJsonValue;
};

type AuditDatabase = Pick<PrismaClient, "auditLog"> &
  Partial<Pick<PrismaClient, "$queryRawUnsafe" | "$transaction">>;

type AuditRecord = {
  actorUserId: string | null;
  action: string;
  subject: string;
  subjectId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  outcome: string;
  severity: string;
  metadata: unknown;
  createdAt: Date;
  eventHash: string | null;
  eventKeyId?: string | null;
  previousEventHash?: string | null;
};

type IntegrityOptions = {
  knownPreviousEventHashes?: ReadonlySet<string>;
};

export async function writeAuditLog(prisma: AuditDatabase, input: AuditMeta) {
  const persisted = typeof prisma.$transaction === "function" &&
    typeof prisma.$queryRawUnsafe === "function"
    ? await prisma.$transaction((tx) => persistAuditLog(tx as AuditDatabase, input))
    : await persistAuditLog(prisma, input);

  const log = input.severity === "HIGH" || input.severity === "CRITICAL"
    ? auditLogger.warn.bind(auditLogger)
    : auditLogger.info.bind(auditLogger);
  log({ auditEvent: { ...persisted.event, eventHash: persisted.record.eventHash } }, "Security audit event");

  return persisted.record;
}

export async function safeWriteAuditLog(prisma: AuditDatabase, input: AuditMeta) {
  try {
    return await writeAuditLog(prisma, input);
  } catch (error) {
    auditLogger.error({ err: error, action: input.action, requestId: input.requestId }, "Unable to persist security audit event");
    return null;
  }
}

export function verifyAuditLogIntegrity(record: AuditRecord, options: IntegrityOptions = {}) {
  if (!record.eventHash) return "legacy" as const;

  if (!record.eventKeyId) {
    const event = auditEventPayload(record, record.createdAt);
    return auditKeyRing().some(({ key }) => hashesMatch(record.eventHash!, signAuditEvent(event, key)))
      ? "legacy" as const
      : "invalid" as const;
  }

  const auditKey = auditKeyRing().find(({ id }) => id === record.eventKeyId);
  if (!auditKey) return "unknown-key" as const;

  const event = auditEventPayload(record, record.createdAt, {
    eventKeyId: record.eventKeyId,
    previousEventHash: record.previousEventHash ?? null
  });
  if (!hashesMatch(record.eventHash, signAuditEvent(event, auditKey.key))) {
    return "invalid" as const;
  }
  if (
    record.previousEventHash &&
    options.knownPreviousEventHashes &&
    !options.knownPreviousEventHashes.has(record.previousEventHash)
  ) {
    return "invalid" as const;
  }
  return "valid" as const;
}

async function persistAuditLog(database: AuditDatabase, input: AuditMeta) {
  if (typeof database.$queryRawUnsafe === "function") {
    await database.$queryRawUnsafe(
      `SELECT pg_advisory_xact_lock(${auditChainLockId})::text AS "auditLock"`
    );
  }

  const auditLog = database.auditLog as typeof database.auditLog & {
    findFirst?: (args: unknown) => Promise<{
      eventHash: string | null;
      createdAt: Date;
    } | null>;
  };
  const previousRecord = typeof auditLog.findFirst === "function"
    ? await auditLog.findFirst({
        where: { eventHash: { not: null } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { eventHash: true, createdAt: true }
      })
    : null;
  const previousEventHash = previousRecord?.eventHash ?? null;
  const createdAt = new Date(Math.max(
    Date.now(),
    (previousRecord?.createdAt.getTime() ?? -1) + 1
  ));
  const auditKey = currentAuditKey();
  const event = auditEventPayload(input, createdAt, {
    eventKeyId: auditKey.id,
    previousEventHash
  });
  const eventHash = signAuditEvent(event, auditKey.key);
  const record = await database.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      action: input.action,
      subject: input.subject,
      subjectId: input.subjectId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      requestId: input.requestId,
      outcome: input.outcome ?? "SUCCESS",
      severity: input.severity ?? "INFO",
      eventHash,
      eventKeyId: auditKey.id,
      previousEventHash,
      metadata: input.metadata,
      createdAt
    }
  });

  return { event, record };
}

function auditEventPayload(
  input: AuditMeta | AuditRecord,
  createdAt: Date,
  chain?: { eventKeyId: string; previousEventHash: string | null }
) {
  return {
    actorUserId: input.actorUserId ?? null,
    action: input.action,
    subject: input.subject,
    subjectId: input.subjectId ?? null,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    requestId: input.requestId ?? null,
    outcome: input.outcome ?? "SUCCESS",
    severity: input.severity ?? "INFO",
    metadata: input.metadata ?? null,
    createdAt: createdAt.toISOString(),
    ...(chain ?? {})
  };
}

// codeql[js/insufficient-password-hash]
function signAuditEvent(event: ReturnType<typeof auditEventPayload>, key: string) {
  // This HMAC signs an audit record for tamper evidence; it is not a password hash.
  return createHmac("sha256", key).update(stableJson(event)).digest("hex");
}

function currentAuditKey() {
  const key = process.env.SECURITY_AUDIT_KEY ||
    process.env.CMS_CREDENTIAL_ENCRYPTION_KEY ||
    process.env.JWT_ACCESS_SECRET ||
    "codey-test-audit-integrity-key";
  return { id: auditKeyId(key), key };
}

function auditKeyRing() {
  const keys = [
    currentAuditKey().key,
    ...(process.env.SECURITY_AUDIT_PREVIOUS_KEYS || "")
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean)
  ];
  return [...new Set(keys)].map((key) => ({ id: auditKeyId(key), key }));
}

function auditKeyId(key: string) {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function hashesMatch(actual: string, expected: string) {
  if (!/^[a-f\d]{64}$/i.test(actual)) return false;
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
