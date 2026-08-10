ALTER TABLE "Order"
ADD COLUMN "checkoutEmailHash" TEXT,
ADD COLUMN "checkoutIpHash" TEXT;

CREATE INDEX "Order_checkoutEmailHash_status_checkoutStatus_idx"
ON "Order"("checkoutEmailHash", "status", "checkoutStatus");

CREATE INDEX "Order_checkoutIpHash_status_checkoutStatus_idx"
ON "Order"("checkoutIpHash", "status", "checkoutStatus");

CREATE TABLE "CommerceRateLimit" (
  "id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "requestCount" INTEGER NOT NULL DEFAULT 0,
  "windowStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CommerceRateLimit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommerceRateLimit_scope_keyHash_key"
ON "CommerceRateLimit"("scope", "keyHash");

CREATE INDEX "CommerceRateLimit_expiresAt_idx"
ON "CommerceRateLimit"("expiresAt");
