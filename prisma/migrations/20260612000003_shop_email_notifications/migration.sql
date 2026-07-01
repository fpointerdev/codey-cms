CREATE TYPE "OrderNotificationEvent" AS ENUM ('ORDER_RECEIVED', 'ORDER_STATUS_CHANGED', 'ORDER_PAID', 'ORDER_REFUNDED');

ALTER TABLE "OrderNotification" ADD COLUMN "eventType" "OrderNotificationEvent" NOT NULL DEFAULT 'ORDER_RECEIVED';
ALTER TABLE "OrderNotification" ADD COLUMN "htmlBody" TEXT;
ALTER TABLE "OrderNotification" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OrderNotification" ADD COLUMN "failureReason" TEXT;
ALTER TABLE "OrderNotification" ADD COLUMN "lastAttemptAt" TIMESTAMP(3);

CREATE INDEX "OrderNotification_eventType_createdAt_idx" ON "OrderNotification"("eventType", "createdAt");
