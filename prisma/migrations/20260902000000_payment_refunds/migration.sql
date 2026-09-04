-- CreateEnum
CREATE TYPE "PaymentRefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentRefundReason" AS ENUM ('CUSTOMER_REQUEST', 'DUPLICATE', 'FRAUDULENT', 'OTHER');

-- CreateTable
CREATE TABLE "PaymentRefund" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "status" "PaymentRefundStatus" NOT NULL DEFAULT 'PENDING',
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" "PaymentRefundReason" NOT NULL DEFAULT 'CUSTOMER_REQUEST',
    "note" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "providerReference" TEXT,
    "failureMessage" TEXT,
    "initiatedByUserId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PaymentRefund"
  ADD CONSTRAINT "PaymentRefund_amountCents_check" CHECK ("amountCents" > 0);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRefund_idempotencyKey_key" ON "PaymentRefund"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRefund_provider_providerReference_key" ON "PaymentRefund"("provider", "providerReference");

-- CreateIndex
CREATE INDEX "PaymentRefund_paymentId_createdAt_idx" ON "PaymentRefund"("paymentId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentRefund_status_updatedAt_idx" ON "PaymentRefund"("status", "updatedAt");

-- Only one provider request may be in flight for a payment at a time.
CREATE UNIQUE INDEX "PaymentRefund_one_pending_per_payment_idx"
  ON "PaymentRefund"("paymentId")
  WHERE "status" = 'PENDING';

-- AddForeignKey
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
