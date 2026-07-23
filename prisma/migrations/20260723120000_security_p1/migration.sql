CREATE INDEX "RefreshToken_familyId_revokedAt_idx"
ON "RefreshToken"("familyId", "revokedAt");

ALTER TABLE "AuditLog"
ADD COLUMN "eventKeyId" TEXT,
ADD COLUMN "previousEventHash" TEXT;

CREATE INDEX "AuditLog_eventHash_idx"
ON "AuditLog"("eventHash");

CREATE INDEX "AuditLog_eventKeyId_idx"
ON "AuditLog"("eventKeyId");

CREATE INDEX "AuditLog_previousEventHash_idx"
ON "AuditLog"("previousEventHash");
