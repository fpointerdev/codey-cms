import { createHash, createHmac } from "node:crypto";

const auditChainLockId = 1129271873;

export async function writeScriptAuditLog(prisma, input) {
  if (typeof prisma.$transaction === "function") {
    return prisma.$transaction((tx) => persistScriptAuditLog(tx, input));
  }
  return persistScriptAuditLog(prisma, input);
}

async function persistScriptAuditLog(prisma, input) {
  if (typeof prisma.$queryRawUnsafe === "function") {
    await prisma.$queryRawUnsafe(
      `SELECT pg_advisory_xact_lock(${auditChainLockId})::text AS "auditLock"`
    );
  }
  const previousRecord = typeof prisma.auditLog.findFirst === "function"
    ? await prisma.auditLog.findFirst({
        where: { eventHash: { not: null } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { eventHash: true, createdAt: true }
      })
    : null;
  const previousEventHash = previousRecord?.eventHash ?? null;
  const createdAt = new Date(Math.max(
    Date.now(),
    (previousRecord?.createdAt?.getTime() ?? -1) + 1
  ));
  const key = auditIntegrityKey();
  const eventKeyId = auditKeyId(key);
  const event = {
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
    eventKeyId,
    previousEventHash
  };
  const eventHash = createHmac("sha256", key)
    .update(stableJson(event))
    .digest("hex");

  return prisma.auditLog.create({
    data: {
      ...event,
      metadata: input.metadata,
      eventHash,
      createdAt
    }
  });
}

function auditIntegrityKey() {
  return process.env.SECURITY_AUDIT_KEY ||
    process.env.CMS_CREDENTIAL_ENCRYPTION_KEY ||
    process.env.JWT_ACCESS_SECRET ||
    "codey-test-audit-integrity-key";
}

function auditKeyId(key) {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
