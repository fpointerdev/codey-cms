-- Persistent login protection and optional two-step verification.
CREATE TABLE "UserMfaCredential" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "secretEnvelope" TEXT NOT NULL,
  "recoveryCodeHashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "enabledAt" TIMESTAMP(3),
  "pendingExpiresAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserMfaCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserMfaCredential_userId_key" ON "UserMfaCredential"("userId");
CREATE INDEX "UserMfaCredential_enabledAt_idx" ON "UserMfaCredential"("enabledAt");
ALTER TABLE "UserMfaCredential" ADD CONSTRAINT "UserMfaCredential_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AuthThrottle" (
  "id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "failureCount" INTEGER NOT NULL DEFAULT 0,
  "firstFailedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastFailedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "blockedUntil" TIMESTAMP(3),
  "alertedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuthThrottle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuthThrottle_scope_keyHash_key" ON "AuthThrottle"("scope", "keyHash");
CREATE INDEX "AuthThrottle_blockedUntil_idx" ON "AuthThrottle"("blockedUntil");
CREATE INDEX "AuthThrottle_lastFailedAt_idx" ON "AuthThrottle"("lastFailedAt");

ALTER TABLE "RefreshToken" ADD COLUMN "familyId" TEXT;
ALTER TABLE "RefreshToken" ADD COLUMN "authenticatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "RefreshToken" ADD COLUMN "mfaVerifiedAt" TIMESTAMP(3);
UPDATE "RefreshToken" SET "familyId" = "id" WHERE "familyId" IS NULL;
ALTER TABLE "RefreshToken" ALTER COLUMN "familyId" SET NOT NULL;

ALTER TABLE "AuditLog" ADD COLUMN "requestId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "outcome" TEXT NOT NULL DEFAULT 'SUCCESS';
ALTER TABLE "AuditLog" ADD COLUMN "severity" TEXT NOT NULL DEFAULT 'INFO';
ALTER TABLE "AuditLog" ADD COLUMN "eventHash" TEXT;
CREATE INDEX "AuditLog_severity_createdAt_idx" ON "AuditLog"("severity", "createdAt");
CREATE INDEX "AuditLog_requestId_idx" ON "AuditLog"("requestId");
