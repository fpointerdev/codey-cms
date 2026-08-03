ALTER TYPE "OrderNotificationStatus" ADD VALUE 'PROCESSING' AFTER 'QUEUED';

ALTER TABLE "OrderNotification"
ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DROP INDEX "OrderNotification_status_createdAt_idx";

CREATE INDEX "OrderNotification_status_nextAttemptAt_createdAt_idx"
ON "OrderNotification"("status", "nextAttemptAt", "createdAt");
