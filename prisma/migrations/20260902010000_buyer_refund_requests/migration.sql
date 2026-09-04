-- Extend buyer support with reviewed refund requests.
ALTER TYPE "OrderSupportCaseType" ADD VALUE 'REFUND';
ALTER TYPE "OrderSupportCaseStatus" ADD VALUE 'APPROVED';
ALTER TYPE "OrderSupportCaseStatus" ADD VALUE 'REJECTED';

ALTER TABLE "OrderSupportCase"
  ADD COLUMN "requestedRefundCents" INTEGER;

ALTER TABLE "OrderSupportCase"
  ADD CONSTRAINT "OrderSupportCase_requestedRefundCents_check"
  CHECK ("requestedRefundCents" IS NULL OR "requestedRefundCents" > 0);

ALTER TABLE "PaymentRefund"
  ADD COLUMN "supportCaseId" TEXT;

CREATE UNIQUE INDEX "PaymentRefund_supportCaseId_key"
  ON "PaymentRefund"("supportCaseId");

ALTER TABLE "PaymentRefund"
  ADD CONSTRAINT "PaymentRefund_supportCaseId_fkey"
  FOREIGN KEY ("supportCaseId") REFERENCES "OrderSupportCase"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
