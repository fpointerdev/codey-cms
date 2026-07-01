import type { Prisma, PrismaClient } from "@prisma/client";

export type AuditMeta = {
  actorUserId?: string;
  action: string;
  subject: string;
  subjectId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Prisma.InputJsonValue;
};

export async function writeAuditLog(prisma: Pick<PrismaClient, "auditLog">, input: AuditMeta) {
  await prisma.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      action: input.action,
      subject: input.subject,
      subjectId: input.subjectId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      metadata: input.metadata
    }
  });
}
